/**
 * The bundled, pre-validated puzzle pool. Nothing is generated at runtime.
 */
import { DIFFICULTIES, Difficulty } from '../engine/grader';
import { DrillRecord, DrillTechnique, MIN_PUZZLES_PER_DIFFICULTY, PuzzleRecord } from '../engine/pool';
import drillData from './drills.json';
import puzzleData from './puzzles.json';

export const PUZZLES = puzzleData as PuzzleRecord[];
export const DRILLS = drillData as DrillRecord[];

const byId = new Map(PUZZLES.map((p) => [p.id, p]));
export const getPuzzle = (id: string) => byId.get(id) ?? null;

export const puzzlesOf = (difficulty: Difficulty) => PUZZLES.filter((p) => p.difficulty === difficulty);

/** A difficulty is offered only when its validated pool is large enough. */
export const ENABLED_DIFFICULTIES: Difficulty[] = DIFFICULTIES.filter(
  (d) => puzzlesOf(d).length >= MIN_PUZZLES_PER_DIFFICULTY,
);

/** Daily puzzles rotate through Easy, Medium and Hard. */
export const DAILY_POOL: PuzzleRecord[] = PUZZLES.filter((p) => p.difficulty !== 'expert');

export const drillsOf = (technique: DrillTechnique) => DRILLS.filter((d) => d.technique === technique);
