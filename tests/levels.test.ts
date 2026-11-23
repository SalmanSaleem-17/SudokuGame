import { describe, expect, it, vi } from 'vitest';

import { MockAdProvider } from '../src/ads/mockProvider';
import { RewardController } from '../src/ads/rewardController';
import { puzzlesOf } from '../src/data/pool';
import { DIFFICULTIES } from '../src/engine/grader';
import { computeCandidates } from '../src/engine/grid';
import { achievementsFor, isEarned } from '../src/game/achievements';
import { getAlternatePuzzle } from '../src/game/alternate';
import { countAlternateSolutions } from '../src/game/alternateRules';
import {
  LEVEL_COUNT, MAX_EXTRA_MISTAKES, isLevelUnlocked, levelProgress, levelPuzzle, levelRules, levelStars, miniLevelIndex, nextLevel,
} from '../src/game/levels';
import { MINI_CLASSIC_KEY, MINI_LEVEL_KEY, createMiniLevel, enterMiniClassic, miniClassicStatus, miniClassicTimeLimit, miniMistakeLimit, readMiniClassic, type MiniClassicSession } from '../src/game/miniClassic';
import { completionXp, playerLevel, rewardsForCompletion, xpForLevel, type RewardResult } from '../src/game/rewards';
import {
  createLevelSession, createSession, enterDigit, fillNotes, getMistakeLimit, getSessionFailure, getTimeLimitMs,
  isValidSession, setTint, undoMove, type Session,
} from '../src/game/session';
import { currentStreak, isOnTime, longestStreak, repairableDay, streakDays } from '../src/game/streak';
import { InvalidBackupError, Repository } from '../src/storage/repository';
import { createMemoryDb, nodeDriver } from './helpers';

const SMART = { smartNotes: true };
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

function result(overrides: Partial<RewardResult> & { sessionId: string }): RewardResult {
  return { slot: 'classic', difficulty: 'hard', dateKey: null, mistakes: 1, hints: 1, completedAt: at(2026, 11, 1), ...overrides };
}

function solve(session: Session): Session {
  let s = session;
  for (let cell = 0; cell < 81; cell++) if (s.values[cell] === 0) s = enterDigit(s, cell, s.solution[cell], SMART);
  return s;
}

function wrongEntries(session: Session, count: number): Session {
  let s = session;
  const empties = s.values.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < count; i++) s = enterDigit(s, empties[i], (s.solution[empties[i]] % 9) + 1, SMART);
  return s;
}

const BOARD_TRACKS = ['hard', 'expert'] as const;
const MINI_TRACKS = [['easy', 'mini-4'], ['medium', 'mini-6']] as const;

function solveMini(session: MiniClassicSession): MiniClassicSession {
  const { solution } = getAlternatePuzzle(session.mode, session.index);
  let s = session;
  solution.forEach((digit, cell) => {
    if (s.progress.values[cell] === 0) s = enterMiniClassic(s, cell, digit, false, true);
  });
  return s;
}

const startLevel = (difficulty: (typeof BOARD_TRACKS)[number], number: number, id = 'lvl') =>
  createLevelSession(levelPuzzle(difficulty, number), levelRules(difficulty, number), id, 1);

