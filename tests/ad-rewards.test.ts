import { afterEach, describe, expect, it, vi } from 'vitest';

import { puzzlesOf } from '../src/data/pool';
import {
  LEVEL_EXTRA_TIME_SEC, MAX_EXTRA_TIME, applyBoardContinue, applyMiniContinue, boardContinueOffer, formatExtraTime, miniContinueOffer,
} from '../src/game/continue';
import {
  DEFAULT_SPEED_OPTIONS, EMPTY_SPEED_PROGRESS, SPEED_EXTENSION_MS, SPEED_PROGRESS_KEY, canExtendSpeedRound, enterSpeedDigit,
  extendSpeedRound, finishSpeedRound, quitSpeedRound, readSpeedProgress, resumeSpeedRound, speedPuzzleForRound, speedRecord,
  speedRemainingMs, startSpeedRound, type SpeedProgress,
} from '../src/game/eventSpeed';
import { LEVEL_TIMES, MAX_EXTRA_MISTAKES, levelPuzzle, levelRules, miniLevelIndex } from '../src/game/levels';
import { createMiniClassic, createMiniLevel, miniClassicStatus, miniClassicTimeLimit, miniMistakeLimit, readMiniClassic } from '../src/game/miniClassic';
import { DAILY_GIFT_CREDITS } from '../src/game/rewards';
import { createLevelSession, createSession, getMistakeLimit, getSessionFailure, getTimeLimitMs, isValidSession, type Session } from '../src/game/session';
import { BOARD_THEMES, FREE_BOARD_THEMES, isThemeAvailable } from '../src/game/settings';
import { Repository } from '../src/storage/repository';
import { createMemoryDb, nodeDriver } from './helpers';

