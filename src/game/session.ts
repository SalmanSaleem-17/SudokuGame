/**
 * Puzzle session state and the pure operations on it. No storage or UI code here.
 */
import type { Difficulty } from '../engine/grader';
import { PEERS, bit, computeCandidates, parseGrid } from '../engine/grid';
import type { HintResult } from '../engine/hints';
import type { PuzzleRecord } from '../engine/pool';
import type { Challenge } from './challenge';
import { isWeeklyDifficulty, isWeeklyWeekKey } from './events';
import { MAX_MISTAKE_REVIEW, isMistakeReview, isTechniquePackId, recordMistake, type MistakeAttempt, type TechniquePackId } from './learning';

export const SESSION_SLOTS = ['classic', 'daily', 'challenge', 'technique', 'weekly', 'level'] as const;
export type SessionSlot = (typeof SESSION_SLOTS)[number];

export const SESSION_VERSION = 1;
const MAX_UNDO = 400;

export interface SessionRules {
  timerMinutes: 0 | 5 | 10 | 15;
  mistakes: 'off' | 3 | 5 | 'unlimited';
}

export const DEFAULT_SESSION_RULES: Readonly<SessionRules> = { timerMinutes: 0, mistakes: 'unlimited' };
export type SessionFailure = 'time' | 'mistakes';

export function isSessionRules(value: unknown): value is SessionRules {
  const rules = value as SessionRules | null;
  return !!rules && [0, 5, 10, 15].includes(rules.timerMinutes) && ['off', 3, 5, 'unlimited'].includes(rules.mistakes);
}

/** The rules of one Levels stage, copied into the session when it starts. */
export interface SessionLevel {
  number: number;
  timeLimitSec: number;
  mistakeLimit: number;
  /** Extra mistakes earned from optional ads during this attempt. */
  extraMistakes: number;
}

/** How many colours a player can mark a cell with; 0 means unmarked. */
export const TINT_COUNT = 3;

type CellState = [cell: number, value: number, notes: number];

/** The values and notes to restore for all cells affected by one action. */
export interface UndoEntry {
  cells: CellState[];
}

/** The explanation the player paid for, tied to the board it was computed from. */
export interface StoredHint {
  boardKey: string;
  result: Extract<HintResult, { kind: 'steps' }>;
}

export interface Session {
  version: number;
  id: string;
  slot: SessionSlot;
  puzzleId: string;
  difficulty: Difficulty;
  /** Local calendar date for a daily puzzle or Monday starting a weekly challenge. */
  dateKey: string | null;
  /** A shared round's identity, carried through to its saved result. */
  challengeCode?: string;
  /** The technique pack this puzzle was opened from. */
  techniquePack?: TechniquePackId;
  givens: number[];
  solution: number[];
  values: number[];
  /** Pencil marks per cell as a 9-bit mask. */
  notes: number[];
  undo: UndoEntry[];
  /** Older saves have no redo history or custom rules. */
  redo?: UndoEntry[];
  rules?: SessionRules;
  /** Present only for the Levels mode. */
  level?: SessionLevel;
  /** Player colour marks per cell (0 to TINT_COUNT). Absent until the first mark. */
  tints?: number[];
  /** Active play time in milliseconds; excludes paused, backgrounded and ad time. */
  elapsedMs: number;
  mistakes: number;
  mistakeReview?: MistakeAttempt[];
  hintsUsed: number;
  freeHintUsed: boolean;
  hint: StoredHint | null;
  completed: boolean;
  startedAt: number;
}

export function createSession(
  puzzle: PuzzleRecord,
  slot: SessionSlot,
  id: string,
  now: number,
  dateKey: string | null = null,
  rules?: SessionRules,
): Session {
  const givens = parseGrid(puzzle.givens);
  return {
    version: SESSION_VERSION,
    id,
    slot,
    puzzleId: puzzle.id,
    difficulty: puzzle.difficulty,
    dateKey,
    givens,
    solution: parseGrid(puzzle.solution),
    values: givens.slice(),
    notes: new Array(81).fill(0),
    undo: [],
    ...((slot === 'classic' || slot === 'challenge') && rules ? { rules: { ...rules } } : {}),
    elapsedMs: 0,
    mistakes: 0,
    hintsUsed: 0,
    freeHintUsed: false,
    hint: null,
    completed: false,
    startedAt: now,
  };
}

export function createChallengeSession(challenge: Challenge, id: string, now: number): Session {
  return {
    ...createSession(challenge.puzzle, 'challenge', id, now, null, challenge.rules),
    challengeCode: challenge.code,
  };
}

export function createLevelSession(puzzle: PuzzleRecord, level: Omit<SessionLevel, 'extraMistakes'>, id: string, now: number): Session {
  return { ...createSession(puzzle, 'level', id, now), level: { ...level, extraMistakes: 0 } };
}

