/// <reference types="node" />
/**
 * Offline generator for the 4×4 and 6×6 puzzles used by the Easy and Medium level tracks.
 * Run with `npm run generate:minis`; it is never run in the app. The output is fixed by the
 * seed, ordered from most givens to fewest, and checked by the alternate-puzzle tests.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ALTERNATE_PUZZLE_DATA } from '../src/game/alternateData';
import {
  alternateCellUnits, compileAlternatePuzzle, countAlternateSolutions, regularRegions,
  type AlternatePuzzleDefinition, type AlternateSize,
} from '../src/game/alternateRules';

type MiniMode = 'mini-4' | 'mini-6';

const COUNT = 30;
/** Givens on the first and on the last puzzle of each track. */
const GIVENS: Record<MiniMode, readonly [first: number, last: number]> = { 'mini-4': [8, 4], 'mini-6': [20, 10] };
/** Puzzles that shipped before the level tracks; new ones must differ from them. */
const SHIPPED = 6;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261123);

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** A random filled grid for the board size. */
function fill(mode: MiniMode, size: AlternateSize): number[] {
  const units = alternateCellUnits(mode, size, regularRegions(size));
  const peers = Array.from({ length: size * size }, (_, cell) =>
    [...new Set(units.filter((unit) => unit.includes(cell)).flat())].filter((other) => other !== cell));
  const grid = new Array<number>(size * size).fill(0);
  const place = (cell: number): boolean => {
    if (cell === grid.length) return true;
    for (const digit of shuffle(Array.from({ length: size }, (_, i) => i + 1))) {
      if (peers[cell].some((peer) => grid[peer] === digit)) continue;
      grid[cell] = digit;
      if (place(cell + 1)) return true;
    }
    grid[cell] = 0;
    return false;
  };
  if (!place(0)) throw new Error('Could not fill a grid');
  return grid;
}

const unique = (mode: MiniMode, givens: number[], solution: number[]) =>
  countAlternateSolutions(compileAlternatePuzzle(mode, 'candidate', { givens: givens.join(''), solution: solution.join('') }), 2) === 1;

/** Removes givens in random order, keeping the solution unique, until `target` remain. */
function dig(mode: MiniMode, solution: number[], target: number): number[] | null {
  const givens = solution.slice();
  let left = givens.length;
  for (const cell of shuffle([...givens.keys()])) {
    if (left === target) break;
    const digit = givens[cell];
    givens[cell] = 0;
    if (unique(mode, givens, solution)) left--;
    else givens[cell] = digit;
  }
  return left === target ? givens : null;
}

const output = {} as Record<MiniMode, AlternatePuzzleDefinition[]>;
for (const mode of ['mini-4', 'mini-6'] as const) {
  const size: AlternateSize = mode === 'mini-4' ? 4 : 6;
  const [first, last] = GIVENS[mode];
  const seen = new Set(ALTERNATE_PUZZLE_DATA[mode].slice(0, SHIPPED).map((puzzle) => puzzle.givens));
  const track: AlternatePuzzleDefinition[] = [];
  for (let level = 0; level < COUNT; level++) {
    const target = Math.round(first - ((first - last) * level) / (COUNT - 1));
    for (let attempt = 0; ; attempt++) {
      if (attempt > 5000) throw new Error(`No ${mode} puzzle with ${target} givens found`);
      const solution = fill(mode, size);
      const givens = dig(mode, solution, target);
      const key = givens?.join('');
      if (!givens || !key || seen.has(key)) continue;
      seen.add(key);
      track.push({ givens: key, solution: solution.join('') });
      break;
    }
  }
  output[mode] = track;
}

writeFileSync(join(__dirname, '..', 'src', 'data', 'miniLevels.json'), JSON.stringify(output, null, 1) + '\n');
for (const mode of ['mini-4', 'mini-6'] as const) {
  const counts = output[mode].map((puzzle) => [...puzzle.givens].filter((digit) => digit !== '0').length);
  console.log(`${mode}: ${output[mode].length} puzzles, givens ${counts[0]} down to ${counts[counts.length - 1]}`);
}
