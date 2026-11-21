/**
 * Turns a technique step into board highlights. Pure; shared by hints and practice.
 */
import { UNITS } from '../engine/grid';
import { Step, applyStep, createState } from '../engine/techniques';

export const MARK_UNIT = 1;
export const MARK_PATTERN = 2;
export const MARK_TARGET = 3;

export interface Overlay {
  /** cell -> MARK_* */
  marks: Map<number, number>;
  /** cell -> candidate mask to display in place of the player's notes. */
  candidates: Map<number, number>;
}

export const EMPTY_OVERLAY: Overlay = { marks: new Map(), candidates: new Map() };

export function overlayForStep(step: Step, candidates?: readonly number[]): Overlay {
  const marks = new Map<number, number>();
  for (const unit of step.units) for (const cell of UNITS[unit]) marks.set(cell, MARK_UNIT);
  for (const e of step.eliminations) marks.set(e.cell, MARK_TARGET);
  for (const cell of step.cells) marks.set(cell, MARK_PATTERN);
  if (step.placement) marks.set(step.placement.cell, MARK_PATTERN);
  const shown = new Map<number, number>();
  // Elimination steps reason about candidates, so show them for the cells involved.
  if (candidates && !step.placement) {
    for (const cell of [...step.cells, ...step.eliminations.map((e) => e.cell)]) {
      if (candidates[cell]) shown.set(cell, candidates[cell]);
    }
  }
  return { marks, candidates: shown };
}

/** Highlights for step `index` of a hint, with candidates as they stand before that step. */
export function overlayForHintStep(values: readonly number[], steps: readonly Step[], index: number): Overlay {
  const state = createState(values);
  for (let i = 0; i < index; i++) applyStep(state, steps[i]);
  return overlayForStep(steps[index], state.cands);
}

export function overlayForCells(cells: readonly number[], mark: number): Overlay {
  return { marks: new Map(cells.map((c) => [c, mark])), candidates: new Map() };
}
