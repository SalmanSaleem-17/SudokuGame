/// <reference types="node" />
/**
 * Offline puzzle generator. Run with `npm run generate:puzzles`; it is never run in the app.
 *
 * It only ever ADDS puzzles: everything already in src/data/puzzles.json keeps its id, so
 * saved games, level progress and challenge codes that refer to a puzzle stay valid.
 * The result is checked by `npm run validate:puzzles`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DIFFICULTIES, Difficulty, EASY_MIN_GIVENS, gradePuzzle } from '../src/engine/grader';
import { digitsOf, serializeGrid } from '../src/engine/grid';
import type { PuzzleRecord } from '../src/engine/pool';
import { countSolutions, solveRandom } from '../src/engine/solver';

const dataDir = join(__dirname, '..', 'src', 'data');
const puzzlesPath = join(dataDir, 'puzzles.json');

/** How many puzzles each difficulty should end up with. */
const TARGET: Record<Difficulty, number> = { easy: 150, medium: 150, hard: 150, expert: 100 };
const MAX_MINUTES = Number(process.env.GENERATE_MINUTES ?? 20);

const existing = JSON.parse(readFileSync(puzzlesPath, 'utf8')) as PuzzleRecord[];
// A new seed per run, derived from what is already there, keeps runs reproducible.
const SEED = 20261121 + existing.length * 7919;

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

const random = mulberry32(SEED);

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Removes givens in rotationally symmetric pairs while the puzzle stays unique. */
function dig(solution: number[], minGivens: number): number[] {
  const grid = solution.slice();
  let givens = 81;
  for (const cell of shuffle([...Array(41).keys()])) {
    const mirror = 80 - cell;
    const remove = cell === mirror ? [cell] : [cell, mirror];
    if (givens - remove.length < minGivens) continue;
    const saved = remove.map((c) => grid[c]);
    for (const c of remove) grid[c] = 0;
    if (countSolutions(grid, 2) === 1) {
      givens -= remove.length;
    } else {
      remove.forEach((c, i) => (grid[c] = saved[i]));
    }
  }
  return grid;
}

const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 };
const nextNumber: Record<Difficulty, number> = { easy: 1, medium: 1, hard: 1, expert: 1 };
const seen = new Set<string>();
for (const puzzle of existing) {
  counts[puzzle.difficulty]++;
  nextNumber[puzzle.difficulty] = Math.max(nextNumber[puzzle.difficulty], Number(puzzle.id.split('-')[1]) + 1);
  seen.add(puzzle.givens);
}

const added: PuzzleRecord[] = [];
const full = () => DIFFICULTIES.every((d) => counts[d] >= TARGET[d]);
const deadline = Date.now() + MAX_MINUTES * 60_000;
let attempts = 0;

while (!full() && Date.now() < deadline) {
  attempts++;
  const solution = solveRandom((mask) => shuffle(digitsOf(mask)));
  // Alternate between generous and sparse puzzles so every bucket fills.
  const wantEasy = counts.easy < TARGET.easy && attempts % 3 === 0;
  const minGivens = wantEasy ? EASY_MIN_GIVENS + 2 + Math.floor(random() * 5) : 22 + Math.floor(random() * 8);
  const givens = dig(solution, minGivens);
  const grade = gradePuzzle(givens);
  if (!grade.difficulty) continue;
  const key = serializeGrid(givens);
  if (counts[grade.difficulty] >= TARGET[grade.difficulty] || seen.has(key)) continue;
  seen.add(key);
  counts[grade.difficulty]++;
  added.push({
    id: `${grade.difficulty}-${String(nextNumber[grade.difficulty]++).padStart(3, '0')}`,
    difficulty: grade.difficulty,
    givens: key,
    solution: serializeGrid(solution),
    score: grade.score,
    techniques: grade.techniques,
  });
}

writeFileSync(puzzlesPath, JSON.stringify([...existing, ...added], null, 1) + '\n');

console.log(`Attempts: ${attempts}, added ${added.length}`);
for (const d of DIFFICULTIES) console.log(`${d}: ${counts[d]} of ${TARGET[d]}`);
if (!full()) console.log(`Stopped at the ${MAX_MINUTES}-minute limit. Run again to keep adding.`);