describe('levels', () => {
  it('gives Hard and Expert 30 distinct 9×9 puzzles of that difficulty, easiest first', () => {
    for (const difficulty of BOARD_TRACKS) {
      const track = Array.from({ length: LEVEL_COUNT }, (_, i) => levelPuzzle(difficulty, i + 1));
      expect(new Set(track.map((p) => p.id)).size).toBe(LEVEL_COUNT);
      expect(track.every((p) => p.difficulty === difficulty)).toBe(true);
      const scores = track.map((p) => p.score);
      expect(scores).toEqual([...scores].sort((a, b) => a - b));
    }
    expect(() => levelPuzzle('hard', 0)).toThrow();
    expect(() => levelPuzzle('hard', 31)).toThrow();
    // Easy and Medium levels are not played on a 9×9 board.
    expect(() => levelPuzzle('easy', 1)).toThrow();
    expect(() => levelPuzzle('medium', 1)).toThrow();
  });

  it('gives Easy 30 distinct 4×4 puzzles and Medium 30 distinct 6×6 puzzles, each with one solution', () => {
    for (const [, mode] of MINI_TRACKS) {
      const track = Array.from({ length: LEVEL_COUNT }, (_, i) => getAlternatePuzzle(mode, miniLevelIndex(i + 1)));
      expect(new Set(track.map((p) => p.givens.join(''))).size).toBe(LEVEL_COUNT);
      expect(track.every((p) => p.size === (mode === 'mini-4' ? 4 : 6))).toBe(true);
      for (const puzzle of track) expect(countAlternateSolutions(puzzle, 2)).toBe(1);
      // Later levels give fewer starting digits.
      const givens = track.map((p) => p.givens.filter((digit) => digit !== 0).length);
      expect(givens).toEqual([...givens].sort((a, b) => b - a));
      expect(givens[0]).toBeGreaterThan(givens[LEVEL_COUNT - 1]);
    }
    expect(() => miniLevelIndex(31)).toThrow();
  });

  it('keeps 9×9 level puzzles fixed when more puzzles are added to the pool later', () => {
    // Levels only draw from the first puzzles of each difficulty.
    const limit = { hard: 80, expert: 50 } as const;
    for (const difficulty of BOARD_TRACKS) {
      expect(puzzlesOf(difficulty).length).toBeGreaterThanOrEqual(limit[difficulty]);
      for (let n = 1; n <= LEVEL_COUNT; n++) {
        expect(Number(levelPuzzle(difficulty, n).id.split('-')[1])).toBeLessThanOrEqual(limit[difficulty]);
      }
    }
  });

  it('sets one time limit and one mistake limit per difficulty', () => {
    const minutes = { easy: 2, medium: 4, hard: 8, expert: 10 } as const;
    const mistakes = { easy: 3, medium: 5, hard: 8, expert: 10 } as const;
    for (const difficulty of DIFFICULTIES) {
      const rules = Array.from({ length: LEVEL_COUNT }, (_, i) => levelRules(difficulty, i + 1));
      expect(rules.every((rule) => rule.timeLimitSec === minutes[difficulty] * 60)).toBe(true);
      expect(rules.every((rule) => rule.mistakeLimit === mistakes[difficulty])).toBe(true);
    }
  });

  it('awards stars by solving time: fast, good, or simply finished', () => {
    const sec = (seconds: number) => seconds * 1000;
    const marks = (difficulty: (typeof DIFFICULTIES)[number], three: number, two: number) =>
      expect([three, three + 1, two, two + 1].map((seconds) => levelStars(difficulty, sec(seconds)))).toEqual([3, 2, 2, 1]);
    marks('easy', 30, 60); // 3 stars within 0:30, 2 within 1:00
    marks('medium', 60, 120); // 3 stars within 1:00, 2 within 2:00
    marks('hard', 180, 300); // 3 stars within 3:00, 2 within 5:00
    marks('expert', 240, 360); // 3 stars within 4:00, 2 within 6:00
    // Any finish inside the limit still earns one star.
    expect(levelStars('hard', sec(479))).toBe(1);
    expect(levelStars('expert', sec(599))).toBe(1);
  });

  it('ends a 9×9 level at its mistake limit, and an extra mistake lets play continue', () => {
    const fresh = startLevel('hard', 30);
    expect(getMistakeLimit(fresh)).toBe(8);
    expect(getTimeLimitMs(fresh)).toBe(8 * 60_000);
    expect(getSessionFailure(wrongEntries(fresh, 7))).toBeNull();

    const failed = wrongEntries(fresh, 8);
    expect(failed.mistakes).toBe(8);
    expect(getSessionFailure(failed)).toBe('mistakes');
    // A finished attempt accepts no more moves.
    expect(enterDigit(failed, failed.values.indexOf(0), 1, SMART)).toBe(failed);

    const continued = { ...failed, level: { ...failed.level!, extraMistakes: 1 } };
    expect(getMistakeLimit(continued)).toBe(9);
    expect(getSessionFailure(continued)).toBeNull();
    expect(getSessionFailure(wrongEntries(continued, 5))).toBe('mistakes');
    expect(MAX_EXTRA_MISTAKES).toBe(2);
  });

  it('ends a 9×9 level when its ten minutes run out', () => {
    const session = startLevel('expert', 1);
    expect(getSessionFailure({ ...session, elapsedMs: 10 * 60_000 - 1 })).toBeNull();
    expect(getSessionFailure({ ...session, elapsedMs: 10 * 60_000 })).toBe('time');
  });

  it('plays Easy and Medium levels on small boards with their own limits', () => {
    const easy = createMiniLevel('mini-4', miniLevelIndex(30), levelRules('easy', 30), 'e30', 1);
    expect(getAlternatePuzzle(easy.mode, easy.index).size).toBe(4);
    expect(miniClassicTimeLimit(easy)).toBe(2 * 60_000);
    expect(miniMistakeLimit(easy)).toBe(3);
    expect(miniClassicStatus({ ...easy, elapsedMs: 2 * 60_000 - 1 })).toBe('playing');
    expect(miniClassicStatus({ ...easy, elapsedMs: 2 * 60_000 })).toBe('time');

    const medium = createMiniLevel('mini-6', miniLevelIndex(1), levelRules('medium', 1), 'm1', 1);
    expect(getAlternatePuzzle(medium.mode, medium.index).size).toBe(6);
    expect(miniClassicTimeLimit(medium)).toBe(4 * 60_000);
    expect(miniMistakeLimit(medium)).toBe(5);

    // Three wrong digits end the Easy level; one extra mistake reopens it.
    const { solution } = getAlternatePuzzle(easy.mode, easy.index);
    let failed = easy;
    const empties = easy.progress.values.map((value, cell) => (value === 0 ? cell : -1)).filter((cell) => cell >= 0);
    for (let i = 0; i < 3; i++) failed = enterMiniClassic(failed, empties[i], (solution[empties[i]] % 4) + 1, false, true);
    expect(failed.mistakes).toBe(3);
    expect(miniClassicStatus(failed)).toBe('mistakes');
    const continued = { ...failed, level: { ...failed.level!, extraMistakes: 1 } };
    expect(miniClassicStatus(continued)).toBe('playing');
    expect(miniClassicStatus(solveMini(createMiniLevel('mini-4', miniLevelIndex(2), levelRules('easy', 2), 'e2', 1)))).toBe('solved');
    // A saved small-board level survives a round trip; one with broken rules is rejected.
    expect(readMiniClassic(JSON.parse(JSON.stringify(continued)))).toMatchObject({ id: 'e30', level: { number: 30, extraMistakes: 1 } });
    expect(readMiniClassic({ ...continued, level: { number: 30 } })).toBeNull();
  });

  it('unlocks levels one at a time and keeps the best stars', () => {
    const empty = levelProgress([]);
    expect(isLevelUnlocked(empty.easy, 1)).toBe(true);
    expect(isLevelUnlocked(empty.easy, 2)).toBe(false);
    expect(nextLevel(empty.easy)).toBe(1);

    const progress = levelProgress([
      { slot: 'level', difficulty: 'easy', level: 1, stars: 1 },
      { slot: 'level', difficulty: 'easy', level: 1, stars: 3 },
      { slot: 'level', difficulty: 'easy', level: 1, stars: 2 },
      { slot: 'level', difficulty: 'hard', level: 1, stars: 2 },
      { slot: 'classic', difficulty: 'easy' },
    ]);
    expect(progress.easy.slice(0, 2)).toEqual([3, 0]);
    expect(isLevelUnlocked(progress.easy, 2)).toBe(true);
    expect(isLevelUnlocked(progress.easy, 3)).toBe(false);
    expect(nextLevel(progress.easy)).toBe(2);
    // Each difficulty is its own track.
    expect(isLevelUnlocked(progress.medium, 2)).toBe(false);
    expect(nextLevel(new Array(LEVEL_COUNT).fill(1))).toBeNull();
  });

  it('accepts a saved level session and rejects one without its rules', () => {
    const session = startLevel('hard', 4);
    expect(isValidSession(JSON.parse(JSON.stringify(session)))).toBe(true);
    expect(isValidSession({ ...session, level: undefined })).toBe(false);
    expect(isValidSession({ ...session, level: { ...session.level, mistakeLimit: 0 } })).toBe(false);
  });
});

