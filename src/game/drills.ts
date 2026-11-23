/**
 * Practice drills. Each drill is a bundled board position; the question and its
 * explanation are derived from the position with the same technique engine as hints.
 */
import { UNITS, computeCandidates, parseGrid, unitName } from '../engine/grid';
import { DrillRecord, DrillTechnique, findDrillSteps } from '../engine/pool';
import { TECHNIQUE_NAMES, type Step, type Technique } from '../engine/techniques';

export const DRILL_INFO: Record<DrillTechnique, { title: string; summary: string; steps: readonly string[] }> = {
  nakedSingle: {
    title: 'One Number Fits',
    summary: 'Find the only number that fits a square.',
    steps: [
      'Pick an empty square.',
      'Rule out numbers already in its row, column or box.',
      'Place the only number left.',
    ],
  },
  hiddenSingle: {
    title: 'One Spot Left',
    summary: 'Find the only square a number can go in.',
    steps: [
      'Pick a missing number in a row, column or box.',
      'Check which empty squares can hold that number.',
      'Place it if there is only one square left.',
    ],
  },
  lockedCandidates: {
    title: 'Narrow the Options',
    summary: 'Use a line inside a box to rule out numbers elsewhere.',
    steps: [
      'In a box, check whether a number’s possible spots all lie in one row or column.',
      'Cross off that number in the rest of that row or column outside the box.',
      'Starting with a line works too. If all spots for a number share one box, cross it off elsewhere in that box.',
    ],
  },
};

export function techniqueDisplayName(technique: Technique): string {
  return technique in DRILL_INFO ? DRILL_INFO[technique as DrillTechnique].title : TECHNIQUE_NAMES[technique];
}

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
      prompt: 'Which number fits the highlighted square?',
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
      prompt: `Where does ${digit} go in the highlighted ${unitName(step.units[0])}? Tap a square.`,
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
    prompt: `In the highlighted ${unitName(house)}, which number’s possible spots share ${kind}?`,
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
