/**
 * All persisted data: settings, sessions, the hint-credit wallet and completions.
 * Reward grants, credit spends and their session updates are single transactions.
 */
import type { Difficulty } from '../engine/grader';
import { decodeChallengeScore, encodeChallengeScore, type ChallengeScore } from '../game/challenge';
import { isMistakeReview, isTechniquePackId, type MistakeAttempt, type TechniquePackId } from '../game/learning';
import { MINI_CLASSIC_KEY, readMiniClassic, type MiniClassicSession } from '../game/miniClassic';
import { Session, SessionSlot, isValidSession } from '../game/session';
import { DEFAULT_SETTINGS, Settings, isBoardTheme } from '../game/settings';
import { Database, SqlDriver, Tx } from './database';

type Migration = string | ((tx: Tx) => Promise<void>);

/** Each entry upgrades the schema by one version. Append only; never edit shipped entries. */
const MIGRATIONS: Migration[] = [
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
  `
  ALTER TABLE completions ADD COLUMN challenge_code TEXT;
  CREATE TABLE challenge_scores (
    challenge_code TEXT PRIMARY KEY NOT NULL,
    result_code TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE completions ADD COLUMN technique_pack TEXT;
  ALTER TABLE completions ADD COLUMN mistake_review TEXT;
  ALTER TABLE completions ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;
  DROP INDEX completions_daily;
  CREATE UNIQUE INDEX completions_daily ON completions (date_key) WHERE slot = 'daily' AND date_key IS NOT NULL;
  CREATE UNIQUE INDEX completions_weekly ON completions (date_key, difficulty) WHERE slot = 'weekly';
  `,
  async (tx) => {
    // Early version 3 databases had mistake reviews but no summary count.
    const columns = await tx.all<{ name: string }>('PRAGMA table_info(completions)');
    if (columns.some(({ name }) => name === 'review_count')) return;

    await tx.run('ALTER TABLE completions ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0');
    const rows = await tx.all<{ session_id: string; mistake_review: string }>(
      'SELECT session_id, mistake_review FROM completions WHERE mistake_review IS NOT NULL',
    );
    for (const row of rows) {
      const count = parseMistakeReview(row.mistake_review)?.length ?? 0;
      if (count > 0) await tx.run('UPDATE completions SET review_count = ? WHERE session_id = ?', [count, row.session_id]);
    }
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export interface Completion {
  sessionId: string;
  slot: SessionSlot | 'mini';
  puzzleId: string;
  difficulty: Difficulty;
  dateKey: string | null;
  challengeCode: string | null;
  techniquePack?: TechniquePackId;
  mistakeReview?: MistakeAttempt[];
  reviewCount?: number;
  timeMs: number;
  mistakes: number;
  hints: number;
  completedAt: number;
}

interface CompletionRow {
  session_id: string;
  slot: Completion['slot'];
  puzzle_id: string;
  difficulty: Difficulty;
  date_key: string | null;
  challenge_code: string | null;
  technique_pack: string | null;
  mistake_review?: string | null;
  review_count?: number;
  time_ms: number;
  mistakes: number;
  hints: number;
  completed_at: number;
}

function parseMistakeReview(value: string | null): MistakeAttempt[] | undefined {
  if (!value) return undefined;
  try {
    const review: unknown = JSON.parse(value);
    return isMistakeReview(review) ? review : undefined;
  } catch {
    return undefined;
  }
}

function toCompletion(row: CompletionRow): Completion {
  const mistakeReview = parseMistakeReview(row.mistake_review ?? null);
  const reviewCount = mistakeReview?.length ?? row.review_count ?? 0;
  return {
    sessionId: row.session_id,
    slot: row.slot,
    puzzleId: row.puzzle_id,
    difficulty: row.difficulty,
    dateKey: row.date_key,
    challengeCode: row.challenge_code,
    ...(isTechniquePackId(row.technique_pack) && { techniquePack: row.technique_pack }),
    ...(mistakeReview && { mistakeReview }),
    ...(reviewCount > 0 && { reviewCount }),
    timeMs: row.time_ms,
    mistakes: row.mistakes,
    hints: row.hints,
    completedAt: row.completed_at,
  };
}

export type HintCost = 'free' | 'credit';

export class InsufficientCreditsError extends Error {
  constructor() {
    super('No hint credits available');
    this.name = 'InsufficientCreditsError';
  }
}

export class OwnChallengeScoreError extends Error {
  constructor() {
    super('This is your result. Ask your friend to share theirs.');
    this.name = 'OwnChallengeScoreError';
  }
}

export class Repository {
  private constructor(private readonly db: Database) {}

  static async open(driver: SqlDriver): Promise<Repository> {
    const db = new Database(driver);
    await db.transaction(async (tx, exec) => {
      const row = await tx.first<{ user_version: number }>('PRAGMA user_version');
      const version = row?.user_version ?? 0;
      if (version > SCHEMA_VERSION) throw new Error(`Saved data is from a newer app version (schema ${version}).`);
      for (let v = version; v < SCHEMA_VERSION; v++) {
        const migration = MIGRATIONS[v];
        if (typeof migration === 'string') await exec(migration);
        else await migration(tx);
      }
      if (version < SCHEMA_VERSION) await exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    return new Repository(db);
  }

  /* ------------------------------ settings ------------------------------ */

  async loadSettings(): Promise<Settings> {
    const row = await this.db.direct((tx) => tx.first<{ value: string }>("SELECT value FROM kv WHERE key = 'settings'"));
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      const saved = JSON.parse(row.value) as Partial<Settings>;
      const boardTheme = isBoardTheme(saved?.boardTheme) ? saved.boardTheme : DEFAULT_SETTINGS.boardTheme;
      return { ...DEFAULT_SETTINGS, ...saved, boardTheme };
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

  async loadModeProgress(key: string): Promise<unknown> {
    const row = await this.db.direct((tx) => tx.first<{ value: string }>('SELECT value FROM kv WHERE key = ?', [`mode:${key}`]));
    if (!row) return null;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return null;
    }
  }

  async saveModeProgress(key: string, progress: unknown): Promise<void> {
    await this.db.direct((tx) => tx.run(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [`mode:${key}`, JSON.stringify(progress ?? null)],
    ));
  }

  /* ------------------------------ sessions ------------------------------ */

  async loadSessions(): Promise<Record<SessionSlot, Session | null>> {
    const rows = await this.db.direct((tx) => tx.all<{ slot: SessionSlot; data: string }>('SELECT slot, data FROM sessions'));
    const out: Record<SessionSlot, Session | null> = { classic: null, daily: null, challenge: null, technique: null, weekly: null };
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

  async deleteSession(slot: SessionSlot, id: string): Promise<void> {
    await this.db.direct((tx) => tx.run('DELETE FROM sessions WHERE slot = ? AND session_id = ?', [slot, id]));
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

  private async insertCompletion(tx: Tx, completion: Completion): Promise<{ recorded: boolean }> {
    const insert = await tx.run(
      `INSERT OR IGNORE INTO completions
         (session_id, slot, puzzle_id, difficulty, date_key, time_ms, mistakes, hints, completed_at, challenge_code, technique_pack, mistake_review, review_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [completion.sessionId, completion.slot, completion.puzzleId, completion.difficulty, completion.dateKey,
        Math.round(completion.timeMs), completion.mistakes, completion.hints, completion.completedAt, completion.challengeCode,
        completion.techniquePack ?? null, completion.mistakeReview?.length ? JSON.stringify(completion.mistakeReview) : null,
        completion.mistakeReview?.length ?? 0],
    );
    return { recorded: insert.changes === 1 };
  }

  /** Records a finished puzzle exactly once and removes its saved session. */
  recordCompletion(session: Session, now: number): Promise<{ recorded: boolean }> {
    return this.db.transaction(async (tx) => {
      const result = await this.insertCompletion(tx, {
        sessionId: session.id, slot: session.slot, puzzleId: session.puzzleId, difficulty: session.difficulty,
        dateKey: session.slot === 'daily' || session.slot === 'weekly' ? session.dateKey : null,
        timeMs: session.elapsedMs, mistakes: session.mistakes, hints: session.hintsUsed, completedAt: now,
        challengeCode: session.slot === 'challenge' ? session.challengeCode ?? null : null,
        techniquePack: session.techniquePack, mistakeReview: session.mistakeReview,
      });
      await tx.run('DELETE FROM sessions WHERE slot = ? AND session_id = ?', [session.slot, session.id]);
      return result;
    });
  }

  recordMiniCompletion(session: MiniClassicSession, now: number): Promise<{ recorded: boolean }> {
    return this.db.transaction(async (tx) => {
      const result = await this.insertCompletion(tx, {
        sessionId: session.id, slot: 'mini', puzzleId: session.progress.puzzleId, difficulty: session.difficulty,
        dateKey: null, timeMs: session.elapsedMs, mistakes: session.mistakes, hints: 0, completedAt: now, challengeCode: null,
      });
      await this.deleteMiniSave(tx, session.id);
      return result;
    });
  }

  deleteMiniClassic(id: string): Promise<void> {
    return this.db.transaction((tx) => this.deleteMiniSave(tx, id));
  }

  private async deleteMiniSave(tx: Tx, id: string): Promise<void> {
    const key = `mode:${MINI_CLASSIC_KEY}`;
    const row = await tx.first<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
    if (row && readMiniClassic(JSON.parse(row.value))?.id === id) {
      await tx.run('DELETE FROM kv WHERE key = ?', [key]);
    }
  }

  async getCompletion(sessionId: string): Promise<Completion | null> {
    const row = await this.db.direct((tx) => tx.first<CompletionRow>('SELECT * FROM completions WHERE session_id = ?', [sessionId]));
    return row ? toCompletion(row) : null;
  }

  async getDailyCompletion(dateKey: string): Promise<Completion | null> {
    const row = await this.db.direct((tx) => tx.first<CompletionRow>("SELECT * FROM completions WHERE slot = 'daily' AND date_key = ?", [dateKey]));
    return row ? toCompletion(row) : null;
  }

  async listDailyCompletionDates(): Promise<string[]> {
    const rows = await this.db.direct((tx) =>
      tx.all<{ date_key: string }>("SELECT date_key FROM completions WHERE slot = 'daily' AND date_key IS NOT NULL ORDER BY date_key"),
    );
    return rows.map((r) => r.date_key);
  }

  async listCompletions(): Promise<Completion[]> {
    const rows = await this.db.direct((tx) => tx.all<CompletionRow>(
      `SELECT session_id, slot, puzzle_id, difficulty, date_key, time_ms, mistakes, hints, completed_at, challenge_code,
         technique_pack, review_count
       FROM completions ORDER BY completed_at`,
    ));
    return rows.map(toCompletion);
  }

  async getFriendChallengeScore(challengeCode: string): Promise<ChallengeScore | null> {
    const row = await this.db.direct((tx) => tx.first<{ result_code: string }>(
      'SELECT result_code FROM challenge_scores WHERE challenge_code = ?', [challengeCode],
    ));
    if (!row) return null;
    try {
      const score = decodeChallengeScore(row.result_code);
      return score.challengeCode === challengeCode ? score : null;
    } catch {
      return null;
    }
  }

  async saveFriendChallengeScore(score: ChallengeScore): Promise<void> {
    const resultCode = encodeChallengeScore(score);
    const { challengeCode, sessionId } = decodeChallengeScore(resultCode);
    await this.db.transaction(async (tx) => {
      const own = await tx.first('SELECT 1 FROM completions WHERE session_id = ? AND challenge_code = ?', [sessionId, challengeCode]);
      if (own) throw new OwnChallengeScoreError();
      await tx.run(
        `INSERT INTO challenge_scores (challenge_code, result_code) VALUES (?, ?)
         ON CONFLICT (challenge_code) DO UPDATE SET result_code = excluded.result_code`,
        [challengeCode, resultCode],
      );
    });
  }
}
