/**
 * Levels: 30 fixed stages per difficulty, separate from Play Now. Easy is played on 4×4
 * boards, Medium on 6×6, Hard and Expert on 9×9. Each difficulty has its own time limit and
 * mistake limit, and stars are awarded for how fast a stage is solved.
 */
import { puzzlesOf } from '../data/pool';
import { DIFFICULTIES, type Difficulty } from '../engine/grader';
import type { PuzzleRecord } from '../engine/pool';
import { PLAY_BOARD_SIZES, miniModeForDifficulty } from './playFormat';
import type { SessionLevel } from './session';

export const LEVEL_COUNT = 30;
/** Each ad adds one mistake; this caps how many a single attempt can add. */
export const MAX_EXTRA_MISTAKES = 2;
/** Clearing every fifth level for the first time pays a credit reward. */
export const LEVEL_REWARD_INTERVAL = 5;

/** Seconds allowed per difficulty, and the times that earn three and two stars. */
export const LEVEL_TIMES: Record<Difficulty, { limitSec: number; threeStarSec: number; twoStarSec: number }> = {
  easy: { limitSec: 2 * 60, threeStarSec: 30, twoStarSec: 60 },
  medium: { limitSec: 4 * 60, threeStarSec: 60, twoStarSec: 2 * 60 },
  hard: { limitSec: 8 * 60, threeStarSec: 3 * 60, twoStarSec: 5 * 60 },
  expert: { limitSec: 10 * 60, threeStarSec: 4 * 60, twoStarSec: 6 * 60 },
};

/** Mistakes that end a level, the same for every level of a difficulty. */
export const LEVEL_MISTAKES: Record<Difficulty, number> = { easy: 3, medium: 5, hard: 8, expert: 10 };

/** Board edge of each difficulty's level track. */
export const LEVEL_BOARD_SIZES = PLAY_BOARD_SIZES;

/**
 * The first six puzzles of each mini board shipped before Levels existed. The 30 level
 * puzzles follow them, ordered from most givens to fewest.
 */
const MINI_LEVEL_OFFSET = 6;

/**
 * 9×9 levels draw only from puzzles numbered up to these ids, so adding puzzles to the
 * pool later never changes which puzzle a level uses.
 */
const SOURCE_LIMIT: Partial<Record<Difficulty, number>> = { hard: 80, expert: 50 };

export type LevelRules = Omit<SessionLevel, 'extraMistakes'>;

export function isLevelNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= LEVEL_COUNT;
}

export function levelRules(difficulty: Difficulty, number: number): LevelRules {
  return {
    number,
    timeLimitSec: LEVEL_TIMES[difficulty].limitSec,
    mistakeLimit: LEVEL_MISTAKES[difficulty],
  };
}

/** Index of a mini level's puzzle within its board's puzzle list. */
export function miniLevelIndex(number: number): number {
  if (!isLevelNumber(number)) throw new Error('Choose a level from 1 to 30.');
  return MINI_LEVEL_OFFSET + number - 1;
}

const levelPuzzles = new Map<Difficulty, PuzzleRecord[]>();

/** The 30 puzzles of a 9×9 track, easiest first by the solver's effort score. */
function trackPuzzles(difficulty: Difficulty): PuzzleRecord[] {
  let track = levelPuzzles.get(difficulty);
  if (!track) {
    const limit = SOURCE_LIMIT[difficulty];
    if (limit === undefined || miniModeForDifficulty(difficulty)) throw new Error(`${difficulty} levels are not played on a 9×9 board.`);
    const source = puzzlesOf(difficulty)
      .filter((puzzle) => Number(puzzle.id.split('-')[1]) <= limit)
      .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    track = Array.from({ length: LEVEL_COUNT }, (_, index) =>
      source[Math.floor((index * (source.length - 1)) / (LEVEL_COUNT - 1))]);
    levelPuzzles.set(difficulty, track);
  }
  return track;
}

/** The 9×9 puzzle of a Hard or Expert level. */
export function levelPuzzle(difficulty: Difficulty, number: number): PuzzleRecord {
  if (!isLevelNumber(number)) throw new Error('Choose a level from 1 to 30.');
  return trackPuzzles(difficulty)[number - 1];
}

/** Three stars inside the fast time, two inside the good time, one for finishing at all. */
export function levelStars(difficulty: Difficulty, elapsedMs: number): 1 | 2 | 3 {
  const { threeStarSec, twoStarSec } = LEVEL_TIMES[difficulty];
  return elapsedMs <= threeStarSec * 1000 ? 3 : elapsedMs <= twoStarSec * 1000 ? 2 : 1;
}

export interface LevelResult {
  slot: string;
  difficulty: Difficulty;
  level?: number;
  stars?: number;
}

/** Best stars per level for every difficulty; 0 means the level has not been cleared. */
export function levelProgress(completions: readonly LevelResult[]): Record<Difficulty, number[]> {
  const progress = Object.fromEntries(
    DIFFICULTIES.map((difficulty) => [difficulty, new Array<number>(LEVEL_COUNT).fill(0)]),
  ) as Record<Difficulty, number[]>;
  for (const { slot, difficulty, level, stars } of completions) {
    if (slot !== 'level' || level === undefined || !isLevelNumber(level)) continue;
    const track = progress[difficulty];
    track[level - 1] = Math.max(track[level - 1], Math.min(3, Math.max(1, stars ?? 1)));
  }
  return progress;
}

/** Level 1 is always open; each later level opens when the one before it is cleared. */
export function isLevelUnlocked(stars: readonly number[], number: number): boolean {
  return number === 1 || (isLevelNumber(number) && stars[number - 2] > 0);
}

/** The first level not yet cleared, or null when the whole track is done. */
export function nextLevel(stars: readonly number[]): number | null {
  const index = stars.findIndex((earned) => earned === 0);
  return index < 0 ? null : index + 1;
}

export const totalStars = (stars: readonly number[]) => stars.reduce((sum, earned) => sum + earned, 0);

export function formatLimit(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 === 0 ? `${minutes} min` : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
