/**
 * Brute-force backtracking solver used for uniqueness checks. It shares no logic with the
 * human-style technique engine, so it serves as an independent validator of the puzzle pool.
 */
import { ALL_DIGITS, Grid, PEERS, bit, countBits, hasValidGivens, singleDigit } from './grid';

interface SearchResult {
  count: number;
  first: Grid | null;
}

function search(
  values: number[],
  limit: number,
  result: SearchResult,
  pickDigit?: (mask: number) => number[],
): void {
  // Most-constrained-cell heuristic.
  let best = -1;
  let bestMask = 0;
  let bestCount = 10;
  for (let cell = 0; cell < 81; cell++) {
    if (values[cell] !== 0) continue;
    let seen = 0;
    for (const p of PEERS[cell]) if (values[p] !== 0) seen |= bit(values[p]);
    const mask = ALL_DIGITS & ~seen;
    const n = countBits(mask);
    if (n === 0) return;
    if (n < bestCount) {
      best = cell;
      bestMask = mask;
      bestCount = n;
      if (n === 1) break;
    }
  }
  if (best < 0) {
    result.count++;
    if (!result.first) result.first = values.slice();
    return;
  }
  if (pickDigit) {
    for (const d of pickDigit(bestMask)) {
      values[best] = d;
      search(values, limit, result, pickDigit);
      if (result.count >= limit) break;
    }
  } else {
    let mask = bestMask;
    while (mask) {
      const low = mask & -mask;
      values[best] = singleDigit(low);
      search(values, limit, result);
      if (result.count >= limit) break;
      mask ^= low;
    }
  }
  values[best] = 0;
}

/** Counts solutions up to `limit` (default 2, enough to prove uniqueness). */
export function countSolutions(grid: readonly number[], limit = 2): number {
  if (!hasValidGivens(grid)) return 0;
  const result: SearchResult = { count: 0, first: null };
  search(grid.slice(), limit, result);
  return result.count;
}

/** Returns one solution, or null if the grid is invalid or unsolvable. */
export function solve(grid: readonly number[]): Grid | null {
  if (!hasValidGivens(grid)) return null;
  const result: SearchResult = { count: 0, first: null };
  search(grid.slice(), 1, result);
  return result.first;
}

/** Fills an empty grid using the supplied digit ordering. Used by the offline generator only. */
export function solveRandom(pickDigit: (mask: number) => number[]): Grid {
  const result: SearchResult = { count: 0, first: null };
  search(new Array(81).fill(0), 1, result, pickDigit);
  if (!result.first) throw new Error('Failed to build a full grid');
  return result.first;
}
