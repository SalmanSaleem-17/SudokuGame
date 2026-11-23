/**
 * Daily streaks. A date counts when its Daily Puzzle was finished on time, or when the
 * player repaired it. Puzzles replayed from the calendar later fill the calendar only.
 */
import { dateKeyOf, parseDateKey } from './daily';

export interface DailyResult {
  slot: string;
  dateKey: string | null;
  completedAt: number;
}

/** Finished on its own date or the day after, which covers a puzzle started before midnight. */
export function isOnTime(dateKey: string, completedAt: number): boolean {
  const deadline = parseDateKey(dateKey);
  deadline.setDate(deadline.getDate() + 2);
  return completedAt < deadline.getTime();
}

export function streakDays(completions: readonly DailyResult[], repaired: readonly string[]): string[] {
  const days = new Set(repaired);
  for (const { slot, dateKey, completedAt } of completions) {
    if (slot === 'daily' && dateKey && isOnTime(dateKey, completedAt)) days.add(dateKey);
  }
  return [...days].sort();
}

function shift(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return dateKeyOf(date);
}

/** Consecutive days ending today, or ending yesterday while today is still open. */
export function currentStreak(days: readonly string[], today: Date): number {
  const counted = new Set(days);
  let key = dateKeyOf(today);
  if (!counted.has(key)) key = shift(key, -1);
  let streak = 0;
  while (counted.has(key)) {
    streak++;
    key = shift(key, -1);
  }
  return streak;
}

export function longestStreak(days: readonly string[]): number {
  let longest = 0;
  let run = 0;
  let expected = '';
  for (const key of [...new Set(days)].sort()) {
    run = key === expected ? run + 1 : 1;
    longest = Math.max(longest, run);
    expected = shift(key, 1);
  }
  return longest;
}

/**
 * Yesterday, when it is the single missed day between an earlier streak and today.
 * Repairing it joins the two; older gaps cannot be repaired.
 */
export function repairableDay(days: readonly string[], today: Date): string | null {
  const counted = new Set(days);
  const yesterday = shift(dateKeyOf(today), -1);
  return !counted.has(yesterday) && counted.has(shift(yesterday, -1)) ? yesterday : null;
}

export function isStreakList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((key) => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key));
}
