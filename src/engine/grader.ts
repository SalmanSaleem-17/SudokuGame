/**
 * Difficulty grading. A puzzle is solved with the fixed technique order and graded by the
 * hardest technique that path needs plus a weighted effort score.
 */
import {
  Step,
  TECHNIQUE_ORDER,
  Technique,
  applyStep,
  createState,
  findNextStep,
  isSolved,
} from './techniques';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

export type TechniqueCounts = Partial<Record<Technique, number>>;

const TIER: Record<Technique, number> = {
  hiddenSingle: 1,
  nakedSingle: 1,
  lockedCandidates: 2,
  nakedPair: 3,
  hiddenPair: 3,
  nakedTriple: 4,
  xWing: 4,
  hiddenTriple: 4,
  swordfish: 4,
  xyWing: 4,
};

const WEIGHT: Record<Technique, number> = {
  hiddenSingle: 1,
  nakedSingle: 3,
  lockedCandidates: 10,
  nakedPair: 16,
  hiddenPair: 20,
  nakedTriple: 28,
  xWing: 34,
  hiddenTriple: 38,
  swordfish: 46,
  xyWing: 42,
};

/** Easy puzzles keep at least this many givens. */
export const EASY_MIN_GIVENS = 32;

export interface LogicalSolve {
  solved: boolean;
  steps: Step[];
  values: number[];
}

/** Solves as far as the supported techniques allow, always taking the easiest next step. */
export function solveLogically(givens: readonly number[]): LogicalSolve {
  const state = createState(givens);
  const steps: Step[] = [];
  // 81 placements plus at most 729 candidate eliminations bounds the loop.
  for (let guard = 0; guard < 900 && !isSolved(state.values); guard++) {
    const step = findNextStep(state);
    if (!step) break;
    applyStep(state, step);
    steps.push(step);
  }
  return { solved: isSolved(state.values), steps, values: state.values };
}

export interface Grade {
  /** null when the supported techniques cannot finish the puzzle. */
  difficulty: Difficulty | null;
  score: number;
  techniques: TechniqueCounts;
  givens: number;
}

export function countTechniques(steps: readonly Step[]): TechniqueCounts {
  const counts: TechniqueCounts = {};
  for (const technique of TECHNIQUE_ORDER) {
    const n = steps.filter((s) => s.technique === technique).length;
    if (n > 0) counts[technique] = n;
  }
  return counts;
}

/**
 * Easy: hidden singles only, with a generous number of givens.
 * Medium: singles only, but needs naked singles or has fewer givens.
 * Hard: needs locked candidates or pairs.
 * Expert: needs triples, X-Wings, Swordfish or XY-Wings.
 */
export function gradePuzzle(givens: readonly number[]): Grade {
  const result = solveLogically(givens);
  const techniques = countTechniques(result.steps);
  const givenCount = givens.filter((v) => v !== 0).length;
  let score = 0;
  let tier = 0;
  for (const step of result.steps) {
    score += WEIGHT[step.technique];
    tier = Math.max(tier, TIER[step.technique]);
  }
  let difficulty: Difficulty | null = null;
  if (result.solved) {
    if (tier <= 1) {
      difficulty = !techniques.nakedSingle && givenCount >= EASY_MIN_GIVENS ? 'easy' : 'medium';
    } else if (tier <= 3) {
      difficulty = 'hard';
    } else {
      difficulty = 'expert';
    }
  }
  return { difficulty, score, techniques, givens: givenCount };
}
