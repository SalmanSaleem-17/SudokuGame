import { puzzlesOf } from '../data/pool';
import { DIFFICULTIES, type Difficulty } from '../engine/grader';
import { parseGrid } from '../engine/grid';
import { alternatePuzzleCount, getAlternatePuzzle } from './alternate';
import type { AlternatePuzzle, AlternateSize } from './alternateRules';
import { PLAY_BOARD_SIZES, miniModeForDifficulty } from './playFormat';

export const SPEED_PROGRESS_KEY = 'speed-round';
export const SPEED_MINUTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type SpeedMinutes = (typeof SPEED_MINUTES)[number];

export interface SpeedOptions {
  difficulty: Difficulty;
  minutes: SpeedMinutes;
}

const LEGACY_FORMAT = { difficulty: 'legacy', minutes: 1 } as const;
export type SpeedFormat = SpeedOptions | typeof LEGACY_FORMAT;
export const DEFAULT_SPEED_OPTIONS: SpeedOptions = { difficulty: 'easy', minutes: 1 };

type SpeedRecordKey = `${Difficulty}-${SpeedMinutes}` | 'legacy-1';

interface SpeedResult {
  startedAt: number;
  score: number;
  mistakes: number;
}

export interface SpeedRound extends SpeedResult {
  format: SpeedFormat;
  puzzleId: string;
  values: number[];
  bestBefore: number;
  finished: boolean;
  /** The round has used its one ad extension. */
  extended?: boolean;
  /** Extension time waiting to start: the clock stays still until the player is back from the ad. */
  pausedMs?: number;
}

export interface SpeedRecord {
  best: number;
  rounds: number;
  correct: number;
  mistakes: number;
  recent: readonly SpeedResult[];
}

export interface SpeedProgress {
  version: 2;
  records: Partial<Record<SpeedRecordKey, SpeedRecord>>;
  round: SpeedRound | null;
}

const MAX_RECENT = 5;
const EMPTY_RECORD: SpeedRecord = { best: 0, rounds: 0, correct: 0, mistakes: 0, recent: [] };
export const EMPTY_SPEED_PROGRESS: SpeedProgress = { version: 2, records: {}, round: null };

interface SpeedPuzzle {
  id: string;
  size: AlternateSize;
  givens: readonly number[];
  solution: readonly number[];
  alternate?: AlternatePuzzle;
}

const catalogs = new Map<SpeedFormat['difficulty'], readonly SpeedPuzzle[]>();

export function speedBoardSize(difficulty: SpeedFormat['difficulty']): AlternateSize {
  return difficulty === 'legacy' ? 9 : PLAY_BOARD_SIZES[difficulty];
}

function speedCatalog(difficulty: SpeedFormat['difficulty']): readonly SpeedPuzzle[] {
  const cached = catalogs.get(difficulty);
  if (cached) return cached;
  let puzzles: SpeedPuzzle[];
  const mode = difficulty === 'legacy' ? null : miniModeForDifficulty(difficulty);
  if (mode) {
    puzzles = Array.from({ length: alternatePuzzleCount(mode) }, (_, index) => {
      const puzzle = getAlternatePuzzle(mode, index);
      return { id: puzzle.id, size: puzzle.size, givens: puzzle.givens, solution: puzzle.solution, alternate: puzzle };
    });
  } else {
    puzzles = puzzlesOf(difficulty === 'legacy' ? 'easy' : difficulty).map((puzzle) => ({
      id: puzzle.id,
      size: 9,
      givens: parseGrid(puzzle.givens),
      solution: parseGrid(puzzle.solution),
    }));
  }
  catalogs.set(difficulty, puzzles);
  return puzzles;
}

export function speedPuzzleForRound(round: Pick<SpeedRound, 'format' | 'puzzleId'>): SpeedPuzzle | undefined {
  return speedCatalog(round.format.difficulty).find((puzzle) => puzzle.id === round.puzzleId);
}

function keyOf(format: SpeedFormat): SpeedRecordKey {
  return format.difficulty === 'legacy' ? 'legacy-1' : `${format.difficulty}-${format.minutes}`;
}

export function speedRecord(progress: SpeedProgress, format: SpeedFormat): SpeedRecord {
  return progress.records[keyOf(format)] ?? EMPTY_RECORD;
}

export function legacySpeedRecord(progress: SpeedProgress): SpeedRecord | undefined {
  return progress.records['legacy-1'];
}

/** Includes time spent away from the screen and ignores wall-clock rollbacks during play. */
export function createSpeedClock(wall = Date.now, monotonic = () => performance.now()): () => number {
  let last = wall();
  let lastTick = monotonic();
  return () => {
    const tick = monotonic();
    last = Math.max(wall(), last + Math.max(0, tick - lastTick));
    lastTick = tick;
    return last;
  };
}

