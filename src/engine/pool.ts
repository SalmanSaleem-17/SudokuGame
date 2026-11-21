/**
 * Types and validation for the bundled puzzle pool. Used by the build-time validation
 * command and by unit tests; nothing here runs during play.
 */
import { DIFFICULTIES, Difficulty, TechniqueCounts, gradePuzzle } from './grader';
import { hasValidGivens, parseGrid, serializeGrid } from './grid';
import { countSolutions, solve } from './solver';
import { Step, Technique, createState, findHiddenSingles, findLockedCandidates, findNakedSingles } from './techniques';

export interface PuzzleRecord {
  id: string;
  difficulty: Difficulty;
  givens: string;
  solution: string;
  score: number;
  techniques: TechniqueCounts;
}

export type DrillTechnique = 'nakedSingle' | 'hiddenSingle' | 'lockedCandidates';
export const DRILL_TECHNIQUES: DrillTechnique[] = ['nakedSingle', 'hiddenSingle', 'lockedCandidates'];

export interface DrillRecord {
  id: string;
  technique: DrillTechnique;
  /** Board position (81 characters) in which the technique applies. */
  grid: string;
}

export const MIN_PUZZLES_PER_DIFFICULTY = 10;
export const MIN_DRILLS_PER_TECHNIQUE = 5;

/** Every instance of a drill technique available on a board, from freshly derived candidates. */
export function findDrillSteps(values: readonly number[], technique: DrillTechnique): Step[] {
  const state = createState(values);
  switch (technique) {
    case 'nakedSingle':
      return findNakedSingles(state);
    case 'hiddenSingle':
      return findHiddenSingles(state);
    case 'lockedCandidates':
      return findLockedCandidates(state);
  }
}

export interface PoolReport {
  errors: string[];
  counts: Record<Difficulty, number>;
  drillCounts: Record<DrillTechnique, number>;
}

export function validatePool(puzzles: readonly PuzzleRecord[], drills: readonly DrillRecord[]): PoolReport {
  const errors: string[] = [];
  const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 };
  const drillCounts: Record<DrillTechnique, number> = { nakedSingle: 0, hiddenSingle: 0, lockedCandidates: 0 };
  const ids = new Set<string>();
  const seenGivens = new Set<string>();

  for (const p of puzzles) {
    const fail = (message: string) => errors.push(`${p.id}: ${message}`);
    if (ids.has(p.id)) fail('duplicate id');
    ids.add(p.id);
    if (seenGivens.has(p.givens)) fail('duplicate puzzle');
    seenGivens.add(p.givens);
    if (!DIFFICULTIES.includes(p.difficulty)) {
      fail(`unknown difficulty "${p.difficulty}"`);
      continue;
    }
    let givens: number[];
    try {
      givens = parseGrid(p.givens);
    } catch (e) {
      fail((e as Error).message);
      continue;
    }
    if (!hasValidGivens(givens)) {
      fail('givens break the Sudoku rules');
      continue;
    }
    const solutions = countSolutions(givens, 2);
    if (solutions !== 1) {
      fail(solutions === 0 ? 'no solution' : 'more than one solution');
      continue;
    }
    if (serializeGrid(solve(givens)!) !== p.solution) fail('stored solution does not match');
    const grade = gradePuzzle(givens);
    if (grade.difficulty !== p.difficulty) {
      fail(`graded ${grade.difficulty ?? 'unsolvable by supported techniques'}, stored as ${p.difficulty}`);
    }
    if (grade.score !== p.score) fail(`effort score ${grade.score} differs from stored ${p.score}`);
    if (JSON.stringify(grade.techniques) !== JSON.stringify(p.techniques)) {
      fail('technique counts differ from the reproduced solution path');
    }
    counts[p.difficulty]++;
  }

  for (const difficulty of DIFFICULTIES) {
    const n = counts[difficulty];
    // A difficulty is either absent (disabled in the app) or has a full pool.
    if (n > 0 && n < MIN_PUZZLES_PER_DIFFICULTY) {
      errors.push(`${difficulty}: only ${n} valid puzzles, need ${MIN_PUZZLES_PER_DIFFICULTY}`);
    }
  }
  for (const required of ['easy', 'medium', 'hard'] as Difficulty[]) {
    if (counts[required] === 0) errors.push(`${required}: no puzzles bundled`);
  }

  const drillIds = new Set<string>();
  for (const d of drills) {
    const fail = (message: string) => errors.push(`${d.id}: ${message}`);
    if (drillIds.has(d.id)) fail('duplicate id');
    drillIds.add(d.id);
    if (!(d.technique in drillCounts)) {
      fail(`unknown technique "${d.technique}"`);
      continue;
    }
    let grid: number[];
    try {
      grid = parseGrid(d.grid);
    } catch (e) {
      fail((e as Error).message);
      continue;
    }
    if (countSolutions(grid, 2) !== 1) {
      fail('drill position does not have exactly one solution');
      continue;
    }
    const steps = findDrillSteps(grid, d.technique);
    if (steps.length === 0) {
      fail('technique does not apply to this position');
      continue;
    }
    const solution = solve(grid)!;
    const unsound = steps.some(
      (s) =>
        (s.placement && solution[s.placement.cell] !== s.placement.digit) ||
        s.eliminations.some((e) => solution[e.cell] === e.digit),
    );
    if (unsound) fail('a step contradicts the solution');
    drillCounts[d.technique]++;
  }
  for (const technique of Object.keys(drillCounts) as DrillTechnique[]) {
    if (drillCounts[technique] < MIN_DRILLS_PER_TECHNIQUE) {
      errors.push(`${technique}: only ${drillCounts[technique]} drills, need ${MIN_DRILLS_PER_TECHNIQUE}`);
    }
  }

  return { errors, counts, drillCounts };
}

export type { Technique };
