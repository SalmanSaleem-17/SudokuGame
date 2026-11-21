/// <reference types="node" />
/**
 * Build-time validation of the bundled puzzle pool: `npm run validate:puzzles`.
 * Exits non-zero if any puzzle has invalid givens, is not uniquely solvable, or is
 * graded differently from its stored difficulty.
 */
import drills from '../src/data/drills.json';
import puzzles from '../src/data/puzzles.json';
import { DIFFICULTIES } from '../src/engine/grader';
import { DRILL_TECHNIQUES, DrillRecord, PuzzleRecord, validatePool } from '../src/engine/pool';

const report = validatePool(puzzles as PuzzleRecord[], drills as DrillRecord[]);

console.log('Verified puzzles per difficulty:');
for (const d of DIFFICULTIES) console.log(`  ${d.padEnd(7)} ${report.counts[d]}`);
console.log('Verified practice drills:');
for (const t of DRILL_TECHNIQUES) console.log(`  ${t.padEnd(17)} ${report.drillCounts[t]}`);

if (report.errors.length > 0) {
  console.error(`\n${report.errors.length} problem(s):`);
  for (const error of report.errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log('\nAll bundled puzzles have valid givens and exactly one solution.');