describe('notes and colour marks', () => {
  const fresh = () => createSession(puzzlesOf('hard')[0], 'classic', 's', 1);

  it('fills every empty cell with its candidates as one undoable action', () => {
    const session = fresh();
    const filled = fillNotes(session);
    const candidates = computeCandidates(session.values);
    session.values.forEach((value, cell) => {
      expect(filled.notes[cell]).toBe(value === 0 ? candidates[cell] : 0);
      // The correct digit is always among the filled notes.
      if (value === 0) expect(filled.notes[cell] & (1 << (session.solution[cell] - 1))).not.toBe(0);
    });
    expect(filled.undo).toHaveLength(1);
    expect(undoMove(filled).notes).toEqual(session.notes);
  });

  it('marks and clears cell colours without touching the board or undo history', () => {
    const session = fresh();
    const cell = session.values.indexOf(0);
    const marked = setTint(session, cell, 2);
    expect(marked.tints?.[cell]).toBe(2);
    expect(marked.values).toBe(session.values);
    expect(marked.undo).toBe(session.undo);
    expect(setTint(marked, cell, 2)).toBe(marked);
    expect(setTint(marked, cell, 0).tints?.[cell]).toBe(0);
    expect(setTint(session, cell, 9)).toBe(session);
    expect(isValidSession(JSON.parse(JSON.stringify(marked)))).toBe(true);
    expect(isValidSession({ ...marked, tints: [1, 2] })).toBe(false);
  });
});

