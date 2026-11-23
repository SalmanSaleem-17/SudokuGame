import { puzzlesOf } from '../data/pool';
import type { Difficulty } from '../engine/grader';
import type { PuzzleRecord } from '../engine/pool';
import { dateKeyOf, parseDateKey } from './daily';

export const WEEKLY_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type WeeklyDifficulty = (typeof WEEKLY_DIFFICULTIES)[number];

export interface WeeklyCompletion {
  slot: string;
  dateKey: string | null;
  difficulty: Difficulty;
}

/** The local calendar week begins on Monday, including in weeks with a daylight-saving change. */
export function localWeekKey(date = new Date()): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return dateKeyOf(monday);
}

export function isWeeklyWeekKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = parseDateKey(key);
  return date.getDay() === 1 && dateKeyOf(date) === key;
}

export function isWeeklyDifficulty(value: Difficulty): value is WeeklyDifficulty {
  return WEEKLY_DIFFICULTIES.some((difficulty) => difficulty === value);
}

/** Consecutive weeks walk each difficulty pool once before repeating. */
export function weeklyPuzzleFor(weekKey: string, difficulty: WeeklyDifficulty): PuzzleRecord {
  if (!isWeeklyWeekKey(weekKey)) throw new Error('Invalid weekly challenge date');
  const [year, month, day] = weekKey.split('-').map(Number);
  const weeksSinceEpoch = (Date.UTC(year, month - 1, day) - Date.UTC(1970, 0, 5)) / (7 * 86_400_000);
  const pool = puzzlesOf(difficulty);
  const offset = WEEKLY_DIFFICULTIES.indexOf(difficulty) * 13;
  const index = ((weeksSinceEpoch + offset) % pool.length + pool.length) % pool.length;
  return pool[index];
}

export function weeklyProgress(weekKey: string, completions: readonly WeeklyCompletion[]) {
  const finished = new Set(
    completions.filter((result) => result.slot === 'weekly' && result.dateKey === weekKey)
      .map((result) => result.difficulty),
  );
  const completed = WEEKLY_DIFFICULTIES.filter((difficulty) => finished.has(difficulty));
  const next = WEEKLY_DIFFICULTIES.find((difficulty) => !finished.has(difficulty)) ?? null;
  return { completed, next, earned: next === null };
}

export function weeklyBadgeWeeks(completions: readonly WeeklyCompletion[]): string[] {
  const weeks = new Map<string, Set<WeeklyDifficulty>>();
  for (const { slot, dateKey, difficulty } of completions) {
    if (slot !== 'weekly' || !dateKey || !isWeeklyWeekKey(dateKey) || !isWeeklyDifficulty(difficulty)) continue;
    const stages = weeks.get(dateKey) ?? new Set<WeeklyDifficulty>();
    stages.add(difficulty);
    weeks.set(dateKey, stages);
  }
  return [...weeks.entries()]
    .filter(([, stages]) => stages.size === WEEKLY_DIFFICULTIES.length)
    .map(([weekKey]) => weekKey)
    .sort((a, b) => b.localeCompare(a));
}
