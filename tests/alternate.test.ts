import { describe, expect, it } from 'vitest';

import {
  ALTERNATE_MODES, alternatePuzzleCount, applyAlternateInput, createAlternateProgress, getAlternatePuzzle,
  isAlternateComplete, isAlternateMode, loadAlternateProgress, undoAlternateInput,
} from '../src/game/alternate';
import {
  alternateConflicts, countAlternateSolutions, digitBit, regularRegions,
} from '../src/game/alternateRules';
import type { AlternateMode } from '../src/game/alternateRules';

function contiguous(cells: readonly number[], size: number): boolean {
  const seen = new Set<number>();
  const pending = [cells[0]];
  const members = new Set(cells);
  while (pending.length) {
    const cell = pending.pop()!;
    if (seen.has(cell)) continue;
    seen.add(cell);
    const neighbors = [cell - size, cell + size];
    if (cell % size > 0) neighbors.push(cell - 1);
    if (cell % size < size - 1) neighbors.push(cell + 1);
    for (const neighbor of neighbors) {
      if (members.has(neighbor) && !seen.has(neighbor)) pending.push(neighbor);
    }
  }
  return seen.size === cells.length;
}

const modes = Object.keys(ALTERNATE_MODES).filter(isAlternateMode);

describe('mini and variant puzzle catalogs', () => {
  it.each(modes)('validates the geometry and unique solution for every %s puzzle', (mode: AlternateMode) => {
    expect(alternatePuzzleCount(mode)).toBeGreaterThanOrEqual(3);
    for (let index = 0; index < alternatePuzzleCount(mode); index++) {
      const puzzle = getAlternatePuzzle(mode, index);
      const { size, givens, solution, units, cages } = puzzle;
      const digits = Array.from({ length: size }, (_, i) => i + 1);
      expect(givens).toHaveLength(size * size);
      expect(givens).toContain(0);
      expect(givens.every((digit, cell) => digit === 0 || digit === solution[cell])).toBe(true);
      expect(units).toHaveLength(size * 3 + (mode === 'diagonal' ? 2 : 0));
      for (const unit of units) {
        expect(unit.map((cell) => solution[cell]).sort((a, b) => a - b)).toEqual(digits);
      }
      if (mode === 'irregular') {
        expect(puzzle.regions).not.toEqual(regularRegions(9));
        expect(units.slice(2 * size).every((unit) => contiguous(unit, size))).toBe(true);
      }
      if (mode === 'killer') {
        const covered = cages.flatMap((cage) => cage.cells).sort((a, b) => a - b);
        expect(covered).toEqual(Array.from({ length: 81 }, (_, i) => i));
        for (const cage of cages) {
          const cageDigits = cage.cells.map((cell) => solution[cell]);
          expect(cageDigits.reduce((sum, digit) => sum + digit, 0)).toBe(cage.sum);
          expect(new Set(cageDigits).size).toBe(cage.cells.length);
          expect(contiguous(cage.cells, size)).toBe(true);
        }
      }
      expect(alternateConflicts(puzzle, solution, false).size).toBe(0);
      expect(countAlternateSolutions(puzzle)).toBe(1);
    }
  });

  it('checks diagonals and outlines along with rows and columns', () => {
    const diagonal = getAlternatePuzzle('diagonal', 0);
    const diagonalValues = Array<number>(81).fill(0);
    diagonalValues[0] = diagonalValues[40] = 3;
    expect([...alternateConflicts(diagonal, diagonalValues, false)]).toEqual([0, 40]);

    const irregular = getAlternatePuzzle('irregular', 0);
    const options = irregular.units.slice(18).flatMap((unit) => unit.flatMap((cell) =>
      unit.filter((other) => Math.floor(cell / 9) !== Math.floor(other / 9) && cell % 9 !== other % 9
        && regularRegions(9)[cell] !== regularRegions(9)[other]).map((other) => [cell, other])));
    const [cell, other] = options[0];
    const irregularValues = Array<number>(81).fill(0);
    irregularValues[cell] = irregularValues[other] = 7;
    expect(alternateConflicts(irregular, irregularValues, false)).toEqual(new Set([cell, other]));
  });

  it('flags a cage whose remaining digits cannot reach the sum', () => {
    const puzzle = getAlternatePuzzle('killer', 0);
    const cage = puzzle.cages.find((entry) => entry.combinations.every((mask) => !(mask & digitBit(9))));
    expect(cage).toBeDefined();
    const [cell] = cage!.cells;
    const values = Array<number>(81).fill(0);
    values[cell] = 9;
    expect([...alternateConflicts(puzzle, values, false)]).toEqual([cell]);
  });
});

