import { describe, expect, it } from 'vitest';

import { getPuzzle, puzzlesOf } from '../src/data/pool';
import { parseGrid } from '../src/engine/grid';
import {
  DEFAULT_SPEED_OPTIONS, EMPTY_SPEED_PROGRESS, SPEED_MINUTES, createSpeedClock, enterSpeedDigit, finishSpeedRound,
  legacySpeedRecord, quitSpeedRound, readSpeedProgress, speedPuzzleForRound, speedRecord, speedRemainingMs, startSpeedRound, type SpeedProgress,
} from '../src/game/eventSpeed';
import {
  WEEKLY_DIFFICULTIES, isWeeklyWeekKey, localWeekKey, weeklyBadgeWeeks, weeklyProgress, weeklyPuzzleFor,
  type WeeklyCompletion,
} from '../src/game/events';

describe('weekly challenge', () => {
  const week = '2026-11-23';

  it('uses the local calendar Monday through Sunday and validates date keys', () => {
    expect(localWeekKey(new Date(2026, 10, 29, 23, 59))).toBe(week);
    expect(localWeekKey(new Date(2026, 10, 30, 0, 0))).toBe('2026-11-30');
    expect(localWeekKey(new Date(2027, 0, 1))).toBe('2026-12-28');
    expect(isWeeklyWeekKey(week)).toBe(true);
    expect(isWeeklyWeekKey('2026-11-24')).toBe(false);
    expect(isWeeklyWeekKey('2026-02-30')).toBe(false);
    expect(isWeeklyWeekKey('2026-11-2')).toBe(false);
  });

  it('assigns a stable, increasingly difficult set and rotates every puzzle in its pool', () => {
    expect(WEEKLY_DIFFICULTIES.map((difficulty) => weeklyPuzzleFor(week, difficulty).difficulty)).toEqual(WEEKLY_DIFFICULTIES);
    expect(weeklyPuzzleFor(week, 'easy')).toBe(weeklyPuzzleFor(week, 'easy'));
    expect(weeklyPuzzleFor(week, 'easy')).not.toBe(weeklyPuzzleFor('2026-11-30', 'easy'));
    const catalogSize = puzzlesOf('hard').length;
    const weeks = Array.from({ length: catalogSize }, (_, index) => localWeekKey(new Date(2026, 10, 23 + index * 7)));
    expect(new Set(weeks.map((key) => weeklyPuzzleFor(key, 'hard').id)).size).toBe(catalogSize);
  });

  it('advances stages and earns one badge per completed week', () => {
    const done = (difficulty: WeeklyCompletion['difficulty'], dateKey = week, slot = 'weekly') => ({ slot, dateKey, difficulty });
    const easy = done('easy');
    const medium = done('medium');
    const hard = done('hard');
    expect(weeklyProgress(week, [done('easy', week, 'daily')])).toEqual({ completed: [], next: 'easy', earned: false });
    expect(weeklyProgress(week, [easy, easy, done('medium', '2026-11-16')])).toEqual({
      completed: ['easy'], next: 'medium', earned: false,
    });
    expect(weeklyProgress(week, [easy, medium])).toEqual({ completed: ['easy', 'medium'], next: 'hard', earned: false });
    expect(weeklyProgress(week, [hard, easy, medium])).toEqual({ completed: [...WEEKLY_DIFFICULTIES], next: null, earned: true });
    expect(weeklyBadgeWeeks([
      easy, medium, hard, hard, done('hard', '2026-11-16'), done('easy', '2026-11-30'), done('medium', '2026-11-30'),
      done('hard', '2026-11-30'), ...WEEKLY_DIFFICULTIES.map((difficulty) => done(difficulty, '2026-12-01')),
    ])).toEqual(['2026-11-30', week]);
  });
});

