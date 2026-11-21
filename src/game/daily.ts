/**
 * Daily puzzle selection. Everything is derived from the device's local calendar date,
 * so it works offline and gives the same puzzle for the same date on every launch.
 */
import type { PuzzleRecord } from '../engine/pool';
import type { Session } from './session';

/** Local calendar date as YYYY-MM-DD. */
export function dateKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Days since 1970-01-01 for a calendar date, independent of time zone. */
function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * Picks the puzzle for a date. Consecutive days walk the pool with a fixed stride that is
 * coprime to the pool size, so no puzzle repeats until the whole pool has been used.
 */
export function dailyPuzzleFor(dateKey: string, pool: readonly PuzzleRecord[]): PuzzleRecord {
  if (pool.length === 0) throw new Error('Daily pool is empty');
  let stride = 37;
  while (gcd(stride, pool.length) !== 1) stride++;
  const index = (((dayNumber(dateKey) * stride) % pool.length) + pool.length) % pool.length;
  return pool[index];
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export type DailyStatus =
  /** Today's puzzle is finished. */
  | { kind: 'completed'; dateKey: string }
  /** Today's puzzle is in progress. */
  | { kind: 'resume'; dateKey: string }
  /** Nothing started for today. `carried` is an unfinished puzzle from an earlier date. */
  | { kind: 'fresh'; dateKey: string; carried: string | null };

/**
 * Decides what the Daily screen offers. An unfinished session keeps the date it was
 * started on, even after midnight, until the player finishes or replaces it.
 */
export function resolveDaily(
  today: string,
  session: Pick<Session, 'dateKey' | 'completed'> | null,
  completedDates: ReadonlySet<string>,
): DailyStatus {
  const active = session && !session.completed && session.dateKey ? session.dateKey : null;
  if (completedDates.has(today)) return { kind: 'completed', dateKey: today };
  if (active === today) return { kind: 'resume', dateKey: today };
  return { kind: 'fresh', dateKey: today, carried: active && !completedDates.has(active) ? active : null };
}

export interface CalendarDay {
  dateKey: string;
  day: number;
}

/** Weeks of a month, Monday first; null pads days outside the month. */
export function monthGrid(year: number, month: number): (CalendarDay | null)[][] {
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: (CalendarDay | null)[] = new Array(lead).fill(null);
  for (let day = 1; day <= days; day++) {
    cells.push({ dateKey: dateKeyOf(new Date(year, month, day)), day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (CalendarDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