export function createTechniqueSession(puzzle: PuzzleRecord, techniquePack: TechniquePackId, id: string, now: number): Session {
  return { ...createSession(puzzle, 'technique', id, now), techniquePack };
}

export function getSessionRules(session: Session): Readonly<SessionRules> {
  return session.slot === 'classic' || session.slot === 'challenge'
    ? session.rules ?? DEFAULT_SESSION_RULES
    : DEFAULT_SESSION_RULES;
}

/** The number of mistakes that ends the game, or null when mistakes never end it. */
export function getMistakeLimit(session: Session): number | null {
  if (session.slot === 'level' && session.level) return session.level.mistakeLimit + session.level.extraMistakes;
  const { mistakes } = getSessionRules(session);
  return typeof mistakes === 'number' ? mistakes : null;
}

export function getTimeLimitMs(session: Session): number | null {
  if (session.slot === 'level' && session.level) return session.level.timeLimitSec > 0 ? session.level.timeLimitSec * 1000 : null;
  const { timerMinutes } = getSessionRules(session);
  return timerMinutes === 0 ? null : timerMinutes * 60_000;
}

export function getSessionFailure(session: Session): SessionFailure | null {
  if (session.completed) return null;
  const mistakeLimit = getMistakeLimit(session);
  if (mistakeLimit !== null && session.mistakes >= mistakeLimit) return 'mistakes';
  const timeLimitMs = getTimeLimitMs(session);
  return timeLimitMs !== null && session.elapsedMs >= timeLimitMs ? 'time' : null;
}

export const boardKey = (values: readonly number[]) => values.join('');
export const isGiven = (session: Session, cell: number) => session.givens[cell] !== 0;
const isComplete = (session: Session, values: number[]) => values.every((v, i) => v === session.solution[i]);
const isFinished = (session: Session) => session.completed || getSessionFailure(session) !== null;

function replaceCells(session: Session, cells: CellState[]) {
  const values = session.values.slice();
  const notes = session.notes.slice();
  const previous: UndoEntry = { cells: [] };
  for (const [cell, value, cellNotes] of cells) {
    previous.cells.push([cell, values[cell], notes[cell]]);
    values[cell] = value;
    notes[cell] = cellNotes;
  }
  return { values, notes, previous };
}

/** Applies cell changes as a single undoable action. Returns the same session if nothing changes. */
function commit(session: Session, changes: CellState[], mistakes = session.mistakes): Session {
  const real = changes.filter(([cell, value, notes]) => session.values[cell] !== value || session.notes[cell] !== notes);
  if (real.length === 0) return session;
  const { values, notes, previous } = replaceCells(session, real);
  const undo = [...session.undo.slice(1 - MAX_UNDO), previous];
  return { ...session, values, notes, undo, redo: [], mistakes, completed: isComplete(session, values) };
}

export interface EntryOptions {
  /** Remove the placed digit from notes in the cell's row, column and box. */
  smartNotes: boolean;
}

/** Places a digit. Entering the digit a cell already holds clears it. */
export function enterDigit(session: Session, cell: number, digit: number, options: EntryOptions): Session {
  if (isFinished(session) || isGiven(session, cell) || !Number.isInteger(digit) || digit < 1 || digit > 9) return session;
  if (session.values[cell] === digit) return eraseCell(session, cell);
  const changes: CellState[] = [[cell, digit, 0]];
  if (options.smartNotes) {
    const mask = bit(digit);
    for (const p of PEERS[cell]) {
      if (session.values[p] === 0 && session.notes[p] & mask) {
        changes.push([p, 0, session.notes[p] & ~mask]);
      }
    }
  }
  const incorrect = digit !== session.solution[cell];
  const counted = incorrect && getSessionRules(session).mistakes !== 'off';
  const next = commit(session, changes, session.mistakes + Number(counted));
  if (!incorrect || next === session) return next;
  const attempt = recordMistake(session.values, session.solution, cell, digit);
  return { ...next, mistakeReview: [...(session.mistakeReview ?? []).slice(1 - MAX_MISTAKE_REVIEW), attempt] };
}

export function toggleNote(session: Session, cell: number, digit: number): Session {
  if (isFinished(session) || isGiven(session, cell) || session.values[cell] !== 0) return session;
  return commit(session, [[cell, 0, session.notes[cell] ^ bit(digit)]]);
}

export function eraseCell(session: Session, cell: number): Session {
  if (isFinished(session) || isGiven(session, cell)) return session;
  return commit(session, [[cell, 0, 0]]);
}

/** Fills every empty cell's notes with the digits its row, column and box still allow. */
export function fillNotes(session: Session): Session {
  if (isFinished(session)) return session;
  const candidates = computeCandidates(session.values);
  const changes: CellState[] = [];
  for (let cell = 0; cell < 81; cell++) {
    if (session.values[cell] === 0) changes.push([cell, 0, candidates[cell]]);
  }
  return commit(session, changes);
}

