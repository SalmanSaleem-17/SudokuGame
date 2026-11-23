import { describe, expect, it } from 'vitest';

import drills from '../src/data/drills.json';
import puzzles from '../src/data/puzzles.json';
import { DIFFICULTIES, gradePuzzle, solveLogically } from '../src/engine/grader';
import { computeCandidates, findConflicts, hasValidGivens, parseGrid, serializeGrid } from '../src/engine/grid';
import { computeHint } from '../src/engine/hints';
import { DrillRecord, MIN_PUZZLES_PER_DIFFICULTY, PuzzleRecord, validatePool } from '../src/engine/pool';
import { countSolutions, solve } from '../src/engine/solver';
import { applyStep, createState } from '../src/engine/techniques';

const POOL = puzzles as PuzzleRecord[];
const DRILLS = drills as DrillRecord[];

describe('solver', () => {
  it('finds the unique solution of a bundled puzzle', () => {
    const p = POOL[0];
    expect(countSolutions(parseGrid(p.givens))).toBe(1);
    expect(serializeGrid(solve(parseGrid(p.givens))!)).toBe(p.solution);
  });

  it('detects multiple solutions', () => {
    expect(countSolutions(new Array(81).fill(0))).toBe(2);
    const loose = parseGrid(POOL[0].solution);
    // Removing a full "deadly rectangle" free of givens is not guaranteed, so blank two whole rows instead.
    for (let i = 0; i < 18; i++) loose[i] = 0;
    expect(countSolutions(loose)).toBeGreaterThan(1);
  });

  it('rejects givens that break the rules', () => {
    const grid = parseGrid(POOL[0].givens);
    const filled = grid.findIndex((v) => v !== 0);
    const emptyInRow = grid.findIndex((v, i) => v === 0 && Math.floor(i / 9) === Math.floor(filled / 9));
    grid[emptyInRow] = grid[filled];
    expect(hasValidGivens(grid)).toBe(false);
    expect(findConflicts(grid).has(emptyInRow)).toBe(true);
    expect(countSolutions(grid)).toBe(0);
    expect(solve(grid)).toBeNull();
  });
});

describe('bundled pool', () => {
  const report = validatePool(POOL, DRILLS);

  it('passes full validation: valid givens, one solution, reproducible grade', () => {
    expect(report.errors).toEqual([]);
  });

  it('has at least 10 puzzles for every enabled difficulty', () => {
    for (const d of DIFFICULTIES) {
      if (report.counts[d] > 0) expect(report.counts[d]).toBeGreaterThanOrEqual(MIN_PUZZLES_PER_DIFFICULTY);
    }
    expect(report.counts.easy).toBeGreaterThanOrEqual(10);
    expect(report.counts.medium).toBeGreaterThanOrEqual(10);
    expect(report.counts.hard).toBeGreaterThanOrEqual(10);
  });

  it('flags a tampered puzzle', () => {
    const broken = { ...POOL[0], id: 'broken', givens: POOL[0].givens.replace(/[1-9]/, '0') };
    const result = validatePool([...POOL, broken], DRILLS);
    expect(result.errors.some((e) => e.startsWith('broken:'))).toBe(true);
  });

  it('grades difficulty by the techniques on the solution path', () => {
    for (const p of POOL) {
      const t = gradePuzzle(parseGrid(p.givens)).techniques;
      const advanced = (t.lockedCandidates ?? 0) + (t.nakedPair ?? 0) + (t.hiddenPair ?? 0);
      const expert = (t.nakedTriple ?? 0) + (t.xWing ?? 0) + (t.hiddenTriple ?? 0) + (t.swordfish ?? 0) + (t.xyWing ?? 0);
      if (p.difficulty === 'easy') expect([t.nakedSingle, advanced, expert]).toEqual([undefined, 0, 0]);
      if (p.difficulty === 'medium') expect(advanced + expert).toBe(0);
      if (p.difficulty === 'hard') expect([advanced > 0, expert]).toEqual([true, 0]);
      if (p.difficulty === 'expert') expect(expert).toBeGreaterThan(0);
    }
  });
});