export function speedRemainingMs(round: SpeedRound, now: number): number {
  if (!round.finished && round.pausedMs !== undefined) return round.pausedMs;
  const elapsed = now - round.startedAt;
  return round.finished || elapsed < 0 ? 0 : Math.max(0, round.format.minutes * 60_000 - elapsed);
}

function addResult(record: SpeedRecord, { startedAt, score, mistakes }: SpeedResult): SpeedRecord {
  return {
    best: Math.max(record.best, score),
    rounds: record.rounds + 1,
    correct: record.correct + score,
    mistakes: record.mistakes + mistakes,
    recent: [{ startedAt, score, mistakes }, ...record.recent.slice(0, MAX_RECENT - 1)],
  };
}

export function finishSpeedRound(progress: SpeedProgress, now: number): SpeedProgress {
  const { round } = progress;
  if (!round || round.finished || speedRemainingMs(round, now) > 0) return progress;
  return closeRound(progress, round);
}

/** Counts the round's result and marks it finished. */
function closeRound(progress: SpeedProgress, round: SpeedRound): SpeedProgress {
  const record = addResult(speedRecord(progress, round.format), round);
  return { ...progress, records: { ...progress.records, [keyOf(round.format)]: record }, round: { ...round, pausedMs: undefined, finished: true } };
}

/** Extra play time one optional ad adds to a finished round. */
export const SPEED_EXTENSION_MS = 30_000;

export function canExtendSpeedRound(round: SpeedRound | null): round is SpeedRound {
  return !!round && round.finished && !round.extended;
}

/**
 * Reopens a finished round with extra time, once. The finished result is taken back out of
 * the records so the longer round is counted once when it ends. The extra time does not
 * start running until `resumeSpeedRound`.
 */
export function extendSpeedRound(progress: SpeedProgress): SpeedProgress | null {
  const { round } = progress;
  if (!canExtendSpeedRound(round)) return null;
  const key = keyOf(round.format);
  const record = speedRecord(progress, round.format);
  const counted = record.recent.findIndex((result) => result.startedAt === round.startedAt);
  const reverted: SpeedRecord = {
    best: round.bestBefore,
    rounds: Math.max(0, record.rounds - 1),
    correct: Math.max(0, record.correct - round.score),
    mistakes: Math.max(0, record.mistakes - round.mistakes),
    recent: counted < 0 ? record.recent : record.recent.filter((_, index) => index !== counted),
  };
  return {
    ...progress,
    records: { ...progress.records, [key]: reverted },
    round: { ...round, finished: false, extended: true, pausedMs: SPEED_EXTENSION_MS },
  };
}

/** Starts the clock on a waiting extension. */
export function resumeSpeedRound(progress: SpeedProgress, now: number): SpeedProgress {
  const { round } = progress;
  if (!round || round.finished || round.pausedMs === undefined) return progress;
  const { pausedMs, ...running } = round;
  return { ...progress, round: { ...running, startedAt: Math.floor(now) - (round.format.minutes * 60_000 - pausedMs) } };
}

/** A round can finish while the quit confirmation is open. Keep that result. */
export function quitSpeedRound(progress: SpeedProgress, startedAt: number, now: number): SpeedProgress {
  const { round } = progress;
  if (!round || round.startedAt !== startedAt || round.finished) return progress;
  const current = finishSpeedRound(progress, now);
  if (current !== progress) return current;
  // An extended round already had a result, so ending it early keeps the score so far.
  return round.extended ? closeRound(progress, round) : { ...progress, round: null };
}

export function startSpeedRound(progress: SpeedProgress, format: SpeedOptions, now: number, random = Math.random): SpeedProgress {
  const current = finishSpeedRound(progress, now);
  if ((current.round && !current.round.finished) || !isSpeedOptions(format)) return current;
  const puzzles = speedCatalog(format.difficulty);
  const previous = puzzles.findIndex((puzzle) => puzzle.id === current.round?.puzzleId);
  const skipPrevious = previous !== -1 && puzzles.length > 1;
  const choice = Math.floor(random() * (puzzles.length - Number(skipPrevious)));
  const puzzle = puzzles[skipPrevious && choice >= previous ? choice + 1 : choice];

  return {
    ...current,
    round: {
      format: { ...format },
      startedAt: Math.floor(now),
      puzzleId: puzzle.id,
      values: puzzle.givens.slice(),
      score: 0,
      mistakes: 0,
      bestBefore: speedRecord(current, format).best,
      finished: false,
    },
  };
}

