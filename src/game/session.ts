/**
 * Puzzle session state and the pure operations on it. No storage or UI code here.
 */
import type { Difficulty } from '../engine/grader';
import { PEERS, bit, parseGrid } from '../engine/grid';
import type { HintResult } from '../engine/hints';
import type { PuzzleRecord } from '../engine/pool';

export type SessionSlot = 'classic' | 'daily';

export const SESSION_VERSION = 1;
const MAX_UNDO = 400;

/** One undoable action: the previous value and notes of every cell it touched. */
export interface UndoEntry {
  /** [cell, previousValue, previousNotes] */
  cells: [number, number, number][];
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
  /** Local calendar date (YYYY-MM-DD) a daily puzzle belongs to. */
  dateKey: string | null;
  givens: number[];
  solution: number[];
  values: number[];
  /** Pencil marks per cell as a 9-bit mask. */
  notes: number[];
  undo: UndoEntry[];
  /** Active play time in milliseconds; excludes paused, backgrounded and ad time. */
  elapsedMs: number;
  mistakes: number;
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
    elapsedMs: 0,
    mistakes: 0,
    hintsUsed: 0,
    freeHintUsed: false,
    hint: null,
    completed: false,
    startedAt: now,
  };
}

export const boardKey = (values: readonly number[]) => values.join('');
export const isGiven = (session: Session, cell: number) => session.givens[cell] !== 0;
const isComplete = (session: Session, values: number[]) => values.every((v, i) => v === session.solution[i]);

interface CellChange {
  cell: number;
  value: number;
  notes: number;
}

/** Applies cell changes as a single undoable action. Returns the same session if nothing changes. */
function commit(session: Session, changes: CellChange[], extra: Partial<Session> = {}): Session {
  const real = changes.filter((c) => session.values[c.cell] !== c.value || session.notes[c.cell] !== c.notes);
  if (real.length === 0) return session;
  const values = session.values.slice();
  const notes = session.notes.slice();
  const entry: UndoEntry = { cells: [] };
  for (const c of real) {
    entry.cells.push([c.cell, values[c.cell], notes[c.cell]]);
    values[c.cell] = c.value;
    notes[c.cell] = c.notes;
  }
  const undo = session.undo.length >= MAX_UNDO ? session.undo.slice(1) : session.undo.slice();
  undo.push(entry);
  return { ...session, ...extra, values, notes, undo, completed: isComplete(session, values) };
}

export interface EntryOptions {
  /** Remove the placed digit from notes in the cell's row, column and box. */
  smartNotes: boolean;
}

/** Places a digit. Entering the digit a cell already holds clears it. */
export function enterDigit(session: Session, cell: number, digit: number, options: EntryOptions): Session {
  if (session.completed || isGiven(session, cell)) return session;
  if (session.values[cell] === digit) return eraseCell(session, cell);
  const changes: CellChange[] = [{ cell, value: digit, notes: 0 }];
  if (options.smartNotes) {
    const mask = bit(digit);
    for (const p of PEERS[cell]) {
      if (session.values[p] === 0 && session.notes[p] & mask) {
        changes.push({ cell: p, value: 0, notes: session.notes[p] & ~mask });
      }
    }
  }
  const wrong = digit !== session.solution[cell];
  return commit(session, changes, wrong ? { mistakes: session.mistakes + 1 } : {});
}

export function toggleNote(session: Session, cell: number, digit: number): Session {
  if (session.completed || isGiven(session, cell) || session.values[cell] !== 0) return session;
  return commit(session, [{ cell, value: 0, notes: session.notes[cell] ^ bit(digit) }]);
}

export function eraseCell(session: Session, cell: number): Session {
  if (session.completed || isGiven(session, cell)) return session;
  return commit(session, [{ cell, value: 0, notes: 0 }]);
}

/** Reverts the latest action, restoring every cell and note it touched. */
export function undoMove(session: Session): Session {
  if (session.completed || session.undo.length === 0) return session;
  const undo = session.undo.slice();
  const entry = undo.pop()!;
  const values = session.values.slice();
  const notes = session.notes.slice();
  for (const [cell, value, cellNotes] of entry.cells) {
    values[cell] = value;
    notes[cell] = cellNotes;
  }
  return { ...session, values, notes, undo };
}

/** Clears every entry that does not match the solution, as one undoable action. */
export function clearIncorrect(session: Session): Session {
  const changes: CellChange[] = [];
  for (let cell = 0; cell < 81; cell++) {
    const v = session.values[cell];
    if (v !== 0 && !isGiven(session, cell) && v !== session.solution[cell]) {
      changes.push({ cell, value: 0, notes: 0 });
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

/** Guards against loading a corrupt or incompatible saved session. */
export function isValidSession(value: unknown): value is Session {
  const s = value as Session | null;
  const grid = (g: unknown) => Array.isArray(g) && g.length === 81 && g.every((n) => Number.isInteger(n));
  return (
    !!s &&
    typeof s === 'object' &&
    s.version === SESSION_VERSION &&
    typeof s.id === 'string' &&
    (s.slot === 'classic' || s.slot === 'daily') &&
    grid(s.givens) &&
    grid(s.solution) &&
    grid(s.values) &&
    grid(s.notes) &&
    Array.isArray(s.undo) &&
    typeof s.elapsedMs === 'number'
  );
}