describe('streaks', () => {
  it('counts a daily finished on its date or the next day, but not one replayed later', () => {
    expect(isOnTime('2026-11-10', at(2026, 11, 10, 23))).toBe(true);
    expect(isOnTime('2026-11-10', at(2026, 11, 11, 23))).toBe(true);
    expect(isOnTime('2026-11-10', at(2026, 11, 12, 0))).toBe(false);
    const days = streakDays([
      { slot: 'daily', dateKey: '2026-11-10', completedAt: at(2026, 11, 10) },
      { slot: 'daily', dateKey: '2026-11-08', completedAt: at(2026, 11, 20) },
      { slot: 'classic', dateKey: null, completedAt: at(2026, 11, 9) },
    ], ['2026-11-09']);
    expect(days).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('measures the current and the longest streak', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-08', '2026-11-09'];
    expect(longestStreak(days)).toBe(3);
    expect(currentStreak(days, new Date(2026, 10, 9, 8))).toBe(2);
    // Today is still open: yesterday's streak stands.
    expect(currentStreak(days, new Date(2026, 10, 10, 8))).toBe(2);
    expect(currentStreak(days, new Date(2026, 10, 11, 8))).toBe(0);
  });

  it('offers a repair only for yesterday, and only when it reconnects a streak', () => {
    const today = new Date(2026, 10, 10, 9);
    expect(repairableDay(['2026-11-07', '2026-11-08'], today)).toBe('2026-11-09');
    expect(repairableDay(['2026-11-08', '2026-11-09'], today)).toBeNull();
    expect(repairableDay(['2026-11-06', '2026-11-07'], today)).toBeNull();
    expect(repairableDay([], today)).toBeNull();
    expect(currentStreak(['2026-11-07', '2026-11-08', '2026-11-09'], today)).toBe(3);
  });
});

describe('rewards', () => {
  it('scores experience by board, difficulty and mode', () => {
    expect(completionXp({ slot: 'mini', difficulty: 'easy' })).toBe(10);
    expect(completionXp({ slot: 'classic', difficulty: 'hard' })).toBe(70);
    expect(completionXp({ slot: 'daily', difficulty: 'easy' })).toBe(40);
    expect(completionXp({ slot: 'level', difficulty: 'expert', stars: 3 })).toBe(115);
    // An Easy level is a 4×4 board: small-board experience plus its stars.
    expect(completionXp({ slot: 'level', difficulty: 'easy', stars: 3 })).toBe(25);
    expect(playerLevel(0)).toMatchObject({ level: 1, floor: 0, next: 100 });
    expect(playerLevel(99).level).toBe(1);
    expect(playerLevel(100).level).toBe(2);
    expect(playerLevel(xpForLevel(7)).level).toBe(7);
  });

  it('pays the first solve its badges and nothing extra for an ordinary later game', () => {
    const first = rewardsForCompletion([], result({ sessionId: 'a' }), []);
    expect(first.map((g) => g.id)).toEqual(['achievement:first-solve']);
    const before = [result({ sessionId: 'a' })];
    // A small board adds 10 experience, which reaches no badge and no new player level.
    const mini = result({ sessionId: 'b', slot: 'mini', difficulty: 'easy', completedAt: at(2026, 11, 2) });
    expect(rewardsForCompletion(before, mini, [])).toEqual([]);
  });

  it('pays a daily finished on time, and a bonus on every seventh day in a row', () => {
    const before: RewardResult[] = [];
    let seventh: string[] = [];
    for (let day = 1; day <= 7; day++) {
      const dateKey = `2026-11-0${day}`;
      const completion = result({ sessionId: `d${day}`, slot: 'daily', dateKey, completedAt: at(2026, 11, day) });
      const grants = rewardsForCompletion(before, completion, []).map((g) => g.id);
      expect(grants).toContain(`daily:${dateKey}`);
      if (day === 7) seventh = grants;
      else expect(grants).not.toContain(`streak:${dateKey}`);
      before.push(completion);
    }
    expect(seventh).toContain('streak:2026-11-07');
    expect(seventh).toContain('achievement:streak-7');

    // A puzzle replayed from the calendar weeks later fills the calendar only.
    const late = result({ sessionId: 'late', slot: 'daily', dateKey: '2026-10-01', completedAt: at(2026, 11, 20) });
    expect(rewardsForCompletion(before, late, []).map((g) => g.id)).not.toContain('daily:2026-10-01');
  });

  it('pays every fifth level once, on its first clear', () => {
    const level = (n: number, id: string) => result({ sessionId: id, slot: 'level', level: n, stars: 2 });
    const before = [1, 2, 3, 4].map((n) => level(n, `l${n}`));
    expect(rewardsForCompletion(before, level(4, 'again'), []).map((g) => g.id)).not.toContain('level:hard:4');
    const fifth = rewardsForCompletion(before, level(5, 'l5'), []);
    expect(fifth.find((g) => g.id === 'level:hard:5')).toMatchObject({ credits: 2 });
    expect(rewardsForCompletion([...before, level(5, 'l5')], level(5, 'replay'), []).map((g) => g.id)).not.toContain('level:hard:5');
  });

  it('pays a player level when experience crosses its threshold', () => {
    const before = [result({ sessionId: 'a' })]; // 70 xp
    const grants = rewardsForCompletion(before, result({ sessionId: 'b', completedAt: at(2026, 11, 2) }), []);
    expect(grants.map((g) => g.id)).toContain('player-level:2');
  });

  it('counts mini boards as solves but not as hint-free or flawless 9×9 games', () => {
    const mini = result({ sessionId: 'm', slot: 'mini', difficulty: 'easy', mistakes: 0, hints: 0 });
    const earned = achievementsFor([mini], []).filter(isEarned).map((a) => a.key);
    expect(earned).toEqual(['first-solve']);
    const board = result({ sessionId: 'b', mistakes: 0, hints: 0 });
    expect(achievementsFor([board], []).filter(isEarned).map((a) => a.key)).toEqual(
      expect.arrayContaining(['first-solve', 'no-hints', 'flawless']),
    );
  });
});

describe('reward storage', () => {
  async function setup() {
    const db = createMemoryDb();
    const repo = await Repository.open(nodeDriver(db));
    return { db, repo, restart: () => Repository.open(nodeDriver(db)) };
  }

  it('records a finished level with its number and stars', async () => {
    const { repo } = await setup();
    const done = { ...solve(startLevel('hard', 3, 'lvl-3')), elapsedMs: 300_000 };
    await repo.recordCompletion(done, 9);
    const [completion] = await repo.listCompletions();
    // Five minutes on a Hard level is past the 3-minute mark and just inside the 5-minute one.
    expect(completion).toMatchObject({ slot: 'level', level: 3, stars: 2, difficulty: 'hard' });
    expect(levelProgress(await repo.listCompletions()).hard[2]).toBe(2);
    expect((await repo.loadSessions()).level).toBeNull();
  });

  it('records a finished small-board level as a level result and clears only its own save', async () => {
    const { repo } = await setup();
    const playNow = { marker: 'play-now mini' };
    await repo.saveModeProgress(MINI_CLASSIC_KEY, playNow);
    const done = { ...solveMini(createMiniLevel('mini-4', miniLevelIndex(2), levelRules('easy', 2), 'mini-lvl', 1)), elapsedMs: 25_000 };
    await repo.saveModeProgress(MINI_LEVEL_KEY, done);
    expect((await repo.recordMiniCompletion(done, 9)).recorded).toBe(true);
    expect((await repo.recordMiniCompletion(done, 10)).recorded).toBe(false);

    const [completion] = await repo.listCompletions();
    expect(completion).toMatchObject({ sessionId: 'mini-lvl', slot: 'level', difficulty: 'easy', level: 2, stars: 3, hints: 0 });
    expect(levelProgress(await repo.listCompletions()).easy[1]).toBe(3);
    expect(await repo.loadModeProgress(MINI_LEVEL_KEY)).toBeNull();
    expect(await repo.loadModeProgress(MINI_CLASSIC_KEY)).toEqual(playNow);
  });

  it('pays each reward id once, even when the same rewards are submitted again', async () => {
    const { repo, restart } = await setup();
    const grants = [{ id: 'daily:2026-11-01', credits: 1 }, { id: 'achievement:first-solve', credits: 1 }];
    expect(await repo.grantRewards(grants, 1)).toEqual({ granted: grants, balance: 2 });
    expect(await repo.grantRewards([...grants, { id: 'level:easy:5', credits: 2 }], 2)).toEqual({
      granted: [{ id: 'level:easy:5', credits: 2 }], balance: 4,
    });
    expect(await (await restart()).grantRewards(grants, 3)).toEqual({ granted: [], balance: 4 });
  });

  it('applies an extra mistake once per ad, saved together with its grant', async () => {
    const { repo } = await setup();
    const failed = wrongEntries(startLevel('hard', 30, 'lvl-30'), 8);
    await repo.saveSession(failed, 1);
    const continued = { ...failed, level: { ...failed.level!, extraMistakes: 1 } };
    expect((await repo.grantSessionReward('ad-1', continued, 2)).granted).toBe(true);
    expect((await repo.loadSessions()).level?.level?.extraMistakes).toBe(1);
    // A duplicate callback for the same ad changes nothing.
    const twice = { ...failed, level: { ...failed.level!, extraMistakes: 2 } };
    expect((await repo.grantSessionReward('ad-1', twice, 3)).granted).toBe(false);
    expect((await repo.loadSessions()).level?.level?.extraMistakes).toBe(1);
    expect(await repo.getCredits()).toBe(0);
  });

  it('stores a repaired streak day once per ad', async () => {
    const { repo } = await setup();
    expect((await repo.grantModeReward('ad-9', 'streak-repairs', ['2026-11-09'], 1)).granted).toBe(true);
    expect((await repo.grantModeReward('ad-9', 'streak-repairs', ['2026-11-09', '2026-11-10'], 2)).granted).toBe(false);
    expect(await repo.loadModeProgress('streak-repairs')).toEqual(['2026-11-09']);
  });

  it('runs an ad with a custom reward through the same single-flight controller', async () => {
    vi.useFakeTimers();
    try {
      const { repo } = await setup();
      const provider = new MockAdProvider();
      const controller = new RewardController({
        provider, newAttemptId: () => 'attempt-1', onBalance: () => undefined,
        ledger: { grant: (id, credits) => repo.grantReward(id, credits, 1) },
      });
      const failed = wrongEntries(startLevel('hard', 30, 'lvl-30'), 8);
      const watching = controller.watchAd({
        credits: 0,
        grant: (grantId) => repo.grantSessionReward(grantId, { ...failed, level: { ...failed.level!, extraMistakes: 1 } }, 2),
      });
      expect(await controller.watchAd()).toEqual({ kind: 'busy' });
      provider.lastRequest.emit('opened');
      provider.lastRequest.emit('earned');
      provider.lastRequest.emit('earned');
      provider.lastRequest.emit('closed');
      await vi.advanceTimersByTimeAsync(0);
      expect(await watching).toEqual({ kind: 'earned', credits: 0, balance: 0 });
      expect((await repo.loadSessions()).level?.level?.extraMistakes).toBe(1);
      expect(await repo.getCredits()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets games and results but keeps credits, settings and paid rewards', async () => {
    const { repo } = await setup();
    await repo.grantRewards([{ id: 'level:easy:5', credits: 2 }], 1);
    await repo.saveSettings({ ...await repo.loadSettings(), boardTheme: 'light' });
    await repo.saveSession(createSession(puzzlesOf('easy')[0], 'classic', 'c', 1), 1);
    await repo.recordCompletion(solve(startLevel('hard', 1, 'l1')), 2);
    await repo.saveModeProgress('streak-repairs', ['2026-11-09']);

    await repo.resetProgress();

    expect(await repo.loadSessions()).toMatchObject({ classic: null, level: null });
    expect(await repo.listCompletions()).toEqual([]);
    expect(await repo.loadModeProgress('streak-repairs')).toBeNull();
    expect((await repo.loadSettings()).boardTheme).toBe('light');
    expect(await repo.getCredits()).toBe(2);
    // The same reward cannot be earned a second time after a reset.
    expect(await repo.grantRewards([{ id: 'level:easy:5', credits: 2 }], 3)).toEqual({ granted: [], balance: 2 });
  });

  it('restores a backup on another device without carrying credits across', async () => {
    const source = await setup();
    const classic = createSession(puzzlesOf('hard')[0], 'classic', 'c', 1);
    await source.repo.saveSession(classic, 1);
    await source.repo.recordCompletion({ ...solve(startLevel('hard', 1, 'l1')), elapsedMs: 90_000 }, 2);
    await source.repo.saveSettings({ ...await source.repo.loadSettings(), boardTheme: 'contrast' });
    await source.repo.saveModeProgress('streak-repairs', ['2026-11-09']);
    await source.repo.grantRewards([{ id: 'daily:2026-11-01', credits: 5 }], 3);
    const backup = JSON.parse(JSON.stringify(await source.repo.exportData(4)));

    const target = await setup();
    await target.repo.grantRewards([{ id: 'x', credits: 1 }], 1);
    await target.repo.saveSession(createSession(puzzlesOf('easy')[1], 'classic', 'old', 1), 1);
    await target.repo.importData(backup);

    expect((await target.repo.loadSessions()).classic).toEqual(classic);
    expect(await target.repo.listCompletions()).toMatchObject([{ sessionId: 'l1', slot: 'level', level: 1, stars: 3, timeMs: 90_000 }]);
    expect((await target.repo.loadSettings()).boardTheme).toBe('contrast');
    expect(await target.repo.loadModeProgress('streak-repairs')).toEqual(['2026-11-09']);
    expect(await target.repo.getCredits()).toBe(1);
  });

  it('refuses a file that is not a valid backup and leaves saved data untouched', async () => {
    const { repo } = await setup();
    const classic = createSession(puzzlesOf('hard')[0], 'classic', 'c', 1);
    await repo.saveSession(classic, 1);
    for (const bad of [null, {}, { app: 'other' }, { app: 'sudoku-studio', schema: 999, kv: [], sessions: [], completions: [], challengeScores: [] },
      { app: 'sudoku-studio', schema: 1, kv: 'x', sessions: [], completions: [], challengeScores: [] }]) {
      expect(() => repo.importData(bad)).toThrow(InvalidBackupError);
    }
    expect((await repo.loadSessions()).classic).toEqual(classic);
  });
});