describe('speed round', () => {
  const startAt = 50_000;
  const easy = DEFAULT_SPEED_OPTIONS;
  const freshRound = (options = easy) => startSpeedRound(EMPTY_SPEED_PROGRESS, options, startAt, () => 0);
  const solutionFor = (round: NonNullable<SpeedProgress['round']>) => speedPuzzleForRound(round)!.solution;

  it.each([
    ['easy', 4],
    ['medium', 6],
    ['hard', 9],
    ['expert', 9],
  ] as const)('starts %s on a board %i cells wide', (difficulty, size) => {
    const round = freshRound({ difficulty, minutes: 10 }).round!;
    expect(round.values).toHaveLength(size * size);
    const puzzle = speedPuzzleForRound(round)!;
    expect(puzzle.size).toBe(size);
    if (size === 9) expect(getPuzzle(round.puzzleId)?.difficulty).toBe(difficulty);
    else expect(puzzle.alternate?.size).toBe(size);
  });

  it('counts each correct square once and keeps wrong digits off the board', () => {
    const fresh = freshRound();
    const round = fresh.round!;
    const cell = round.values.indexOf(0);
    const digit = solutionFor(round)[cell];
    const wrong = digit === 4 ? 1 : digit + 1;
    expect(enterSpeedDigit(fresh, cell, 5, startAt + 1)).toBe(fresh);
    const miss = enterSpeedDigit(fresh, cell, wrong, startAt + 1);
    expect(miss.round).toMatchObject({ values: round.values, score: 0, mistakes: 1 });
    const hit = enterSpeedDigit(miss, cell, digit, startAt + 2);
    expect(hit.round).toMatchObject({ score: 1, mistakes: 1 });
    expect(hit.round!.values[cell]).toBe(digit);
    expect(enterSpeedDigit(hit, cell, digit, startAt + 3)).toBe(hit);
    expect(enterSpeedDigit(hit, -1, digit, startAt + 3)).toBe(hit);
    expect(startSpeedRound(hit, { difficulty: 'expert', minutes: 10 }, startAt + 3)).toBe(hit);
  });

  it.each(SPEED_MINUTES)('preserves the %i minute deadline across a reload and rejects the exact cutoff', (minutes) => {
    const format = { difficulty: 'medium' as const, minutes };
    const fresh = freshRound(format);
    const round = fresh.round!;
    const cell = round.values.indexOf(0);
    const digit = solutionFor(round)[cell];
    const deadline = startAt + minutes * 60_000;
    expect(speedRemainingMs(round, deadline - 1)).toBe(1);
    expect(enterSpeedDigit(fresh, cell, digit, deadline - 1).round?.score).toBe(1);
    const restored = readSpeedProgress(JSON.parse(JSON.stringify(fresh)));
    const expired = enterSpeedDigit(restored, cell, digit, deadline);
    expect(expired.round).toMatchObject({ format, finished: true, score: 0, values: round.values });
    expect(speedRecord(expired, format).rounds).toBe(1);
    expect(finishSpeedRound(expired, deadline + 1)).toBe(expired);
  });

  it('does not gain time from a wall-clock rollback and counts time spent suspended', () => {
    let wall = 42_000;
    let monotonic = 100;
    const now = createSpeedClock(() => wall, () => monotonic);
    expect(now()).toBe(42_000);
    wall = 41_000;
    monotonic = 110;
    expect(now()).toBe(42_010);
    wall = 43_700;
    expect(now()).toBe(43_700);
    wall = 42_001;
    monotonic = 130;
    expect(now()).toBe(43_720);
  });

  it('queues another board without resetting the score or deadline and keeps separate records', () => {
    const fresh = freshRound();
    const round = fresh.round!;
    const solution = solutionFor(round);
    const solved = round.values.reduce(
      (progress, value, cell) => value === 0 ? enterSpeedDigit(progress, cell, solution[cell], startAt + 10) : progress,
      fresh,
    );
    const score = round.values.filter((value) => value === 0).length;
    expect(solved.round).toMatchObject({ startedAt: startAt, score, mistakes: 0 });
    expect(solved.round!.puzzleId).not.toBe(round.puzzleId);
    expect(solved.round!.values).toContain(0);
    expect(readSpeedProgress(solved)).toEqual(solved);
    const replay = startSpeedRound(solved, easy, startAt + 60_000, () => 0);
    expect(speedRecord(replay, easy)).toEqual({
      best: score, rounds: 1, correct: score, mistakes: 0, recent: [{ startedAt: startAt, score, mistakes: 0 }],
    });
    expect(speedRecord(replay, { ...easy, minutes: 2 }).best).toBe(0);
    expect(speedRecord(replay, { ...easy, difficulty: 'medium' }).best).toBe(0);
    expect(replay.round).toMatchObject({ score: 0, bestBefore: score, finished: false });
    expect(replay.round!.puzzleId).not.toBe(solved.round!.puzzleId);
    expect(readSpeedProgress(replay)).toEqual(replay);
  });

  it('preserves an original active 9×9 round and updates its legacy statistics exactly once', () => {
    const puzzle = puzzlesOf('easy')[0];
    const givens = parseGrid(puzzle.givens);
    const cell = givens.indexOf(0);
    const values = givens.slice();
    values[cell] = parseGrid(puzzle.solution)[cell];
    const oldSave = {
      version: 1,
      best: 1,
      round: { startedAt: startAt, puzzleId: puzzle.id, values, score: 1, mistakes: 2, bestBefore: 0, finished: false },
    };
    const legacy = readSpeedProgress(oldSave);
    expect(legacy.round).toMatchObject({ format: { difficulty: 'legacy', minutes: 1 }, values });
    expect(legacySpeedRecord(legacy)).toMatchObject({ best: 0, rounds: 0 });
    const finished = finishSpeedRound(legacy, startAt + 60_000);
    expect(legacySpeedRecord(finished)).toMatchObject({ best: 1, rounds: 1, correct: 1, mistakes: 2 });
    const alreadyFinished = readSpeedProgress({ ...oldSave, round: { ...oldSave.round, finished: true } });
    expect(alreadyFinished).toEqual(finished);
    expect(readSpeedProgress(finished)).toEqual(finished);
    expect(speedRecord(finished, easy).best).toBe(0);
  });

  it('quits only the active round and preserves previous results after reloading', () => {
    const fresh = freshRound();
    const cell = fresh.round!.values.indexOf(0);
    const first = enterSpeedDigit(fresh, cell, solutionFor(fresh.round!)[cell], startAt + 1);
    const secondStart = startAt + 60_000;
    const second = startSpeedRound(first, easy, secondStart, () => 0);
    const discarded = quitSpeedRound(second, secondStart, secondStart + 1);
    expect(discarded.round).toBeNull();
    expect(discarded.records).toBe(second.records);
    expect(speedRecord(discarded, easy)).toMatchObject({ best: 1, rounds: 1, correct: 1 });
    expect(readSpeedProgress(JSON.parse(JSON.stringify(discarded)))).toEqual(discarded);
    expect(quitSpeedRound(second, startAt, secondStart + 1)).toBe(second);
  });

  it('keeps a result when time runs out before the quit confirmation is accepted', () => {
    const fresh = freshRound();
    const cell = fresh.round!.values.indexOf(0);
    const played = enterSpeedDigit(fresh, cell, solutionFor(fresh.round!)[cell], startAt + 1);
    const deadline = startAt + 60_000;
    const expired = quitSpeedRound(played, startAt, deadline);
    expect(expired).toEqual(finishSpeedRound(played, deadline));
    expect(quitSpeedRound(expired, startAt, deadline + 1)).toBe(expired);
  });

  it('keeps the original best even when its puzzle snapshot is missing', () => {
    const legacy = readSpeedProgress({ version: 1, best: 15, round: { puzzleId: 'missing' } });
    expect(legacy.round).toBeNull();
    expect(legacySpeedRecord(legacy)?.best).toBe(15);
    expect(readSpeedProgress({ version: 1, best: -5 })).toBe(EMPTY_SPEED_PROGRESS);
  });
});
