import { afterEach, describe, expect, it, vi } from 'vitest';

import { enterMiniClassic, MINI_CLASSIC_KEY } from '../src/game/miniClassic';
import { DEFAULT_SESSION_RULES, enterDigit } from '../src/game/session';
import type { SqlDriver } from '../src/storage/database';
import { Repository } from '../src/storage/repository';
import { createMemoryDb, nodeDriver } from './helpers';

vi.mock('../src/ads', () => ({
  createAdProvider: () => { throw new Error('Ads unavailable in tests'); },
}));
vi.mock('../src/storage/expoDriver', () => ({ openExpoDriver: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

async function setup(wrapDriver: (driver: SqlDriver) => SqlDriver = (driver) => driver) {
  const { openExpoDriver } = await import('../src/storage/expoDriver');
  const app = await import('../src/state/app');
  const db = createMemoryDb();
  const driver = nodeDriver(db);
  vi.mocked(openExpoDriver).mockResolvedValueOnce(wrapDriver(driver));
  await app.initApp();
  return { app, db, reopen: () => Repository.open(driver) };
}

describe('discarding one saved game', () => {
  it('removes only the requested slot and cannot be undone by delayed autosaves or hint writes', async () => {
    vi.useFakeTimers();
    const { app, db, reopen } = await setup();
    const classic = app.startClassic('expert');
    const daily = app.startDaily('2026-11-23');
    const mini = await app.startMiniClassic('mini-4', DEFAULT_SESSION_RULES);
    const cell = classic.values.indexOf(0);
    app.mutateSession('classic', (session) => enterDigit(session, cell, session.solution[cell], { smartNotes: true }));
    const hint = app.getHintOffer('classic');
    if (hint?.kind !== 'available') throw new Error('A free hint should be available');
    const revealing = app.revealHint('classic', hint);
    const quitting = app.quitSession('classic', classic.id);
    expect(await app.quitSession('classic', classic.id)).toBe(false);
    expect(await app.revealHint('classic', hint)).toBe('error');
    await revealing;
    expect(await quitting).toBe(true);
    vi.advanceTimersByTime(2000);
    app.flushSession('classic');

    expect(app.appStore.getState()).toMatchObject({ sessions: { classic: null, daily }, miniClassic: mini });
    const repo = await reopen();
    expect(await repo.loadSessions()).toMatchObject({ classic: null, daily });
    expect(await repo.loadModeProgress(MINI_CLASSIC_KEY)).toEqual(mini);
    expect(await repo.listCompletions()).toEqual([]);
    db.close();
  });

  it('removes a mini save and leaves the other board available after reopening', async () => {
    const { app, db, reopen } = await setup();
    const classic = app.startClassic('hard');
    const mini = await app.startMiniClassic('mini-6', DEFAULT_SESSION_RULES);
    app.miniClassicClock.load('mini', 0, mini.id);
    app.miniClassicClock.start();
    const cell = mini.progress.values.indexOf(0);
    app.mutateMiniClassic(mini.id, (session) => enterMiniClassic(session, cell, 1, true, true));

    expect(await app.quitMiniClassic(mini.id)).toBe(true);
    app.flushMiniClassic(mini.id);
    expect(app.miniClassicClock.running).toBe(false);
    expect(app.appStore.getState()).toMatchObject({ sessions: { classic }, miniClassic: null });
    const repo = await reopen();
    expect(await repo.loadSessions()).toMatchObject({ classic });
    expect(await repo.loadModeProgress(MINI_CLASSIC_KEY)).toBeNull();
    db.close();
  });

  it('protects replacement games from a stale confirmation', async () => {
    const { app, db, reopen } = await setup();
    const classic = app.startClassic('hard');
    const mini = await app.startMiniClassic('mini-4', DEFAULT_SESSION_RULES);
    const classicReplacement = app.startClassic('expert');
    const miniReplacement = await app.startMiniClassic('mini-6', DEFAULT_SESSION_RULES);

    expect(await app.quitSession('classic', classic.id)).toBe(false);
    expect(await app.quitMiniClassic(mini.id)).toBe(false);
    const repo = await reopen();
    expect(await repo.loadSessions()).toMatchObject({ classic: classicReplacement });
    expect(await repo.loadModeProgress(MINI_CLASSIC_KEY)).toEqual(miniReplacement);
    db.close();
  });

  it('keeps the attempt and its latest move when deleting the save fails', async () => {
    const { app, db } = await setup((driver) => ({
      ...driver,
      run: (sql, params) => {
        if (sql.startsWith('DELETE FROM sessions')) return Promise.reject(new Error('Could not write to SQLite'));
        return driver.run(sql, params);
      },
    }));
    const classic = app.startClassic('hard');
    const cell = classic.values.indexOf(0);
    const edited = app.mutateSession('classic', (session) => enterDigit(session, cell, session.solution[cell], { smartNotes: true }));

    await expect(app.quitSession('classic', classic.id)).rejects.toThrow('Could not write to SQLite');
    await app.listCompletions(); // Wait for the save queue.
    expect(app.appStore.getState().sessions.classic).toEqual(edited);
    const stored = db.prepare('SELECT data FROM sessions WHERE slot = ?').get('classic') as { data: string };
    expect(JSON.parse(stored.data)).toEqual(edited);
    db.close();
  });
});
