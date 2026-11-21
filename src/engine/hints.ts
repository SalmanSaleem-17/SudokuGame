/**
 * Hints computed from the live board. A hint is the shortest chain of supported steps that
 * ends in placing a digit: zero or more candidate eliminations followed by a single.
 */
import { findConflicts } from './grid';
import { Step, applyStep, createState, findNextStep, isSolved } from './techniques';

export type HintResult =
  /** A logical next move exists. The last step always places a digit. */
  | { kind: 'steps'; steps: Step[] }
  /** Wrong entries make the board unsolvable; the player has to fix them first. */
  | { kind: 'blocked'; wrongCells: number[]; conflictCells: number[] }
  /** The supported techniques cannot find a move from here. */
  | { kind: 'none' }
  | { kind: 'complete' };

export function computeHint(values: readonly number[], solution: readonly number[]): HintResult {
  const wrongCells: number[] = [];
  for (let i = 0; i < 81; i++) {
    if (values[i] !== 0 && values[i] !== solution[i]) wrongCells.push(i);
  }
  if (wrongCells.length > 0) {
    const conflicts = findConflicts(values);
    return { kind: 'blocked', wrongCells, conflictCells: [...conflicts].sort((a, b) => a - b) };
  }
  if (isSolved(values)) return { kind: 'complete' };

  const state = createState(values);
  const path: Step[] = [];
  for (let guard = 0; guard < 800; guard++) {
    const step = findNextStep(state);
    if (!step) return { kind: 'none' };
    path.push(step);
    if (step.placement) break;
    applyStep(state, step);
  }
  const last = path[path.length - 1];
  if (!last?.placement) return { kind: 'none' };
  return { kind: 'steps', steps: pruneToNeeded(path) };
}

/**
 * Keeps only the elimination steps the final placement depends on, directly or through
 * other kept steps, so the explanation does not include unrelated detours.
 */
function pruneToNeeded(path: Step[]): Step[] {
  const lastIndex = path.length - 1;
  // (cell, digit) -> index of the step that eliminated it.
  const eliminatedBy = new Map<number, number>();
  for (let i = 0; i < lastIndex; i++) {
    for (const e of path[i].eliminations) {
      const key = e.cell * 10 + e.digit;
      if (!eliminatedBy.has(key)) eliminatedBy.set(key, i);
    }
  }
  const needed = new Set<number>([lastIndex]);
  const queue = [lastIndex];
  while (queue.length > 0) {
    const index = queue.pop()!;
    for (const group of path[index].premise) {
      for (const cell of group.cells) {
        for (const digit of group.digits) {
          const source = eliminatedBy.get(cell * 10 + digit);
          if (source !== undefined && source < index && !needed.has(source)) {
            needed.add(source);
            queue.push(source);
          }
        }
      }
    }
  }
  return path.filter((_, i) => needed.has(i));
}
