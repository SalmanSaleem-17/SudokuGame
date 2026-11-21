/// <reference types="node" />
/**
 * Offline puzzle generator. Run with `npm run generate:puzzles`; it is never run in the app.
 * Output is deterministic for a given SEED, and is checked by `npm run validate:puzzles`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DIFFICULTIES, Difficulty, EASY_MIN_GIVENS, gradePuzzle, solveLogically } from '../src/engine/grader';
import { digitsOf, serializeGrid } from '../src/engine/grid';
import { DRILL_TECHNIQUES, DrillRecord, DrillTechnique, PuzzleRecord, findDrillSteps } from '../src/engine/pool';
import { countSolutions, solveRandom } from '../src/engine/solver';
import { applyStep, createState } from '../src/engine/techniques';

const SEED = 20261121;
const TARGET: Record<Difficulty, number> = { easy: 40, medium: 40, hard: 40, expert: 20 };
const DRILLS_PER_TECHNIQUE = 12;
const MAX_ATTEMPTS = 60000;

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

const pools: Record<Difficulty, PuzzleRecord[]> = { easy: [], medium: [], hard: [], expert: [] };
const seen = new Set<string>();
const full = () => DIFFICULTIES.every((d) => pools[d].length >= TARGET[d]);

let attempts = 0;
while (!full() && attempts < MAX_ATTEMPTS) {
  attempts++;
  const solution = solveRandom((mask) => shuffle(digitsOf(mask)));
  // Alternate between generous and sparse puzzles so every bucket fills.
  const wantEasy = pools.easy.length < TARGET.easy && attempts % 3 === 0;
  const minGivens = wantEasy ? EASY_MIN_GIVENS + 2 + Math.floor(random() * 5) : 22 + Math.floor(random() * 8);
  const givens = dig(solution, minGivens);
  const grade = gradePuzzle(givens);
  if (!grade.difficulty) continue;
  const bucket = pools[grade.difficulty];
  const key = serializeGrid(givens);
  if (bucket.length >= TARGET[grade.difficulty] || seen.has(key)) continue;
  seen.add(key);
  bucket.push({
    id: '',
    difficulty: grade.difficulty,
    givens: key,
    solution: serializeGrid(solution),
    score: grade.score,
    techniques: grade.techniques,
  });
}

const puzzles: PuzzleRecord[] = [];
for (const difficulty of DIFFICULTIES) {
  const bucket = pools[difficulty];
  if (bucket.length < 10) {
    console.warn(`${difficulty}: only ${bucket.length} found; leaving this difficulty out of the pool.`);
    continue;
  }
  bucket.sort((a, b) => a.score - b.score);
  bucket.forEach((p, i) => (p.id = `${difficulty}-${String(i + 1).padStart(3, '0')}`));
  puzzles.push(...bucket);
}

/* Practice drills: positions taken from the solution paths of bundled puzzles. */
const drills: DrillRecord[] = [];
const drillSources: Record<DrillTechnique, PuzzleRecord[]> = {
  hiddenSingle: pools.easy,
  nakedSingle: [...pools.medium, ...pools.hard, ...pools.expert].filter((p) => p.techniques.nakedSingle),
  lockedCandidates: [...pools.hard, ...pools.expert].filter((p) => p.techniques.lockedCandidates),
};
for (const technique of DRILL_TECHNIQUES) {
  let made = 0;
  for (const puzzle of shuffle(drillSources[technique].slice())) {
    if (made >= DRILLS_PER_TECHNIQUE) break;
    const givens = [...puzzle.givens].map(Number);
    const path = solveLogically(givens).steps;
    const state = createState(givens);
    let chosen: number[] | null = null;
    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const filled = state.values.filter((v) => v !== 0).length;
      // Hidden-single drills start mid-game so the answer is not a trivial last cell.
      const suitable =
        step.technique === technique &&
        (technique !== 'hiddenSingle' || (filled >= 40 && filled <= 60)) &&
        findDrillSteps(state.values, technique).length > 0;
      if (suitable) {
        chosen = state.values.slice();
        break;
      }
      applyStep(state, step);
    }
    if (!chosen) continue;
    made++;
    drills.push({ id: `${technique}-${String(made).padStart(2, '0')}`, technique, grid: serializeGrid(chosen) });
  }
}

const dataDir = join(__dirname, '..', 'src', 'data');
writeFileSync(join(dataDir, 'puzzles.json'), JSON.stringify(puzzles, null, 1) + '\n');
writeFileSync(join(dataDir, 'drills.json'), JSON.stringify(drills, null, 1) + '\n');

console.log(`Attempts: ${attempts}`);
for (const d of DIFFICULTIES) console.log(`${d}: ${pools[d].length}`);
console.log(`Drills: ${drills.length}`);
