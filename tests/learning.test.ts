import { describe, expect, it } from 'vitest';

import { PUZZLES } from '../src/data/pool';
import { PEERS, parseGrid } from '../src/engine/grid';
import {
  MAX_MISTAKE_REVIEW, TECHNIQUE_PACK_IDS, TECHNIQUE_PACKS, isMistakeReview, logicalFrame,
  mistakeLogic, mistakePosition, nextGuidePath, puzzlesForPack, techniqueExample,
} from '../src/game/learning';
import { createSession, createTechniqueSession, enterDigit, isValidSession, redoMove, toggleNote, undoMove } from '../src/game/session';

const options = { smartNotes: true };
const wrong = (digit: number) => (digit % 9) + 1;

describe('technique packs', () => {
  it.each(TECHNIQUE_PACK_IDS)('teaches %s using a verified pattern in every full puzzle', (pack) => {
    const puzzles = puzzlesForPack(PUZZLES, pack);
    expect(puzzles.length).toBeGreaterThanOrEqual(5);
    for (const puzzle of puzzles) {
      const example = techniqueExample(puzzle, pack)!;
      expect(example).not.toBeNull();
      const frame = logicalFrame(example, example.steps.length - 1);
      expect(TECHNIQUE_PACKS[pack].techniques).toContain(frame.step.technique);
      expect(frame.overlay.candidates.size).toBeGreaterThan(0);
      expect(frame.step.eliminations.length).toBeGreaterThan(0);
      for (const { cell, digit } of frame.step.eliminations) expect(Number(puzzle.solution[cell])).not.toBe(digit);
    }
  });

  it.each(TECHNIQUE_PACK_IDS)('guides a %s puzzle through to completion with correct placements', (pack) => {
    const puzzle = puzzlesForPack(PUZZLES, pack)[0];
    let session = createTechniqueSession(puzzle, pack, 'test', 7);
    expect(isValidSession(session)).toBe(true);
    let taught = false;
    for (let i = 0; i < 81 && !session.completed; i++) {
      const path = nextGuidePath(session.values, session.solution)!;
      expect(path).not.toBeNull();
      taught ||= path.steps.some((step) => TECHNIQUE_PACKS[pack].techniques.includes(step.technique));
      const { cell, digit } = path.steps.at(-1)!.placement!;
      expect(session.solution[cell]).toBe(digit);
      session = enterDigit(session, cell, digit, options);
    }
    expect(session.completed).toBe(true);
    expect(session.mistakes).toBe(0);
    expect(taught).toBe(true);
  });
});

describe('mistake review', () => {
  it('records every wrong entry even with live mistakes off and keeps undo and redo from duplicating it', () => {
    const initial = createSession(PUZZLES[0], 'classic', 'test', 1, null, { timerMinutes: 0, mistakes: 'off' });
    const [a, b, c] = initial.values.flatMap((value, cell) => value === 0 ? [cell] : []);
    const before = enterDigit(enterDigit(initial, a, initial.solution[a], options), b, wrong(initial.solution[b]), options);
    const after = enterDigit(before, c, wrong(initial.solution[c]), options);
    expect(after.mistakes).toBe(0);
    const attempt = after.mistakeReview![1];
    expect(attempt).toMatchObject({ cell: c, entered: wrong(initial.solution[c]), correct: initial.solution[c] });
    expect([attempt.board[a], attempt.board[b], attempt.board[c]]).toEqual([String(initial.solution[a]), '0', '0']);
    expect(redoMove(undoMove(after)).mistakeReview).toEqual(after.mistakeReview);
    expect(toggleNote(initial, b, wrong(initial.solution[b])).mistakeReview).toBeUndefined();
    expect(enterDigit(initial, c, 10, options)).toBe(initial);
    const restored: unknown = JSON.parse(JSON.stringify(after));
    expect(isValidSession(restored)).toBe(true);
    expect(restored).toEqual(after);
  });

  it('shows the conflict on the original position and reaches the correct number through logical deductions', () => {
    const s = createSession(PUZZLES[0], 'classic', 'test', 1);
    const cell = s.values.findIndex((value) => value === 0);
    const blocker = PEERS[cell].find((peer) => s.givens[peer] !== 0)!;
    const entered = s.givens[blocker];
    const attempt = enterDigit(s, cell, entered, options).mistakeReview![0];
    const position = mistakePosition(attempt);
    expect(position.blockers).toContain(blocker);
    expect(position.values[cell]).toBe(entered);
    const logic = mistakeLogic(attempt, s.givens)!;
    const frame = logicalFrame(logic.path, logic.path.steps.length - 1);
    expect(frame.values[cell]).toBe(0);
    expect(frame.step.placement).toEqual({ cell, digit: s.solution[cell] });
  });

  it('retains only the most recent review entries and validates the saved board shape', () => {
    let session = createSession(PUZZLES[0], 'classic', 'test', 1);
    const [first, later] = session.values.flatMap((value, cell) => value === 0 ? [cell] : []);
    session = enterDigit(session, first, wrong(session.solution[first]), options);
    const wrongLater = wrong(session.solution[later]);
    for (let i = 0; i < MAX_MISTAKE_REVIEW; i++) {
      session = enterDigit(session, later, wrongLater, options);
      session = enterDigit(session, later, wrongLater, options);
    }
    expect(session.mistakes).toBe(MAX_MISTAKE_REVIEW + 1);
    expect(session.mistakeReview).toHaveLength(MAX_MISTAKE_REVIEW);
    expect(session.mistakeReview?.every((attempt) => attempt.cell === later)).toBe(true);
    const attempt = session.mistakeReview![0];
    expect(parseGrid(attempt.board)[later]).toBe(0);
    expect(isMistakeReview([{ ...attempt, board: '.' }])).toBe(false);
    expect(isMistakeReview([{ ...attempt, entered: attempt.correct }])).toBe(false);
  });
});