vi.mock('../src/ads', async () => {
  const { MockAdProvider: Provider } = await import('../src/ads/mockProvider');
  return {
    // Every ad opens, pays its reward and closes on its own.
    createAdProvider: () => new Provider({ autoPlay: [{ event: 'opened', afterMs: 0 }, { event: 'earned', afterMs: 1 }, { event: 'closed', afterMs: 2 }] }),
    isSimulatedAds: () => true,
  };
});
vi.mock('../src/storage/expoDriver', () => ({ openExpoDriver: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

const hardLevel = (id = 'h1'): Session => createLevelSession(levelPuzzle('hard', 1), levelRules('hard', 1), id, 0);

describe('continuing an ended game with an ad', () => {
  it('adds time to a level whose clock ran out, a limited number of times', () => {
    const fresh = hardLevel();
    expect(boardContinueOffer(fresh)).toBeNull();
    const limit = LEVEL_TIMES.hard.limitSec * 1000;
    const late = { ...fresh, elapsedMs: limit };
    expect(getSessionFailure(late)).toBe('time');
    expect(boardContinueOffer(late)).toEqual({ kind: 'time', left: MAX_EXTRA_TIME, max: MAX_EXTRA_TIME, seconds: LEVEL_EXTRA_TIME_SEC.hard });

    const once = applyBoardContinue(late)!;
    expect(once.level?.extraTimeSec).toBe(LEVEL_EXTRA_TIME_SEC.hard);
    expect(getTimeLimitMs(once)).toBe(limit + LEVEL_EXTRA_TIME_SEC.hard * 1000);
    expect(getSessionFailure(once)).toBeNull();
    expect(isValidSession(JSON.parse(JSON.stringify(once)))).toBe(true);

    let session = once;
    for (let used = 1; used < MAX_EXTRA_TIME; used++) session = applyBoardContinue({ ...session, elapsedMs: getTimeLimitMs(session)! })!;
    const spent = { ...session, elapsedMs: getTimeLimitMs(session)! };
    expect(getSessionFailure(spent)).toBe('time');
    expect(boardContinueOffer(spent)).toBeNull();
    expect(applyBoardContinue(spent)).toBeNull();
  });

  it('keeps extra mistakes and extra time for a level separate', () => {
    const fresh = hardLevel();
    const failed = { ...fresh, mistakes: getMistakeLimit(fresh)! };
    expect(boardContinueOffer(failed)).toEqual({ kind: 'mistake', left: MAX_EXTRA_MISTAKES, max: MAX_EXTRA_MISTAKES });
    const continued = applyBoardContinue(failed)!;
    expect(continued.level).toMatchObject({ extraMistakes: 1 });
    expect(continued.level?.extraTimeSec).toBeUndefined();
    expect(getSessionFailure(continued)).toBeNull();
  });

  it('adds a mistake to a Play Now game with a mistake limit, and to nothing else', () => {
    const puzzle = puzzlesOf('hard')[0];
    const classic = createSession(puzzle, 'classic', 'c1', 0, null, { timerMinutes: 5, mistakes: 3 });
    const failed = { ...classic, mistakes: 3 };
    expect(boardContinueOffer(failed)).toEqual({ kind: 'mistake', left: MAX_EXTRA_MISTAKES, max: MAX_EXTRA_MISTAKES });
    const continued = applyBoardContinue(failed)!;
    expect(getMistakeLimit(continued)).toBe(4);
    expect(getSessionFailure(continued)).toBeNull();
    expect(isValidSession(JSON.parse(JSON.stringify(continued)))).toBe(true);
    expect(boardContinueOffer({ ...continued, mistakes: 5, extraMistakes: MAX_EXTRA_MISTAKES })).toBeNull();

    // Running out of time in Play Now is not continued, and neither are shared or dated puzzles.
    expect(boardContinueOffer({ ...classic, elapsedMs: 5 * 60_000 })).toBeNull();
    expect(boardContinueOffer({ ...failed, slot: 'challenge' })).toBeNull();
    expect(boardContinueOffer({ ...failed, slot: 'daily' })).toBeNull();
    expect(boardContinueOffer({ ...failed, completed: true })).toBeNull();
  });

  it('applies the same rules on the small boards', () => {
    const level = createMiniLevel('mini-4', miniLevelIndex(1), levelRules('easy', 1), 'e1', 0);
    const late = { ...level, elapsedMs: miniClassicTimeLimit(level)! };
    expect(miniClassicStatus(late)).toBe('time');
    expect(miniContinueOffer(late)).toMatchObject({ kind: 'time', seconds: LEVEL_EXTRA_TIME_SEC.easy });
    const more = applyMiniContinue(late)!;
    expect(miniClassicStatus(more)).toBe('playing');
    expect(miniClassicTimeLimit(more)).toBe((LEVEL_TIMES.easy.limitSec + LEVEL_EXTRA_TIME_SEC.easy) * 1000);
    expect(readMiniClassic(JSON.parse(JSON.stringify(more)))).toMatchObject({ id: 'e1', level: { extraTimeSec: LEVEL_EXTRA_TIME_SEC.easy } });

    const playNow = { ...createMiniClassic('mini-6', 0, { timerMinutes: 0, mistakes: 3 }, 'm1', 0), mistakes: 3 };
    expect(miniClassicStatus(playNow)).toBe('mistakes');
    const again = applyMiniContinue(playNow)!;
    expect(miniMistakeLimit(again)).toBe(4);
    expect(miniClassicStatus(again)).toBe('playing');
    expect(readMiniClassic(JSON.parse(JSON.stringify(again)))).toMatchObject({ id: 'm1', extraMistakes: 1 });
    expect(miniContinueOffer({ ...again, mistakes: 5, extraMistakes: MAX_EXTRA_MISTAKES })).toBeNull();
  });

  it('names the extra time for buttons', () => {
    expect([30, 60, 120].map(formatExtraTime)).toEqual(['30 seconds', '1 minute', '2 minutes']);
  });
});

describe('Speed Round extension', () => {
  const startAt = 50_000;
  const roundMs = DEFAULT_SPEED_OPTIONS.minutes * 60_000;

  function finishedRound(): SpeedProgress {
    let progress = startSpeedRound(EMPTY_SPEED_PROGRESS, DEFAULT_SPEED_OPTIONS, startAt, () => 0);
    const solution = speedPuzzleForRound(progress.round!)!.solution;
    const cell = progress.round!.values.indexOf(0);
    progress = enterSpeedDigit(progress, cell, solution[cell], startAt + 1000);
    return finishSpeedRound(progress, startAt + roundMs);
  }

  it('reopens a finished round once and counts it once', () => {
    const finished = finishedRound();
    expect(speedRecord(finished, DEFAULT_SPEED_OPTIONS)).toMatchObject({ best: 1, rounds: 1, correct: 1 });
    expect(canExtendSpeedRound(finished.round)).toBe(true);

    const waiting = extendSpeedRound(finished)!;
    expect(waiting.round).toMatchObject({ finished: false, extended: true, pausedMs: SPEED_EXTENSION_MS, score: 1 });
    expect(speedRecord(waiting, DEFAULT_SPEED_OPTIONS)).toMatchObject({ best: 0, rounds: 0, correct: 0, recent: [] });
    // The clock stands still, and the board takes no input, until the player is back from the ad.
    const later = startAt + roundMs + 600_000;
    expect(speedRemainingMs(waiting.round!, later)).toBe(SPEED_EXTENSION_MS);
    expect(finishSpeedRound(waiting, later)).toBe(waiting);
    const open = waiting.round!.values.indexOf(0);
    expect(enterSpeedDigit(waiting, open, speedPuzzleForRound(waiting.round!)!.solution[open], later)).toBe(waiting);
    expect(readSpeedProgress(JSON.parse(JSON.stringify(waiting))).round).toMatchObject({ extended: true, pausedMs: SPEED_EXTENSION_MS });

    const running = resumeSpeedRound(waiting, later);
    expect(running.round!.pausedMs).toBeUndefined();
    expect(speedRemainingMs(running.round!, later)).toBe(SPEED_EXTENSION_MS);
    expect(speedRemainingMs(running.round!, later + 10_000)).toBe(SPEED_EXTENSION_MS - 10_000);
    const scored = enterSpeedDigit(running, open, speedPuzzleForRound(running.round!)!.solution[open], later + 5000);
    expect(scored.round!.score).toBe(2);

    const done = finishSpeedRound(scored, later + SPEED_EXTENSION_MS);
    expect(done.round).toMatchObject({ finished: true, extended: true, score: 2 });
    expect(speedRecord(done, DEFAULT_SPEED_OPTIONS)).toMatchObject({ best: 2, rounds: 1, correct: 2 });
    expect(speedRecord(done, DEFAULT_SPEED_OPTIONS).recent).toHaveLength(1);
    expect(canExtendSpeedRound(done.round)).toBe(false);
    expect(extendSpeedRound(done)).toBeNull();
    expect(readSpeedProgress(JSON.parse(JSON.stringify(done))).round).toMatchObject({ finished: true, extended: true });
  });

  it('keeps the score when an extended round is ended early', () => {
    const waiting = extendSpeedRound(finishedRound())!;
    const quitWaiting = quitSpeedRound(waiting, waiting.round!.startedAt, startAt + roundMs + 5);
    expect(quitWaiting.round).toMatchObject({ finished: true, score: 1 });
    expect(speedRecord(quitWaiting, DEFAULT_SPEED_OPTIONS)).toMatchObject({ best: 1, rounds: 1, correct: 1 });

    const running = resumeSpeedRound(waiting, startAt + roundMs + 5);
    const quitRunning = quitSpeedRound(running, running.round!.startedAt, startAt + roundMs + 1000);
    expect(quitRunning.round).toMatchObject({ finished: true, score: 1 });
    expect(speedRecord(quitRunning, DEFAULT_SPEED_OPTIONS).rounds).toBe(1);
  });

  it('does not extend a round that is still running or was never played', () => {
    expect(extendSpeedRound(EMPTY_SPEED_PROGRESS)).toBeNull();
    expect(extendSpeedRound(startSpeedRound(EMPTY_SPEED_PROGRESS, DEFAULT_SPEED_OPTIONS, startAt, () => 0))).toBeNull();
  });
});

describe('board theme locks', () => {
  it('keeps three themes free and the selected theme usable', () => {
    expect(FREE_BOARD_THEMES).toEqual(['charcoal', 'light', 'contrast']);
    for (const theme of BOARD_THEMES) {
      expect(isThemeAvailable(theme, [], 'charcoal')).toBe(FREE_BOARD_THEMES.includes(theme));
    }
    expect(isThemeAvailable('ocean', ['ocean'], 'charcoal')).toBe(true);
    expect(isThemeAvailable('ocean', [], 'ocean')).toBe(true);
    expect(isThemeAvailable('mint', ['ocean'], 'charcoal')).toBe(false);
  });
});

describe('ad rewards in the app', () => {
  async function setup(seed?: (repo: Repository) => Promise<void>) {
    const { openExpoDriver } = await import('../src/storage/expoDriver');
    const app = await import('../src/state/app');
    const db = createMemoryDb();
    const driver = nodeDriver(db);
    if (seed) await seed(await Repository.open(driver));
    vi.mocked(openExpoDriver).mockResolvedValueOnce(driver);
    await app.initApp();
    return { app, db, reopen: () => Repository.open(driver) };
  }

  it('continues a level after its time ran out and saves the extra time once per ad', async () => {
    const { app, db, reopen } = await setup();
    const level = app.startLevel('hard', 1)!;
    app.mutateSession('level', (session) => ({ ...session, elapsedMs: getTimeLimitMs(session)! }));
    expect(getSessionFailure(app.appStore.getState().sessions.level!)).toBe('time');

    for (let used = 1; used <= MAX_EXTRA_TIME; used++) {
      expect(await app.watchAdToContinue(level.id)).toMatchObject({ kind: 'earned', credits: 0 });
      const current = app.appStore.getState().sessions.level!;
      expect(current.level?.extraTimeSec).toBe(used * LEVEL_EXTRA_TIME_SEC.hard);
      expect(getSessionFailure(current)).toBeNull();
      expect((await (await reopen()).loadSessions()).level?.level?.extraTimeSec).toBe(used * LEVEL_EXTRA_TIME_SEC.hard);
      app.mutateSession('level', (session) => ({ ...session, elapsedMs: getTimeLimitMs(session)! }));
    }
    // Nothing is left to add, so a further ad changes nothing.
    expect(await app.watchAdToContinue(level.id)).toEqual({ kind: 'failed', reason: 'grant-error' });
    expect(app.appStore.getState().sessions.level?.level?.extraTimeSec).toBe(MAX_EXTRA_TIME * LEVEL_EXTRA_TIME_SEC.hard);
    expect(app.appStore.getState().credits).toBe(0);
    db.close();
  });

  it('continues a Play Now game after its mistake limit on both board sizes', async () => {
    const { app, db, reopen } = await setup();
    const classic = app.startClassic('hard', { timerMinutes: 0, mistakes: 3 });
    app.mutateSession('classic', (session) => ({ ...session, mistakes: 3 }));
    expect(await app.watchAdToContinue(classic.id)).toMatchObject({ kind: 'earned' });
    expect(app.appStore.getState().sessions.classic).toMatchObject({ extraMistakes: 1, mistakes: 3 });
    expect(getSessionFailure(app.appStore.getState().sessions.classic!)).toBeNull();
    expect((await (await reopen()).loadSessions()).classic?.extraMistakes).toBe(1);

    const mini = await app.startMiniClassic('mini-4', { timerMinutes: 0, mistakes: 3 });
    app.mutateMiniClassic(mini.id, (session) => ({ ...session, mistakes: 3 }));
    expect(miniClassicStatus(app.appStore.getState().miniClassic!)).toBe('mistakes');
    expect(await app.watchAdToContinue(mini.id)).toMatchObject({ kind: 'earned' });
    expect(app.appStore.getState().miniClassic).toMatchObject({ id: mini.id, extraMistakes: 1 });
    expect(miniClassicStatus(app.appStore.getState().miniClassic!)).toBe('playing');

    // A daily puzzle has no limit to continue past.
    const daily = app.startDaily('2026-11-23');
    expect(await app.watchAdToContinue(daily.id)).toEqual({ kind: 'failed', reason: 'grant-error' });
    db.close();
  });

  it('pays the daily gift once per day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 23, 9));
    const { app, db } = await setup();
    const before = app.appStore.getState().credits;
    expect(app.isDailyGiftReady(app.appStore.getState().giftDay)).toBe(true);

    expect(await app.watchAdForDailyGift()).toMatchObject({ kind: 'earned', credits: DAILY_GIFT_CREDITS, balance: before + DAILY_GIFT_CREDITS });
    expect(app.appStore.getState()).toMatchObject({ credits: before + DAILY_GIFT_CREDITS, giftDay: '2026-11-23' });
    expect(app.isDailyGiftReady(app.appStore.getState().giftDay)).toBe(false);
    expect(await app.watchAdForDailyGift()).toEqual({ kind: 'failed', reason: 'grant-error' });
    expect(app.appStore.getState().credits).toBe(before + DAILY_GIFT_CREDITS);

    vi.setSystemTime(new Date(2026, 10, 24, 9));
    expect(app.isDailyGiftReady(app.appStore.getState().giftDay)).toBe(true);
    expect(await app.watchAdForDailyGift()).toMatchObject({ kind: 'earned' });
    expect(app.appStore.getState()).toMatchObject({ credits: before + 2 * DAILY_GIFT_CREDITS, giftDay: '2026-11-24' });
    db.close();
  });

  it('remembers a claimed gift after the app restarts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 23, 9));
    const { app, db } = await setup(async (repo) => { await repo.grantReward('gift:2026-11-23', DAILY_GIFT_CREDITS, 1); });
    expect(app.appStore.getState()).toMatchObject({ giftDay: '2026-11-23', credits: DAILY_GIFT_CREDITS });
    db.close();
  });

  it('doubles the hint credits of a finished game once', async () => {
    const { app, db } = await setup();
    const before = app.appStore.getState().credits;
    app.appStore.setState({ lastRewards: { sessionId: 'won', xp: 70, grants: [{ id: 'a', credits: 2, label: 'A' }, { id: 'b', credits: 3, label: 'B' }] } });
    expect(app.doubleableCredits('won')).toBe(5);
    expect(app.doubleableCredits('other')).toBe(0);

    expect(await app.watchAdToDoubleRewards('won')).toEqual({ kind: 'earned', credits: 5, balance: before + 5 });
    expect(app.appStore.getState()).toMatchObject({ credits: before + 5, lastRewards: { sessionId: 'won', doubled: true } });
    expect(app.doubleableCredits('won')).toBe(0);
    expect(await app.watchAdToDoubleRewards('won')).toEqual({ kind: 'failed', reason: 'unsupported' });
    expect(app.appStore.getState().credits).toBe(before + 5);
    db.close();
  });

  it('unlocks a board theme for good and never selects a locked one', async () => {
    const { app, db, reopen } = await setup();
    app.updateSettings({ boardTheme: 'ocean' });
    expect(app.appStore.getState().settings.boardTheme).toBe('charcoal');
    app.updateSettings({ boardTheme: 'light' });
    expect(app.appStore.getState().settings.boardTheme).toBe('light');

    expect(await app.watchAdToUnlockTheme('ocean')).toMatchObject({ kind: 'earned', credits: 0 });
    expect(app.appStore.getState()).toMatchObject({ unlockedThemes: ['ocean'], settings: { boardTheme: 'ocean' } });
    app.updateSettings({ boardTheme: 'charcoal' });
    app.updateSettings({ boardTheme: 'ocean' });
    expect(app.appStore.getState().settings.boardTheme).toBe('ocean');
    expect(await (await reopen()).listGrantIds('theme:')).toEqual(['theme:ocean']);
    expect(await app.watchAdToUnlockTheme('light')).toEqual({ kind: 'failed', reason: 'unsupported' });

    // Unlocks are kept when progress is reset.
    await app.resetProgress();
    expect(app.appStore.getState().unlockedThemes).toEqual(['ocean']);
    db.close();
  });

  it('keeps a theme that was chosen before themes had locks', async () => {
    const { app, db, reopen } = await setup(async (repo) => {
      await repo.saveSettings({ ...(await repo.loadSettings()), boardTheme: 'sunset' });
    });
    expect(app.appStore.getState()).toMatchObject({ unlockedThemes: ['sunset'], settings: { boardTheme: 'sunset' } });
    app.updateSettings({ boardTheme: 'charcoal' });
    app.updateSettings({ boardTheme: 'sunset' });
    expect(app.appStore.getState().settings.boardTheme).toBe('sunset');
    expect(await (await reopen()).listGrantIds('theme:')).toEqual(['theme:sunset']);
    db.close();
  });

  it('saves a Speed Round extension with the ad and hands it back', async () => {
    const { app, db, reopen } = await setup();
    let progress = startSpeedRound(EMPTY_SPEED_PROGRESS, DEFAULT_SPEED_OPTIONS, 1000, () => 0);
    progress = finishSpeedRound(progress, 1000 + DEFAULT_SPEED_OPTIONS.minutes * 60_000);
    await app.saveModeProgress(SPEED_PROGRESS_KEY, progress);

    const granted: SpeedProgress[] = [];
    const extend = () => app.watchAdForModeProgress(SPEED_PROGRESS_KEY, () => extendSpeedRound(progress), (next) => { granted.push(next); progress = next; });
    expect(await extend()).toMatchObject({ kind: 'earned', credits: 0 });
    expect(granted).toHaveLength(1);
    expect(readSpeedProgress(await (await reopen()).loadModeProgress(SPEED_PROGRESS_KEY)).round).toMatchObject({ extended: true, pausedMs: SPEED_EXTENSION_MS });
    // The round has used its extension, so a second ad is refused and nothing is saved.
    expect(await extend()).toEqual({ kind: 'failed', reason: 'grant-error' });
    expect(granted).toHaveLength(1);
    db.close();
  });
});
