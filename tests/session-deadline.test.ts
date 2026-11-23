import { afterEach, describe, expect, it, vi } from 'vitest';

import { puzzlesOf } from '../src/data/pool';
import { decodeChallenge, encodeChallengeScore, decodeChallengeScore } from '../src/game/challenge';
import { MINI_CLASSIC_KEY, createMiniClassic, enterMiniClassic, miniClassicStatus, readMiniClassic } from '../src/game/miniClassic';
import { PLAY_BOARD_SIZES, miniModeForDifficulty } from '../src/game/playFormat';
import { createSession, enterDigit, getSessionFailure } from '../src/game/session';
import { Repository, SCHEMA_VERSION } from '../src/storage/repository';
import { createMemoryDb, nodeDriver } from './helpers';

// The tests exercise the running clock and store without loading native drivers in Node.
vi.mock('../src/ads', () => ({
  createAdProvider: () => { throw new Error('Ads unavailable in tests'); },
}));
vi.mock('../src/storage/expoDriver', () => ({ openExpoDriver: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe('startup migration', () => {
  it('opens the earlier version 3 database and recovers a pending result without losing saved data', async () => {
    const { openExpoDriver } = await import('../src/storage/expoDriver');
    const { appStore, initApp, listCompletions, getCompletion } = await import('../src/state/app');
    // The pending daily is recorded at startup; a fixed date keeps its on-time reward deterministic.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 23, 12));
    const db = createMemoryDb();
    const driver = nodeDriver(db);
    const original = await Repository.open(driver);
    const [easy, second, third] = puzzlesOf('easy');
    const active = createSession(easy, 'classic', 'unfinished', 1);
    const previous = createSession(second, 'daily', 'previous', 2, '2026-11-22');
    const pending = createSession(third, 'daily', 'pending', 3, '2026-11-23');
    const completeWithMistake = (session: typeof previous) => {
      const cell = session.values.indexOf(0);
      const wrong = session.solution[cell] === 1 ? 2 : 1;
      const started = enterDigit(session, cell, wrong, { smartNotes: true });
      return { ...started, values: [...started.solution], completed: true };
    };
    await original.saveSession(active, 4);
    await original.recordCompletion(completeWithMistake(previous), 5);
    await original.saveSession(completeWithMistake(pending), 6);
    await original.grantReward('saved-reward', 2, 7);
    await original.saveSettings({ ...await original.loadSettings(), boardTheme: 'light' });
    db.exec('ALTER TABLE completions DROP COLUMN review_count; PRAGMA user_version = 3;');
    vi.mocked(openExpoDriver).mockResolvedValueOnce(driver);

    await initApp();

    expect(appStore.getState()).toMatchObject({
      // Two saved credits plus one for the recovered Daily Puzzle, finished on its own date.
      ready: true, loadError: null, sessions: { classic: active, daily: null }, credits: 3,
      settings: { boardTheme: 'light' }, dailyCompleted: ['2026-11-22', '2026-11-23'],
    });
    expect(await listCompletions()).toMatchObject([
      { sessionId: previous.id, reviewCount: 1 }, { sessionId: pending.id, reviewCount: 1 },
    ]);
    expect((await getCompletion(previous.id))?.mistakeReview).toEqual(completeWithMistake(previous).mistakeReview);
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: SCHEMA_VERSION });
    db.close();
  });
});

describe('classic countdown', () => {
  it('freezes input at the deadline without counting paused time', async () => {
    vi.useFakeTimers();
    const { appStore, clock, flushSession, mutateSession, startClassic } = await import('../src/state/app');
    const session = startClassic('easy', { timerMinutes: 5, mistakes: 'unlimited' });
    clock.load('classic', 299_000, session.id);
    clock.start();
    vi.advanceTimersByTime(500);
    vi.setSystemTime(Date.now() + 3_600_000);
    clock.stop();
    flushSession('classic');
    vi.advanceTimersByTime(60_000);
    expect(appStore.getState().sessions.classic?.elapsedMs).toBe(299_500);
    clock.start();
    vi.advanceTimersByTime(500);

    const cell = session.values.indexOf(0);
    const after = mutateSession('classic', (s) => enterDigit(s, cell, s.solution[cell], { smartNotes: true }))!;
    expect(getSessionFailure(after)).toBe('time');
    expect(after.elapsedMs).toBe(300_000);
    expect(after.values).toBe(session.values);
    expect(clock.running).toBe(false);
  });

  it('ignores a clock left running by a previous puzzle in the same slot', async () => {
    vi.useFakeTimers();
    const { appStore, clock, flushSession, startClassic } = await import('../src/state/app');
    const previous = startClassic('easy');
    clock.load('classic', 600_000, previous.id);
    clock.start();
    const fresh = startClassic('easy', { timerMinutes: 5, mistakes: 3 });
    flushSession('classic');
    expect(appStore.getState().sessions.classic).toBe(fresh);
    expect(fresh.elapsedMs).toBe(0);
    expect(clock.running).toBe(false);
  });

  it('preserves the timeout and the saved hint if they happen together', async () => {
    vi.useFakeTimers();
    const { openExpoDriver } = await import('../src/storage/expoDriver');
    const { appStore, clock, flushSession, getHintOffer, initApp, listCompletions, revealHint, startClassic } =
      await import('../src/state/app');
    const db = createMemoryDb();
    vi.mocked(openExpoDriver).mockResolvedValueOnce(nodeDriver(db));
    await initApp();

    const session = startClassic('easy', { timerMinutes: 5, mistakes: 'unlimited' });
    clock.load('classic', 299_900, session.id);
    clock.start();
    const offer = getHintOffer('classic');
    if (offer?.kind !== 'available') throw new Error('Expected a hint before time ran out');
    const reveal = revealHint('classic', offer);
    vi.advanceTimersByTime(100);
    flushSession('classic');

    await expect(reveal).resolves.toBe('revealed');
    const latest = appStore.getState().sessions.classic!;
    expect(getSessionFailure(latest)).toBe('time');
    expect(latest.hint).toEqual(offer.hint);
    expect(await listCompletions()).toEqual([]);
    const saved = db.prepare('SELECT data FROM sessions WHERE slot = ?').get('classic') as { data: string };
    expect(JSON.parse(saved.data)).toEqual(latest);
    db.close();
  });
});

describe('Play Now mini games', () => {
  it('pairs each difficulty with the requested board size', () => {
    expect(PLAY_BOARD_SIZES).toEqual({ easy: 4, medium: 6, hard: 9, expert: 9 });
    expect((['easy', 'medium', 'hard', 'expert'] as const).map(miniModeForDifficulty))
      .toEqual(['mini-4', 'mini-6', null, null]);
  });

  it('freezes mini input at the time limit and retains the rules and board on reload', async () => {
    vi.useFakeTimers();
    const { openExpoDriver } = await import('../src/storage/expoDriver');
    const { initApp, miniClassicClock, mutateMiniClassic, startMiniClassic } = await import('../src/state/app');
    const db = createMemoryDb();
    const driver = nodeDriver(db);
    vi.mocked(openExpoDriver).mockResolvedValueOnce(driver);
    await initApp();
    const session = await startMiniClassic('mini-4', { timerMinutes: 5, mistakes: 3 });
    miniClassicClock.load('mini', 299_999, session.id);
    miniClassicClock.start();
    vi.advanceTimersByTime(1);
    const cell = session.progress.values.indexOf(0);
    const result = mutateMiniClassic(session.id, (s) => enterMiniClassic(s, cell, 1, false, true))!;
    expect(miniClassicStatus(result)).toBe('time');
    expect(result.elapsedMs).toBe(300_000);
    expect(result.progress).toBe(session.progress);
    expect(miniClassicClock.running).toBe(false);

    const saved = readMiniClassic(await (await Repository.open(driver)).loadModeProgress(MINI_CLASSIC_KEY));
    expect(saved).toMatchObject({ id: session.id, elapsedMs: 300_000, rules: session.rules, difficulty: 'easy' });
    db.close();
  });

  it('applies mini mistake limits and records a solved 6 × 6 board independently of the 9 × 9 game', async () => {
    const { getAlternatePuzzle } = await import('../src/game/alternate');
    const { openExpoDriver } = await import('../src/storage/expoDriver');
    const { appStore, completeMiniClassic, initApp, getCompletion, mutateMiniClassic, startClassic, startMiniClassic } = await import('../src/state/app');
    const db = createMemoryDb();
    const driver = nodeDriver(db);
    vi.mocked(openExpoDriver).mockResolvedValueOnce(driver);
    await initApp();
    const classic = startClassic('hard');
    const rules = { timerMinutes: 0, mistakes: 3 } as const;
    const initial = await startMiniClassic('mini-6', rules);
    const puzzle = getAlternatePuzzle(initial.mode, initial.index);
    const cell = puzzle.givens.indexOf(0);
    const wrong = [1, 2, 3, 4].filter((digit) => digit !== puzzle.solution[cell]).slice(0, 3);
    for (const digit of wrong) mutateMiniClassic(initial.id, (s) => enterMiniClassic(s, cell, digit, false, true));
    expect(miniClassicStatus(appStore.getState().miniClassic!)).toBe('mistakes');

    const retry = await startMiniClassic(initial.mode, rules, { replayIndex: initial.index });
    for (let index = 0; index < puzzle.givens.length; index++) {
      if (!puzzle.givens[index]) mutateMiniClassic(retry.id, (s) => enterMiniClassic(s, index, puzzle.solution[index], false, true));
    }
    expect(await completeMiniClassic(retry.id)).toBe(retry.id);
    expect(await getCompletion(retry.id)).toMatchObject({ slot: 'mini', difficulty: 'medium', puzzleId: puzzle.id, mistakes: 0 });
    expect(appStore.getState()).toMatchObject({ miniClassic: null, sessions: { classic } });
    const reopened = await Repository.open(driver);
    expect(await reopened.loadModeProgress(MINI_CLASSIC_KEY)).toBeNull();
    expect((await reopened.loadSessions()).classic).toEqual(classic);
    db.close();
  });

  it('recovers a solved mini board when the app was closed before showing its result', async () => {
    const { getAlternatePuzzle } = await import('../src/game/alternate');
    const { openExpoDriver } = await import('../src/storage/expoDriver');
    const { appStore, initApp, listCompletions } = await import('../src/state/app');
    const db = createMemoryDb();
    const driver = nodeDriver(db);
    const repo = await Repository.open(driver);
    const round = createMiniClassic('mini-4', 0, { timerMinutes: 0, mistakes: 'unlimited' }, 'pending-mini', 1);
    const values = getAlternatePuzzle(round.mode, round.index).solution;
    await repo.saveModeProgress(MINI_CLASSIC_KEY, { ...round, elapsedMs: 15_500, progress: { ...round.progress, values } });
    vi.mocked(openExpoDriver).mockResolvedValueOnce(driver);

    await initApp();

    expect(appStore.getState()).toMatchObject({ ready: true, loadError: null, miniClassic: null });
    expect(await listCompletions()).toMatchObject([{ sessionId: round.id, slot: 'mini', timeMs: 15_500 }]);
    expect(await repo.loadModeProgress(MINI_CLASSIC_KEY)).toBeNull();
    db.close();
  });
});

describe('friend challenge gameplay', () => {
  it('plays a decoded invite with its own clock and saves a shareable result independently', async () => {
    vi.useFakeTimers();
    const { openExpoDriver } = await import('../src/storage/expoDriver');
    const { appStore, clock, completeSession, getCompletion, initApp, mutateSession, prepareChallenge, startChallenge, startClassic, startDaily } =
      await import('../src/state/app');
    const db = createMemoryDb();
    vi.mocked(openExpoDriver).mockResolvedValueOnce(nodeDriver(db));
    await initApp();

    const classic = startClassic('easy');
    const daily = startDaily('2026-11-23');
    const invite = prepareChallenge('medium', { timerMinutes: 5, mistakes: 3 });
    const joined = decodeChallenge(`Try this puzzle in Sudoku Studio\n${invite.code}`);
    const attempt = startChallenge(joined);
    expect(startChallenge(joined).id).toBe(attempt.id);
    expect(attempt.givens.join('')).toBe(invite.puzzle.givens);

    clock.load('challenge', 0, attempt.id);
    clock.start();
    vi.advanceTimersByTime(247_300);
    for (let cell = 0; cell < attempt.givens.length; cell++) {
      if (!attempt.givens[cell]) mutateSession('challenge', (s) => enterDigit(s, cell, s.solution[cell], { smartNotes: true }));
    }

    expect(await completeSession('challenge')).toBe(attempt.id);
    const result = (await getCompletion(attempt.id))!;
    const share = encodeChallengeScore({ ...result, challengeCode: result.challengeCode! });
    expect(decodeChallengeScore(share)).toEqual({
      challengeCode: invite.code, sessionId: attempt.id, timeMs: 247_300, mistakes: 0, hints: 0,
    });
    expect(appStore.getState().sessions).toEqual({ classic, daily, challenge: null, technique: null, weekly: null, level: null });
    db.close();
  });
});

describe('weekly stage progression', () => {
  it('opens stages in order and records the badge without affecting the Daily puzzle', async () => {
    const { openExpoDriver } = await import('../src/storage/expoDriver');
    const { appStore, completeSession, initApp, mutateSession, startDaily, startWeekly } = await import('../src/state/app');
    const { WEEKLY_DIFFICULTIES, weeklyBadgeWeeks } = await import('../src/game/events');
    const db = createMemoryDb();
    vi.mocked(openExpoDriver).mockResolvedValueOnce(nodeDriver(db));
    await initApp();

    const monday = '2026-11-23';
    const daily = startDaily(monday);
    expect(startWeekly(monday, 'medium')).toBeNull();
    for (const difficulty of WEEKLY_DIFFICULTIES) {
      const stage = startWeekly(monday, difficulty)!;
      expect(startWeekly(monday, difficulty)?.id).toBe(stage.id);
      for (let cell = 0; cell < 81; cell++) {
        if (!stage.givens[cell]) mutateSession('weekly', (s) => enterDigit(s, cell, s.solution[cell], { smartNotes: true }));
      }
      expect(await completeSession('weekly')).toBe(stage.id);
    }
    const state = appStore.getState();
    expect(weeklyBadgeWeeks(state.weeklyCompleted)).toEqual([monday]);
    expect(state.sessions.daily).toBe(daily);
    expect(state.dailyCompleted).toEqual([]);
    expect(startWeekly(monday, 'easy')).toBeNull();
    db.close();
  });
});