/** Marks a cell with a colour, or clears the mark with 0. Marks are not part of undo. */
export function setTint(session: Session, cell: number, tint: number): Session {
  if (isFinished(session) || !Number.isInteger(tint) || tint < 0 || tint > TINT_COUNT) return session;
  if ((session.tints?.[cell] ?? 0) === tint) return session;
  const tints = session.tints?.slice() ?? new Array<number>(81).fill(0);
  tints[cell] = tint;
  return { ...session, tints };
}

/** Reverts the latest action, restoring every cell and note it touched. */
export function undoMove(session: Session): Session {
  const entry = session.undo[session.undo.length - 1];
  if (!entry || isFinished(session)) return session;
  const { values, notes, previous } = replaceCells(session, entry.cells);
  return { ...session, values, notes, undo: session.undo.slice(0, -1), redo: [...(session.redo ?? []), previous] };
}

/** Replays an undone action without counting its mistakes a second time. */
export function redoMove(session: Session): Session {
  const history = session.redo;
  if (!history?.length || isFinished(session)) return session;
  const { values, notes, previous } = replaceCells(session, history[history.length - 1].cells);
  const undo = [...session.undo.slice(1 - MAX_UNDO), previous];
  return { ...session, values, notes, undo, redo: history.slice(0, -1), completed: isComplete(session, values) };
}

/** Clears every entry that does not match the solution, as one undoable action. */
export function clearIncorrect(session: Session): Session {
  if (isFinished(session)) return session;
  const changes: CellState[] = [];
  for (let cell = 0; cell < 81; cell++) {
    const v = session.values[cell];
    if (v !== 0 && !isGiven(session, cell) && v !== session.solution[cell]) {
      changes.push([cell, 0, 0]);
    }
  }
  return commit(session, changes);
}

export function incorrectCells(session: Session): number[] {
  const out: number[] = [];
  for (let cell = 0; cell < 81; cell++) {
    if (session.values[cell] !== 0 && session.values[cell] !== session.solution[cell]) out.push(cell);
  }
  return out;
}

/** How many of each digit are on the board; index 1-9. */
export function digitCounts(values: readonly number[]): number[] {
  const counts = new Array<number>(10).fill(0);
  for (const v of values) counts[v]++;
  return counts;
}

export function isSessionLevel(value: unknown): value is SessionLevel {
  const level = value as SessionLevel | null;
  const whole = (n: unknown, min: number) => typeof n === 'number' && Number.isInteger(n) && n >= min;
  return !!level && whole(level.number, 1) && whole(level.timeLimitSec, 0) && whole(level.mistakeLimit, 1) && whole(level.extraMistakes, 0);
}

/** Guards against loading a corrupt or incompatible saved session. */
export function isValidSession(value: unknown): value is Session {
  const s = value as Session | null;
  const grid = (g: unknown) => Array.isArray(g) && g.length === 81 && g.every((n) => Number.isInteger(n));
  const validHistory = (history: UndoEntry[]) =>
    Array.isArray(history) && history.every((entry) => !!entry && Array.isArray(entry.cells) && entry.cells.every(
      (cell) => Array.isArray(cell) && cell.length === 3 && cell.every(Number.isInteger) && cell[0] >= 0 && cell[0] < 81,
    ));
  return (
    !!s &&
    typeof s === 'object' &&
    s.version === SESSION_VERSION &&
    typeof s.id === 'string' &&
    SESSION_SLOTS.includes(s.slot) &&
    (s.slot !== 'challenge' || (
      s.dateKey === null && typeof s.challengeCode === 'string' && s.challengeCode.length > 0 && s.rules !== undefined
    )) &&
    (s.slot !== 'technique' || (s.dateKey === null && isTechniquePackId(s.techniquePack))) &&
    (s.slot !== 'level' || isSessionLevel(s.level)) &&
    (s.tints === undefined || (grid(s.tints) && s.tints.every((tint) => tint >= 0 && tint <= TINT_COUNT))) &&
    (s.slot !== 'weekly' || (typeof s.dateKey === 'string' && isWeeklyWeekKey(s.dateKey) && isWeeklyDifficulty(s.difficulty))) &&
    grid(s.givens) &&
    grid(s.solution) &&
    grid(s.values) &&
    grid(s.notes) &&
    validHistory(s.undo) &&
    (s.redo === undefined || validHistory(s.redo)) &&
    (s.rules === undefined || isSessionRules(s.rules)) &&
    (s.mistakeReview === undefined || isMistakeReview(s.mistakeReview)) &&
    Number.isFinite(s.elapsedMs) && s.elapsedMs >= 0
  );
}