describe('logical solver', () => {
  it('never places a wrong digit or removes a correct candidate', () => {
    for (const p of POOL) {
      const solution = parseGrid(p.solution);
      const result = solveLogically(parseGrid(p.givens));
      expect(result.solved).toBe(true);
      for (const step of result.steps) {
        if (step.placement) expect(solution[step.placement.cell]).toBe(step.placement.digit);
        for (const e of step.eliminations) expect(solution[e.cell]).not.toBe(e.digit);
      }
    }
  });
});

describe('hints', () => {
  it('solve every bundled puzzle from the live board, one explained placement at a time', () => {
    for (const p of POOL) {
      const solution = parseGrid(p.solution);
      const values = parseGrid(p.givens);
      for (let guard = 0; guard < 81; guard++) {
        const hint = computeHint(values, solution);
        if (hint.kind === 'complete') break;
        expect(hint.kind).toBe('steps');
        if (hint.kind !== 'steps') break;
        const last = hint.steps[hint.steps.length - 1];
        expect(last.placement).toBeDefined();
        expect(solution[last.placement!.cell]).toBe(last.placement!.digit);
        expect(values[last.placement!.cell]).toBe(0);
        for (const step of hint.steps) expect(step.explanation.length).toBeGreaterThan(20);
        values[last.placement!.cell] = last.placement!.digit;
      }
      expect(serializeGrid(values)).toBe(p.solution);
    }
  });

  it('keeps only elimination steps that the final placement still follows from', () => {
    const hard = POOL.filter((p) => p.difficulty === 'hard' || p.difficulty === 'expert');
    let multiStep = 0;
    for (const p of hard) {
      const solution = parseGrid(p.solution);
      const values = parseGrid(p.givens);
      for (let guard = 0; guard < 81; guard++) {
        const hint = computeHint(values, solution);
        if (hint.kind !== 'steps') break;
        if (hint.steps.length > 1) {
          multiStep++;
          // Replaying just the kept steps must make the final single valid.
          const state = createState(values);
          for (const step of hint.steps.slice(0, -1)) applyStep(state, step);
          const last = hint.steps[hint.steps.length - 1];
          const { cell, digit } = last.placement!;
          const mask = 1 << (digit - 1);
          if (last.technique === 'nakedSingle') {
            expect(state.cands[cell]).toBe(mask);
          } else {
            const unit = last.premise[0].cells;
            expect(unit.filter((c) => state.cands[c] & mask)).toEqual([cell]);
          }
        }
        const placement = hint.steps[hint.steps.length - 1].placement!;
        values[placement.cell] = placement.digit;
      }
    }
    expect(multiStep).toBeGreaterThan(0);
  });

  it('reports wrong entries instead of a hint, and names the cells', () => {
    const p = POOL[0];
    const solution = parseGrid(p.solution);
    const values = parseGrid(p.givens);
    const cell = values.findIndex((v) => v === 0);
    values[cell] = (solution[cell] % 9) + 1;
    const hint = computeHint(values, solution);
    expect(hint.kind).toBe('blocked');
    if (hint.kind === 'blocked') expect(hint.wrongCells).toEqual([cell]);
  });

  it('reports completion and an unsupported position without inventing a move', () => {
    const p = POOL[0];
    expect(computeHint(parseGrid(p.solution), parseGrid(p.solution)).kind).toBe('complete');
    // An empty board is consistent with any solution but offers no logical step.
    expect(computeHint(new Array(81).fill(0), parseGrid(p.solution)).kind).toBe('none');
  });

  it('derives candidates from placed digits only', () => {
    const values = parseGrid(POOL[0].givens);
    const cands = computeCandidates(values);
    values.forEach((v, i) => {
      if (v !== 0) expect(cands[i]).toBe(0);
    });
  });
});