describe('alternate progress', () => {
  it('round-trips a later puzzle and undoes a move with peer note cleanup', () => {
    const puzzle = getAlternatePuzzle('mini-6', 2);
    const cell = puzzle.givens.findIndex((digit) => digit === 0);
    const peer = puzzle.peers[cell].find((i) => puzzle.givens[i] === 0)!;
    const digit = puzzle.solution[cell];
    const initial = createAlternateProgress(puzzle);
    const annotated = applyAlternateInput(puzzle, initial, peer, digit, true, true);
    const played = applyAlternateInput(puzzle, annotated, cell, digit, false, true);
    expect(played.notes[peer]).toBe(0);
    expect(played.values[cell]).toBe(digit);
    const restored = loadAlternateProgress(puzzle.mode, JSON.parse(JSON.stringify(played)));
    expect(restored.index).toBe(2);
    expect(restored.progress).toEqual(played);
    expect(undoAlternateInput(restored.progress)).toEqual(annotated);
  });

  it('retains wrong entries for correction and locks givens and completed boards', () => {
    const puzzle = getAlternatePuzzle('mini-4', 0);
    const initial = createAlternateProgress(puzzle);
    const fixed = puzzle.givens.findIndex(Boolean);
    const empty = puzzle.givens.indexOf(0);
    expect(applyAlternateInput(puzzle, initial, fixed, 1, false, false)).toBe(initial);
    expect(applyAlternateInput(puzzle, initial, empty, 5, false, false)).toBe(initial);
    const wrongDigit = puzzle.solution[empty] % puzzle.size + 1;
    const wrong = applyAlternateInput(puzzle, initial, empty, wrongDigit, false, false);
    expect(wrong.values[empty]).toBe(wrongDigit);
    expect(alternateConflicts(puzzle, wrong.values, true).has(empty)).toBe(true);
    expect(isAlternateComplete(puzzle, wrong)).toBe(false);
    const solved = puzzle.givens.reduce((progress, given, cell) => given
      ? progress
      : applyAlternateInput(puzzle, progress, cell, puzzle.solution[cell], false, false), wrong);
    expect(isAlternateComplete(puzzle, solved)).toBe(true);
    expect(applyAlternateInput(puzzle, solved, empty, 0, false, false)).toBe(solved);
  });

  it('rejects invalid board contents and preserves a playable board if only undo data is invalid', () => {
    const puzzle = getAlternatePuzzle('mini-4', 3);
    const initial = createAlternateProgress(puzzle);
    const bad = { ...initial, values: Array<number>(16).fill(0) };
    expect(loadAlternateProgress(puzzle.mode, bad)).toEqual({ index: 3, progress: initial });
    expect(loadAlternateProgress('mini-6', initial).index).toBe(0);
    const empty = puzzle.givens.indexOf(0);
    const played = applyAlternateInput(puzzle, initial, empty, puzzle.solution[empty], false, false);
    const badUndo = { ...played, undo: [[{ cell: 99, value: 0, notes: 0 }]] };
    expect(loadAlternateProgress(puzzle.mode, badUndo).progress).toEqual({ ...played, undo: [] });
  });
});
