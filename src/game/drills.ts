/**
 * Practice drills. Each drill is a bundled board position; the question and its
 * explanation are derived from the position with the same technique engine as hints.
 */
import { UNITS, computeCandidates, parseGrid, unitName } from '../engine/grid';
import { DrillRecord, DrillTechnique, findDrillSteps } from '../engine/pool';
import type { Step } from '../engine/techniques';

export const DRILL_INFO: Record<DrillTechnique, { name: string; summary: string; lesson: string }> = {
  nakedSingle: {
    name: 'Naked singles',
    summary: 'A cell with only one possible digit.',
    lesson:
      'Look at one empty cell and cross off every digit already in its row, column and box. If only one digit survives, it must go there.',
  },
  hiddenSingle: {
    name: 'Hidden singles',
    summary: 'A digit with only one possible cell in a row, column or box.',
    lesson:
      'Pick a row, column or box and one missing digit. Rule out each empty cell that already sees that digit. If only one cell is left, the digit goes there, even if that cell has other candidates.',
  },
  lockedCandidates: {
    name: 'Locked candidates',
    summary: 'A digit confined to one line inside a box.',
    lesson:
      'When every place a digit can go in a box lies in one row or column, the digit is locked to that line there. It can be removed from the rest of that row or column. The same works from a line into a box.',
  },
};

export interface Drill {
  id: string;
  technique: DrillTechnique;
  values: number[];
  prompt: string;
  /** What the player answers with. */
  answerType: 'digit' | 'cell';
  /** Cells highlighted while the question is open. */
  focusCells: number[];
  /** Candidates displayed to make the question answerable; cell -> mask. */
  candidates: Map<number, number>;
  /** Returns the step that makes the answer right, or null when it is wrong. */
  check(answer: number): Step | null;
  /** A correct step, shown when the player asks for the answer. */
  solution: Step;
}

export function buildDrill(record: DrillRecord): Drill {
  const values = parseGrid(record.grid);
  const steps = findDrillSteps(values, record.technique);
  if (steps.length === 0) throw new Error(`Drill ${record.id} has no ${record.technique} step`);
  const base = { id: record.id, technique: record.technique, values, candidates: new Map<number, number>() };

  if (record.technique === 'nakedSingle') {
    const step = steps[0];
    const cell = step.placement!.cell;
    return {
      ...base,
      prompt: 'Only one digit can go in the highlighted cell. Which digit is it?',
      answerType: 'digit',
      focusCells: [cell],
      check: (digit) => (digit === step.placement!.digit ? step : null),
      solution: step,
    };
  }

  if (record.technique === 'hiddenSingle') {
    // Prefer a unit with several empty cells so there is something to work out.
    const emptiesIn = (s: Step) => unitCells(s).filter((c) => values[c] === 0).length;
    const step = steps.find((s) => emptiesIn(s) >= 3) ?? steps[0];
    const digit = step.placement!.digit;
    return {
      ...base,
      prompt: `Where does ${digit} go in the highlighted ${unitName(step.units[0])}? Tap the cell.`,
      answerType: 'cell',
      focusCells: unitCells(step),
      check: (cell) => (cell === step.placement!.cell ? step : null),
      solution: step,
    };
  }

  const first = steps[0];
  const house = first.units[0];
  const inHouse = steps.filter((s) => s.units[0] === house);
  const all = computeCandidates(values);
  const candidates = new Map<number, number>();
  for (const cell of unitCells(first)) if (all[cell]) candidates.set(cell, all[cell]);
  const kind = house >= 18 ? 'a single row or column' : 'a single box';
  return {
    ...base,
    candidates,
    prompt: `In the highlighted ${unitName(house)}, one digit can only go in cells that share ${kind}. Which digit is it?`,
    answerType: 'digit',
    focusCells: unitCells(first),
    check: (digit) => inHouse.find((s) => s.eliminations[0].digit === digit) ?? null,
    solution: first,
  };
}

/** Cells of the unit a step is centred on. */
function unitCells(step: Step): number[] {
  return UNITS[step.units[0]];
}
