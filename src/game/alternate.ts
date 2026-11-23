import { ALTERNATE_PUZZLE_DATA } from './alternateData';
import { compileAlternatePuzzle, digitBit } from './alternateRules';
import type { AlternateMode, AlternatePuzzle } from './alternateRules';

export const ALTERNATE_MODES = {
  'mini-4': {
    name: 'Mini 4 × 4',
    description: 'A quick first Sudoku using numbers 1–4.',
    rules: 'Put 1–4 in each row, column, and outlined 2 × 2 box. Use each number once.',
  },
  'mini-6': {
    name: 'Mini 6 × 6',
    description: 'A little more room to think with numbers 1–6.',
    rules: 'Put 1–6 in each row, column, and outlined 2 × 3 box. Use each number once.',
  },
  diagonal: {
    name: 'Diagonal Sudoku',
    description: 'Two more lines to solve across the board.',
    rules: 'Use 1–9 once in every row, column, and box. Both diagonals, marked with dots, also use 1–9 once.',
  },
  killer: {
    name: 'Killer Sudoku',
    description: 'Use cage totals to narrow down your choices.',
    rules: 'Use 1–9 once in every row, column, and box. Digits within each outlined cage must be different and add up to its corner total.',
  },
  irregular: {
    name: 'Irregular Sudoku',
    description: 'Follow the outlines of nine differently shaped regions.',
    rules: 'Use 1–9 once in every row, column, and outlined region.',
  },
} satisfies Record<AlternateMode, { name: string; description: string; rules: string }>;

export function isAlternateMode(value: unknown): value is AlternateMode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ALTERNATE_MODES, value);
}

export const alternatePuzzleCount = (mode: AlternateMode): number => ALTERNATE_PUZZLE_DATA[mode].length;

const compiledPuzzles = new Map<string, AlternatePuzzle>();

export function getAlternatePuzzle(mode: AlternateMode, index: number): AlternatePuzzle {
  const id = `${mode}:${index + 1}`;
  let puzzle = compiledPuzzles.get(id);
  if (!puzzle) {
    puzzle = compileAlternatePuzzle(mode, id, ALTERNATE_PUZZLE_DATA[mode][index]);
    compiledPuzzles.set(id, puzzle);
  }
  return puzzle;
}

interface CellChange {
  cell: number;
  value: number;
  notes: number;
}

export interface AlternateProgress {
  version: 1;
  puzzleId: string;
  values: readonly number[];
  notes: readonly number[];
  undo: readonly (readonly CellChange[])[];
}

const MAX_UNDO = 64;

export function createAlternateProgress(puzzle: AlternatePuzzle): AlternateProgress {
  return {
    version: 1,
    puzzleId: puzzle.id,
    values: puzzle.givens,
    notes: Array<number>(puzzle.givens.length).fill(0),
    undo: [],
  };
}

export function isAlternateComplete(puzzle: AlternatePuzzle, progress: AlternateProgress): boolean {
  return progress.values.every((value, cell) => value === puzzle.solution[cell]);
}

export function applyAlternateInput(
  puzzle: AlternatePuzzle,
  progress: AlternateProgress,
  cell: number,
  digit: number,
  notesMode: boolean,
  smartNotes: boolean,
): AlternateProgress {
  if (!Number.isInteger(cell) || cell < 0 || cell >= progress.values.length || puzzle.givens[cell]
    || !Number.isInteger(digit) || digit < 0 || digit > puzzle.size || isAlternateComplete(puzzle, progress)) return progress;

  const values = [...progress.values];
  const notes = [...progress.notes];
  const changes: CellChange[] = [];

  function setCell(target: number, value: number, mask: number): void {
    if (values[target] === value && notes[target] === mask) return;
    changes.push({ cell: target, value: values[target], notes: notes[target] });
    values[target] = value;
    notes[target] = mask;
  }

  if (notesMode && digit > 0) {
    if (values[cell] !== 0) return progress;
    setCell(cell, 0, notes[cell] ^ digitBit(digit));
  } else {
    setCell(cell, digit, 0);
    if (digit > 0 && smartNotes && digit === puzzle.solution[cell]) {
      for (const peer of puzzle.peers[cell]) setCell(peer, values[peer], notes[peer] & ~digitBit(digit));
    }
  }
  if (changes.length === 0) return progress;
  return { ...progress, values, notes, undo: [...progress.undo.slice(1 - MAX_UNDO), changes] };
}

export function undoAlternateInput(progress: AlternateProgress): AlternateProgress {
  const last = progress.undo.at(-1);
  if (!last) return progress;
  const values = [...progress.values];
  const notes = [...progress.notes];
  for (const change of last) {
    values[change.cell] = change.value;
    notes[change.cell] = change.notes;
  }
  return { ...progress, values, notes, undo: progress.undo.slice(0, -1) };
}

function record(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

function isIntInRange(raw: unknown, max: number): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= max;
}

function validUndo(puzzle: AlternatePuzzle, raw: unknown): raw is readonly (readonly CellChange[])[] {
  if (!Array.isArray(raw) || raw.length > MAX_UNDO) return false;
  return raw.every((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length === 0 || entry.length > puzzle.givens.length) return false;
    const seen = new Set<number>();
    return entry.every((item: unknown) => {
      const change = record(item);
      if (!change || !isIntInRange(change.cell, puzzle.givens.length - 1) || puzzle.givens[change.cell]
        || seen.has(change.cell) || !isIntInRange(change.value, puzzle.size)
        || !isIntInRange(change.notes, (1 << puzzle.size) - 1) || (change.value !== 0 && change.notes !== 0)) return false;
      seen.add(change.cell);
      return true;
    });
  });
}

export function loadAlternateProgress(mode: AlternateMode, data: unknown): { index: number; progress: AlternateProgress } {
  const raw = record(data);
  const count = alternatePuzzleCount(mode);
  const id = raw?.puzzleId;
  const index = typeof id === 'string' ? ALTERNATE_PUZZLE_DATA[mode].findIndex((_, i) => id === `${mode}:${i + 1}`) : -1;
  if (index < 0 || index >= count || raw?.version !== 1) {
    return { index: 0, progress: createAlternateProgress(getAlternatePuzzle(mode, 0)) };
  }
  const puzzle = getAlternatePuzzle(mode, index);
  const { values, notes, undo } = raw;
  const length = puzzle.givens.length;
  const noteMax = (1 << puzzle.size) - 1;
  if (!Array.isArray(values) || values.length !== length || !Array.isArray(notes) || notes.length !== length
    || !puzzle.givens.every((given, cell) => isIntInRange(values[cell], puzzle.size)
      && (!given || values[cell] === given) && isIntInRange(notes[cell], noteMax) && (values[cell] === 0 || notes[cell] === 0))) {
    return { index, progress: createAlternateProgress(puzzle) };
  }
  return { index, progress: { version: 1, puzzleId: puzzle.id, values, notes, undo: validUndo(puzzle, undo) ? undo : [] } };
}