export function enterSpeedDigit(progress: SpeedProgress, cell: number, digit: number, now: number): SpeedProgress {
  const current = finishSpeedRound(progress, now);
  const { round } = current;
  if (!round || round.finished || round.pausedMs !== undefined || !Number.isInteger(cell) || !Number.isInteger(digit)
    || round.values[cell] !== 0 || digit < 1 || digit > speedBoardSize(round.format.difficulty)) return current;
  const puzzles = speedCatalog(round.format.difficulty);
  const index = puzzles.findIndex((puzzle) => puzzle.id === round.puzzleId);
  const puzzle = puzzles[index];
  if (puzzle.solution[cell] !== digit) {
    return { ...current, round: { ...round, mistakes: round.mistakes + 1 } };
  }

  const values = round.values.slice();
  values[cell] = digit;
  const nextBoard = values.includes(0) ? null : puzzles[(index + 1) % puzzles.length];
  return {
    ...current,
    round: {
      ...round,
      score: round.score + 1,
      values: nextBoard ? nextBoard.givens.slice() : values,
      puzzleId: nextBoard?.id ?? round.puzzleId,
    },
  };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSpeedOptions(format: Partial<SpeedFormat> | null): format is SpeedOptions {
  return !!format && DIFFICULTIES.some((value) => value === format.difficulty) && SPEED_MINUTES.some((value) => value === format.minutes);
}

function isSpeedResult<T extends Partial<SpeedResult>>(value: T | null): value is T & SpeedResult {
  return !!value && isCount(value.startedAt) && isCount(value.score) && isCount(value.mistakes);
}

function readRecord(value: Partial<SpeedRecord> | null): SpeedRecord | undefined {
  if (!value || !isCount(value.best) || !isCount(value.rounds) || !isCount(value.correct) || !isCount(value.mistakes)) return undefined;
  return { best: value.best, rounds: value.rounds, correct: value.correct, mistakes: value.mistakes,
    recent: Array.isArray(value.recent) ? value.recent.slice(0, MAX_RECENT).filter(isSpeedResult) : [] };
}

function readRound(value: Partial<SpeedRound> | null): SpeedRound | null {
  if (!value || !isSpeedResult(value) || !isCount(value.bestBefore) || typeof value.finished !== 'boolean') return null;
  const format = value.format;
  if (!format || (!isSpeedOptions(format) && (format.difficulty !== 'legacy' || format.minutes !== 1))) return null;
  const puzzleId = value.puzzleId;
  if (typeof puzzleId !== 'string') return null;
  const puzzle = speedPuzzleForRound({ format, puzzleId });
  const values = value.values;
  if (!puzzle || !Array.isArray(values) || values.length !== puzzle.givens.length || !values.includes(0)) return null;
  if (!puzzle.givens.every((given, cell) => given > 0 ? values[cell] === given : values[cell] === 0 || values[cell] === puzzle.solution[cell])) return null;
  return { format, puzzleId, values, startedAt: value.startedAt, score: value.score, mistakes: value.mistakes,
    bestBefore: value.bestBefore, finished: value.finished,
    ...(value.extended === true && { extended: true }),
    ...(isCount(value.pausedMs) && value.pausedMs <= SPEED_EXTENSION_MS && !value.finished && { pausedMs: value.pausedMs }) };
}

/** Keeps usable scores even when a saved board is unavailable or an earlier version saved it. */
export function readSpeedProgress(value: unknown): SpeedProgress {
  if (!value || typeof value !== 'object') return EMPTY_SPEED_PROGRESS;
  const saved = value as Partial<Omit<SpeedProgress, 'version'>> & { version?: number; best?: unknown };
  if (saved.version === 1 && isCount(saved.best)) {
    const checked = readRound(saved.round ? { ...saved.round, format: LEGACY_FORMAT } : null);
    const round = checked && checked.score <= saved.best && checked.bestBefore <= saved.best ? checked : null;
    const best = round && !round.finished ? round.bestBefore : saved.best;
    const prior = { ...EMPTY_RECORD, best };
    return {
      version: 2,
      records: { 'legacy-1': round?.finished ? addResult(prior, round) : prior },
      round,
    };
  }
  if (saved.version !== 2) return EMPTY_SPEED_PROGRESS;
  const records: SpeedProgress['records'] = {};
  const formats: SpeedFormat[] = [LEGACY_FORMAT, ...DIFFICULTIES.flatMap((difficulty) => SPEED_MINUTES.map((minutes) => ({ difficulty, minutes })))];
  for (const format of formats) {
    const key = keyOf(format);
    const record = readRecord(saved.records?.[key] ?? null);
    if (record) records[key] = record;
  }
  return { version: 2, records, round: readRound(saved.round ?? null) };
}
