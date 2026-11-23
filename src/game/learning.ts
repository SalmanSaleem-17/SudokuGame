import {
  PEERS, cellName, hasValidGivens, listCells, parseGrid, serializeGrid,
} from '../engine/grid';
import type { PuzzleRecord } from '../engine/pool';
import {
  applyStep, createState, findHiddenSingles, findNakedSingles, findNextStep, type Step, type Technique,
} from '../engine/techniques';
import { MARK_PATTERN, MARK_TARGET, overlayForCells, overlayForStep } from './overlay';

export const TECHNIQUE_PACK_IDS = ['pairs', 'triples', 'x-wing'] as const;
export type TechniquePackId = (typeof TECHNIQUE_PACK_IDS)[number];

export const TECHNIQUE_PACKS: Record<TechniquePackId, {
  title: string;
  description: string;
  techniques: readonly Technique[];
}> = {
  pairs: {
    title: 'Pairs',
    description: 'Find two numbers that belong in two squares. Use that reservation to cross off candidates.',
    techniques: ['nakedPair', 'hiddenPair'],
  },
  triples: {
    title: 'Triples',
    description: 'Spot three squares that share just three possible numbers. Clear those numbers from the rest of the group.',
    techniques: ['nakedTriple'],
  },
  'x-wing': {
    title: 'X-Wing',
    description: 'Find four possible spots for one number that line up across two rows or columns.',
    techniques: ['xWing'],
  },
};

export function isTechniquePackId(value: unknown): value is TechniquePackId {
  return typeof value === 'string' && TECHNIQUE_PACK_IDS.some((id) => id === value);
}

export function puzzlesForPack(puzzles: readonly PuzzleRecord[], pack: TechniquePackId): PuzzleRecord[] {
  const { techniques } = TECHNIQUE_PACKS[pack];
  return puzzles.filter((puzzle) => techniques.some((id) => (puzzle.techniques[id] ?? 0) > 0))
    .sort((a, b) => a.score - b.score);
}

export interface LogicalPath {
  values: readonly number[];
  steps: readonly Step[];
}

/** Collects a verified path to a particular deduction, from freshly derived candidates. */
function trace(values: readonly number[], stopAt: (step: Step) => boolean): LogicalPath | null {
  const state = createState(values);
  const steps: Step[] = [];
  // At most 81 placements and 729 candidate eliminations are possible.
  for (let i = 0; i < 810; i++) {
    const step = findNextStep(state);
    if (!step) return null;
    steps.push(step);
    if (stopAt(step)) return { values, steps };
    applyStep(state, step);
  }
  return null;
}

export function techniqueExample(puzzle: PuzzleRecord, pack: TechniquePackId): LogicalPath | null {
  return trace(parseGrid(puzzle.givens), (step) => TECHNIQUE_PACKS[pack].techniques.includes(step.technique));
}

/** Retains every elimination so advanced patterns remain visible in the practice guide. */
export function nextGuidePath(values: readonly number[], solution: readonly number[]): LogicalPath | null {
  if (values.some((digit, cell) => digit !== 0 && digit !== solution[cell])) return null;
  return trace(values, (step) => !!step.placement);
}

export function logicalFrame(path: LogicalPath, index: number) {
  const state = createState(path.values);
  for (let i = 0; i < index; i++) applyStep(state, path.steps[i]);
  const step = path.steps[index];
  return { values: state.values, step, overlay: overlayForStep(step, state.cands) };
}

export const MAX_MISTAKE_REVIEW = 100;

export interface MistakeAttempt {
  cell: number;
  entered: number;
  correct: number;
  /** The confirmed entries before this move, with the lesson's cell empty. */
  board: string;
}

export function recordMistake(values: readonly number[], solution: readonly number[], cell: number, entered: number): MistakeAttempt {
  const board = values.map((value, at) => at !== cell && value === solution[at] ? value : 0);
  return { cell, entered, correct: solution[cell], board: serializeGrid(board) };
}

export function isMistakeReview(value: unknown): value is MistakeAttempt[] {
  const within = (number: unknown, min: number, max: number) =>
    typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max;
  return Array.isArray(value) && value.length <= MAX_MISTAKE_REVIEW && value.every((entry) =>
    !!entry && within(entry.cell, 0, 80) && within(entry.entered, 1, 9) && within(entry.correct, 1, 9) &&
    entry.entered !== entry.correct && typeof entry.board === 'string' && /^[0-9]{81}$/.test(entry.board) &&
    entry.board[entry.cell] === '0',
  );
}

export function mistakePosition(attempt: MistakeAttempt) {
  const { cell, entered, correct, board } = attempt;
  const values = parseGrid(board);
  const blockers = PEERS[cell].filter((other) => values[other] === entered);
  const overlay = overlayForCells(blockers, MARK_PATTERN);
  overlay.marks.set(cell, MARK_TARGET);
  values[cell] = entered;
  const explanation = blockers.length > 0
    ? `${cellName(cell)} shares a row, column, or box with ${listCells(blockers)}, where ${entered} is already placed.`
    : `${entered} doesn’t repeat a confirmed number nearby, but it cannot finish this puzzle correctly. ${cellName(cell)} needs ${correct}.`;
  return { values, blockers, overlay, explanation };
}

export function mistakeLogic(attempt: MistakeAttempt, givens: readonly number[]) {
  const values = parseGrid(attempt.board);
  const target = (step: Step) => step.placement?.cell === attempt.cell && step.placement.digit === attempt.correct;
  if (hasValidGivens(values)) {
    const state = createState(values);
    const direct = [...findNakedSingles(state), ...findHiddenSingles(state)].find(target);
    if (direct) return { path: { values, steps: [direct] }, fromGivens: false };
    const path = trace(values, target);
    if (path) return { path, fromGivens: false };
  }
  if (givens.length === 81 && hasValidGivens(givens) && givens[attempt.cell] === 0) {
    const path = trace(givens, target);
    if (path) return { path, fromGivens: true };
  }
  return null;
}

/** Highlights only candidates from the selected frame, keeping player pencil marks separate. */
export function candidateNotes(overlay: ReturnType<typeof overlayForStep>): number[] {
  const notes = Array<number>(81).fill(0);
  for (const [cell, digits] of overlay.candidates) notes[cell] = digits;
  return notes;
}

