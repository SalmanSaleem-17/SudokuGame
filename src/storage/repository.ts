/**
 * All persisted data: settings, sessions, the hint-credit wallet and completions.
 * Reward grants, credit spends and their session updates are single transactions.
 */
import type { Difficulty } from '../engine/grader';
import { decodeChallengeScore, encodeChallengeScore, type ChallengeScore } from '../game/challenge';
import { isMistakeReview, isTechniquePackId, type MistakeAttempt, type TechniquePackId } from '../game/learning';
import { levelStars } from '../game/levels';
import { MINI_CLASSIC_KEY, MINI_LEVEL_KEY, readMiniClassic, type MiniClassicSession } from '../game/miniClassic';
import { Session, SessionSlot, isValidSession } from '../game/session';
import { DEFAULT_SETTINGS, Settings, isBoardTheme, isReminderHour } from '../game/settings';
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
  async (tx) => {
    // Levels mode: the stage number and stars of a finished level. Safe to run on a database that already has them.
    const columns = new Set((await tx.all<{ name: string }>('PRAGMA table_info(completions)')).map(({ name }) => name));
    if (!columns.has('level_number')) await tx.run('ALTER TABLE completions ADD COLUMN level_number INTEGER');
    if (!columns.has('stars')) await tx.run('ALTER TABLE completions ADD COLUMN stars INTEGER');
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
  /** Levels mode: the stage number and the stars earned (1 to 3). */
  level?: number;
  stars?: number;
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
  level_number?: number | null;
  stars?: number | null;
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
    ...(typeof row.level_number === 'number' && { level: row.level_number, stars: row.stars ?? 1 }),
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

/** Everything a backup file carries. Hint credits and reward history stay on the device. */
export interface BackupData {
  /** The game's first name. Kept so backup files saved before the rename still restore. */
  app: 'sudoku-studio';
  schema: number;
  exportedAt: number;
  kv: { key: string; value: string }[];
  sessions: { slot: string; session_id: string; data: string; updated_at: number }[];
  completions: Record<string, string | number | null>[];
  challengeScores: { challenge_code: string; result_code: string }[];
}

export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

const COMPLETION_COLUMNS = [
  'session_id', 'slot', 'puzzle_id', 'difficulty', 'date_key', 'time_ms', 'mistakes', 'hints', 'completed_at',
  'challenge_code', 'technique_pack', 'mistake_review', 'review_count', 'level_number', 'stars',
] as const;

function readBackup(value: unknown): BackupData {
  const data = value as BackupData | null;
  const text = (v: unknown) => typeof v === 'string';
  const whole = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!data || typeof data !== 'object' || data.app !== 'sudoku-studio') {
    throw new InvalidBackupError('This file is not a Sudoku Vault backup.');
  }
  if (!whole(data.schema) || data.schema > SCHEMA_VERSION) {
    throw new InvalidBackupError('This backup was made by a newer version of the app. Update the app and try again.');
  }
  const ok =
    Array.isArray(data.kv) && data.kv.every((row) => row && text(row.key) && text(row.value)) &&
    Array.isArray(data.sessions) && data.sessions.every((row) => row && text(row.slot) && text(row.session_id) && text(row.data) && whole(row.updated_at)) &&
    Array.isArray(data.completions) && data.completions.every((row) =>
      row && text(row.session_id) && text(row.slot) && text(row.puzzle_id) && text(row.difficulty) &&
      whole(row.time_ms) && whole(row.mistakes) && whole(row.hints) && whole(row.completed_at)) &&
    Array.isArray(data.challengeScores) && data.challengeScores.every((row) => row && text(row.challenge_code) && text(row.result_code));
  if (!ok) throw new InvalidBackupError('This backup file is damaged and cannot be restored.');
  return data;
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
      const reminderHour = isReminderHour(saved?.reminderHour) ? saved.reminderHour : DEFAULT_SETTINGS.reminderHour;
      return { ...DEFAULT_SETTINGS, ...saved, boardTheme, reminderHour, reminder: saved?.reminder === true };
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
    const out: Record<SessionSlot, Session | null> = { classic: null, daily: null, challenge: null, technique: null, weekly: null, level: null };
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

  /** Recorded grant ids that start with `prefix`, for rewards that are claimed once: unlocked themes, a day's gift. */
  async listGrantIds(prefix: string): Promise<string[]> {
    const rows = await this.db.direct((tx) =>
      tx.all<{ grant_id: string }>('SELECT grant_id FROM reward_grants WHERE substr(grant_id, 1, ?) = ? ORDER BY grant_id', [prefix.length, prefix]));
    return rows.map((row) => row.grant_id);
  }

  /** Records a grant id once. Returns false when that id was already used. */
  private async claim(tx: Tx, grantId: string, credits: number, now: number): Promise<boolean> {
    const insert = await tx.run('INSERT OR IGNORE INTO reward_grants (grant_id, credits, created_at) VALUES (?, ?, ?)', [grantId, credits, now]);
    if (insert.changes !== 1) return false;
    if (credits > 0) await tx.run('UPDATE wallet SET credits = credits + ? WHERE id = 1', [credits]);
    return true;
  }

  /** Pays several gameplay rewards together. Ids that were already paid are skipped. */
  grantRewards<T extends { id: string; credits: number }>(grants: readonly T[], now: number): Promise<{ granted: T[]; balance: number }> {
    return this.db.transaction(async (tx) => {
      const granted: T[] = [];
      for (const grant of grants) {
        if (await this.claim(tx, grant.id, grant.credits, now)) granted.push(grant);
      }
      return { granted, balance: await this.balance(tx) };
    });
  }

  /**
   * Applies an ad reward that changes a saved game instead of the credit balance (an extra
   * mistake). The grant id and the session write commit together, so a repeated callback
   * for the same ad cannot apply the reward twice.
   */
  grantSessionReward(grantId: string, session: Session, now: number): Promise<{ granted: boolean; balance: number }> {
    return this.db.transaction(async (tx) => {
      const granted = await this.claim(tx, grantId, 0, now);
      if (granted) await this.writeSession(tx, session, now);
      return { granted, balance: await this.balance(tx) };
    });
  }

  /** Applies an ad reward that is stored as mode progress (a repaired streak day). */
  grantModeReward(grantId: string, key: string, progress: unknown, now: number): Promise<{ granted: boolean; balance: number }> {
    return this.db.transaction(async (tx) => {
      const granted = await this.claim(tx, grantId, 0, now);
      if (granted) {
        await tx.run(
          'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          [`mode:${key}`, JSON.stringify(progress ?? null)],
        );
      }
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
         (session_id, slot, puzzle_id, difficulty, date_key, time_ms, mistakes, hints, completed_at, challenge_code, technique_pack, mistake_review, review_count, level_number, stars)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [completion.sessionId, completion.slot, completion.puzzleId, completion.difficulty, completion.dateKey,
        Math.round(completion.timeMs), completion.mistakes, completion.hints, completion.completedAt, completion.challengeCode,
        completion.techniquePack ?? null, completion.mistakeReview?.length ? JSON.stringify(completion.mistakeReview) : null,
        completion.mistakeReview?.length ?? 0, completion.level ?? null, completion.stars ?? null],
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
        ...(session.slot === 'level' && session.level && {
          level: session.level.number, stars: levelStars(session.difficulty, session.elapsedMs),
        }),
      });
      await tx.run('DELETE FROM sessions WHERE slot = ? AND session_id = ?', [session.slot, session.id]);
      return result;
    });
  }

  /** Records a finished small-board game: a Play Now mini, or an Easy or Medium level. */
  recordMiniCompletion(session: MiniClassicSession, now: number): Promise<{ recorded: boolean }> {
    return this.db.transaction(async (tx) => {
      const result = await this.insertCompletion(tx, {
        sessionId: session.id, slot: session.level ? 'level' : 'mini', puzzleId: session.progress.puzzleId, difficulty: session.difficulty,
        dateKey: null, timeMs: session.elapsedMs, mistakes: session.mistakes, hints: 0, completedAt: now, challengeCode: null,
        ...(session.level && { level: session.level.number, stars: levelStars(session.difficulty, session.elapsedMs) }),
      });
      await this.deleteMiniSave(tx, session.id, session.level ? MINI_LEVEL_KEY : MINI_CLASSIC_KEY);
      return result;
    });
  }

  deleteMiniClassic(id: string, saveKey: string = MINI_CLASSIC_KEY): Promise<void> {
    return this.db.transaction((tx) => this.deleteMiniSave(tx, id, saveKey));
  }

  private async deleteMiniSave(tx: Tx, id: string, saveKey: string): Promise<void> {
    const key = `mode:${saveKey}`;
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
         technique_pack, review_count, level_number, stars
       FROM completions ORDER BY completed_at`,
    ));
    return rows.map(toCompletion);
  }

  /* ---------------------------- reset and backup ------------------------ */

  /**
   * Erases games, results and statistics. Settings, hint credits and the record of rewards
   * already paid are kept, so a reset can never be used to earn the same reward again.
   */
  resetProgress(): Promise<void> {
    return this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM sessions');
      await tx.run('DELETE FROM completions');
      await tx.run('DELETE FROM challenge_scores');
      await tx.run("DELETE FROM kv WHERE key LIKE 'mode:%'");
    });
  }

  exportData(now: number): Promise<BackupData> {
    return this.db.direct(async (tx) => ({
      app: 'sudoku-studio' as const,
      schema: SCHEMA_VERSION,
      exportedAt: now,
      kv: await tx.all<BackupData['kv'][number]>('SELECT key, value FROM kv ORDER BY key'),
      sessions: await tx.all<BackupData['sessions'][number]>('SELECT slot, session_id, data, updated_at FROM sessions ORDER BY slot'),
      completions: await tx.all<BackupData['completions'][number]>(`SELECT ${COMPLETION_COLUMNS.join(', ')} FROM completions ORDER BY completed_at`),
      challengeScores: await tx.all<BackupData['challengeScores'][number]>('SELECT challenge_code, result_code FROM challenge_scores ORDER BY challenge_code'),
    }));
  }

  /** Replaces games, results and settings with a backup. Nothing changes if the file is invalid. */
  importData(value: unknown): Promise<void> {
    const data = readBackup(value);
    return this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM sessions');
      await tx.run('DELETE FROM completions');
      await tx.run('DELETE FROM challenge_scores');
      await tx.run('DELETE FROM kv');
      for (const row of data.kv) await tx.run('INSERT INTO kv (key, value) VALUES (?, ?)', [row.key, row.value]);
      for (const row of data.sessions) {
        let valid = false;
        try {
          const session: unknown = JSON.parse(row.data);
          valid = isValidSession(session) && session.slot === row.slot && session.id === row.session_id;
        } catch {
          valid = false;
        }
        if (valid) await tx.run('INSERT INTO sessions (slot, session_id, data, updated_at) VALUES (?, ?, ?, ?)', [row.slot, row.session_id, row.data, row.updated_at]);
      }
      const placeholders = COMPLETION_COLUMNS.map(() => '?').join(', ');
      for (const row of data.completions) {
        await tx.run(
          `INSERT OR IGNORE INTO completions (${COMPLETION_COLUMNS.join(', ')}) VALUES (${placeholders})`,
          COMPLETION_COLUMNS.map((column) => row[column] ?? (column === 'review_count' ? 0 : null)),
        );
      }
      for (const row of data.challengeScores) {
        await tx.run('INSERT OR IGNORE INTO challenge_scores (challenge_code, result_code) VALUES (?, ?)', [row.challenge_code, row.result_code]);
      }
    });
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
