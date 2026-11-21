/**
 * All persisted data: settings, sessions, the hint-credit wallet and completions.
 * Reward grants, credit spends and their session updates are single transactions.
 */
import type { Difficulty } from '../engine/grader';
import { Session, SessionSlot, isValidSession } from '../game/session';
import { DEFAULT_SETTINGS, Settings } from '../game/settings';
import { Database, SqlDriver, Tx } from './database';

export const SCHEMA_VERSION = 1;

/** Each entry upgrades the schema by one version. Append only; never edit shipped entries. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE sessions (
    slot TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE wallet (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    credits INTEGER NOT NULL CHECK (credits >= 0)
  );
  INSERT INTO wallet (id, credits) VALUES (1, 0);
  CREATE TABLE reward_grants (
    grant_id TEXT PRIMARY KEY NOT NULL,
    credits INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE credit_spends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    board_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE completions (
    session_id TEXT PRIMARY KEY NOT NULL,
    slot TEXT NOT NULL,
    puzzle_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    date_key TEXT,
    time_ms INTEGER NOT NULL,
    mistakes INTEGER NOT NULL,
    hints INTEGER NOT NULL,
    completed_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX completions_daily ON completions (date_key) WHERE date_key IS NOT NULL;
  `,
];

export interface Completion {
  sessionId: string;
  slot: SessionSlot;
  puzzleId: string;
  difficulty: Difficulty;
  dateKey: string | null;
  timeMs: number;
  mistakes: number;
  hints: number;
  completedAt: number;
}

interface CompletionRow {
  session_id: string;
  slot: SessionSlot;
  puzzle_id: string;
  difficulty: Difficulty;
  date_key: string | null;
  time_ms: number;
  mistakes: number;
  hints: number;
  completed_at: number;
}

const toCompletion = (row: CompletionRow): Completion => ({
  sessionId: row.session_id,
  slot: row.slot,
  puzzleId: row.puzzle_id,
  difficulty: row.difficulty,
  dateKey: row.date_key,
  timeMs: row.time_ms,
  mistakes: row.mistakes,
  hints: row.hints,
  completedAt: row.completed_at,
});

export type HintCost = 'free' | 'credit';

export class InsufficientCreditsError extends Error {
  constructor() {
    super('No hint credits available');
    this.name = 'InsufficientCreditsError';
  }
}

export class Repository {
  private constructor(private readonly db: Database) {}

  static async open(driver: SqlDriver): Promise<Repository> {
    const db = new Database(driver);
    const version = await db.direct(async (tx) => {
      const row = await tx.first<{ user_version: number }>('PRAGMA user_version');
      return row?.user_version ?? 0;
    });
    if (version > SCHEMA_VERSION) {
      throw new Error(`Saved data is from a newer app version (schema ${version}).`);
    }
    for (let v = version; v < SCHEMA_VERSION; v++) {
      // exec runs the whole script; wrapping it in a transaction keeps a failed upgrade from half-applying.
      await db.direct(async (_tx, exec) => {
        await exec(`BEGIN IMMEDIATE; ${MIGRATIONS[v]} PRAGMA user_version = ${v + 1}; COMMIT;`);
      });
    }
    return new Repository(db);
  }

  /* ------------------------------ settings ------------------------------ */

  async loadSettings(): Promise<Settings> {
    const row = await this.db.direct((tx) => tx.first<{ value: string }>("SELECT value FROM kv WHERE key = 'settings'"));
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<Settings>) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.db.direct((tx) =>
      tx.run("INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
        JSON.stringify(settings),
      ]),
    );
  }

  /* ------------------------------ sessions ------------------------------ */

  async loadSessions(): Promise<Record<SessionSlot, Session | null>> {
    const rows = await this.db.direct((tx) => tx.all<{ slot: SessionSlot; data: string }>('SELECT slot, data FROM sessions'));
    const out: Record<SessionSlot, Session | null> = { classic: null, daily: null };
    for (const row of rows) {
      try {
        const parsed: unknown = JSON.parse(row.data);
        if (isValidSession(parsed) && parsed.slot === row.slot) out[row.slot] = parsed;
      } catch {
        // A corrupt row is ignored; the player simply starts a new puzzle.
      }
    }
    return out;
  }

  private async writeSession(tx: Tx, session: Session, now: number): Promise<boolean> {
    // A finished session must never be written back by a late autosave.
    const done = await tx.first('SELECT 1 AS x FROM completions WHERE session_id = ?', [session.id]);
    if (done) return false;
    await tx.run(
      `INSERT INTO sessions (slot, session_id, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (slot) DO UPDATE SET session_id = excluded.session_id, data = excluded.data, updated_at = excluded.updated_at`,
      [session.slot, session.id, JSON.stringify(session), now],
    );
    return true;
  }

  saveSession(session: Session, now: number): Promise<boolean> {
    return this.db.transaction((tx) => this.writeSession(tx, session, now));
  }

  async deleteSession(slot: SessionSlot): Promise<void> {
    await this.db.direct((tx) => tx.run('DELETE FROM sessions WHERE slot = ?', [slot]));
  }

  /* ------------------------------- wallet ------------------------------- */

  private async balance(tx: Tx): Promise<number> {
    return (await tx.first<{ credits: number }>('SELECT credits FROM wallet WHERE id = 1'))?.credits ?? 0;
  }

  getCredits(): Promise<number> {
    return this.db.direct((tx) => this.balance(tx));
  }

  /**
   * Records a reward grant and raises the balance in one transaction. The grant id is the
   * primary key, so a repeated callback for the same ad attempt changes nothing.
   */
  grantReward(grantId: string, credits: number, now: number): Promise<{ granted: boolean; balance: number }> {
    return this.db.transaction(async (tx) => {
      const insert = await tx.run('INSERT OR IGNORE INTO reward_grants (grant_id, credits, created_at) VALUES (?, ?, ?)', [
        grantId,
        credits,
        now,
      ]);
      const granted = insert.changes === 1;
      if (granted) await tx.run('UPDATE wallet SET credits = credits + ? WHERE id = 1', [credits]);
      return { granted, balance: await this.balance(tx) };
    });
  }

  /**
   * Persists a revealed hint with its payment. `session` already contains the explanation;
   * the debit (if any) and the session write commit together or not at all.
   */
  spendHint(session: Session, cost: HintCost, now: number): Promise<{ charged: boolean; balance: number }> {
    return this.db.transaction(async (tx) => {
      if (!session.hint) throw new Error('spendHint requires a session with a revealed hint');
      const stored = await tx.first<{ data: string }>('SELECT data FROM sessions WHERE slot = ? AND session_id = ?', [
        session.slot,
        session.id,
      ]);
      // Already paid for this exact board (for example a double tap): reopen for free.
      let alreadyOwned = false;
      if (stored) {
        try {
          alreadyOwned = (JSON.parse(stored.data) as Session).hint?.boardKey === session.hint.boardKey;
        } catch {
          alreadyOwned = false;
        }
      }
      let charged = false;
      if (!alreadyOwned && cost === 'credit') {
        const debit = await tx.run('UPDATE wallet SET credits = credits - 1 WHERE id = 1 AND credits >= 1');
        if (debit.changes !== 1) throw new InsufficientCreditsError();
        await tx.run('INSERT INTO credit_spends (session_id, board_key, created_at) VALUES (?, ?, ?)', [
          session.id,
          session.hint.boardKey,
          now,
        ]);
        charged = true;
      }
      if (!alreadyOwned) await this.writeSession(tx, session, now);
      return { charged, balance: await this.balance(tx) };
    });
  }

  /* ----------------------------- completions ---------------------------- */

  /** Records a finished puzzle exactly once and removes its saved session. */
  recordCompletion(session: Session, now: number): Promise<{ recorded: boolean }> {
    return this.db.transaction(async (tx) => {
      const insert = await tx.run(
        `INSERT OR IGNORE INTO completions
           (session_id, slot, puzzle_id, difficulty, date_key, time_ms, mistakes, hints, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          session.slot,
          session.puzzleId,
          session.difficulty,
          session.slot === 'daily' ? session.dateKey : null,
          Math.round(session.elapsedMs),
          session.mistakes,
          session.hintsUsed,
          now,
        ],
      );
      await tx.run('DELETE FROM sessions WHERE slot = ? AND session_id = ?', [session.slot, session.id]);
      return { recorded: insert.changes === 1 };
    });
  }

  async getCompletion(sessionId: string): Promise<Completion | null> {
    const row = await this.db.direct((tx) => tx.first<CompletionRow>('SELECT * FROM completions WHERE session_id = ?', [sessionId]));
    return row ? toCompletion(row) : null;
  }

  async getDailyCompletion(dateKey: string): Promise<Completion | null> {
    const row = await this.db.direct((tx) => tx.first<CompletionRow>('SELECT * FROM completions WHERE date_key = ?', [dateKey]));
    return row ? toCompletion(row) : null;
  }

  async listDailyCompletionDates(): Promise<string[]> {
    const rows = await this.db.direct((tx) =>
      tx.all<{ date_key: string }>('SELECT date_key FROM completions WHERE date_key IS NOT NULL ORDER BY date_key'),
    );
    return rows.map((r) => r.date_key);
  }

  async listCompletions(): Promise<Completion[]> {
    const rows = await this.db.direct((tx) => tx.all<CompletionRow>('SELECT * FROM completions ORDER BY completed_at'));
    return rows.map(toCompletion);
  }
}
