import { describe, expect, it } from 'vitest';

import puzzles from '../src/data/puzzles.json';
import type { PuzzleRecord } from '../src/engine/pool';
import { evaluateHint, withHintRevealed } from '../src/game/hintAccess';
import { Session, createSession, enterDigit, toggleNote, undoMove } from '../src/game/session';
import { Database } from '../src/storage/database';
import { InsufficientCreditsError, Repository } from '../src/storage/repository';
import { createMemoryDb, nodeDriver } from './helpers';

const POOL = puzzles as PuzzleRecord[];
const SMART = { smartNotes: true };

async function setup() {
  const db = createMemoryDb();
  const repo = await Repository.open(nodeDriver(db));
  /** Simulates killing the app: a brand new repository over the same database file. */
  const restart = () => Repository.open(nodeDriver(db));
  return { db, repo, restart };
}

function solveAll(session: Session): Session {
  let s = session;
  for (let cell = 0; cell < 81; cell++) if (s.values[cell] === 0) s = enterDigit(s, cell, s.solution[cell], SMART);
  return s;
}

/** Reveals the next hint the way the app does: evaluate, then persist with its payment. */
async function reveal(repo: Repository, session: Session) {
  const offer = evaluateHint(session, await repo.getCredits());
  if (offer.kind !== 'available') return { offer, session, charged: false };
  const next = withHintRevealed(session, offer.hint, offer.cost);
  const { charged } = await repo.spendHint(next, offer.cost, 1);
  return { offer, session: next, charged };
}

/** Applies the revealed hint so the board (and therefore the next hint) changes. */
function applyHint(session: Session): Session {
  const steps = session.hint!.result.steps;
  const { cell, digit } = steps[steps.length - 1].placement!;
  return enterDigit(session, cell, digit, SMART);
}

describe('first launch', () => {
  it('starts with defaults, no sessions and no credits, with nothing but local storage', async () => {
    const { repo } = await setup();
    expect(await repo.loadSessions()).toEqual({ classic: null, daily: null });
    expect(await repo.getCredits()).toBe(0);
    expect((await repo.loadSettings()).timer).toBe(true);
    expect(await repo.listCompletions()).toEqual([]);
  });

  it('migrates once and reopens without re-running the schema', async () => {
    const { db, restart } = await setup();
    await restart();
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(1);
  });

  it('refuses data written by a newer schema', async () => {
    const { db, restart } = await setup();
    db.exec('PRAGMA user_version = 99');
    await expect(restart()).rejects.toThrow(/newer app version/);
  });
});

describe('sessions', () => {
  it('restores board, notes, undo history, elapsed time and hint state after a restart', async () => {
    const { repo, restart } = await setup();
    let s = createSession(POOL[0], 'classic', 'c1', 1);
    const empties = s.values.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
    s = toggleNote(s, empties[0], 4);
    s = enterDigit(s, empties[1], s.solution[empties[1]], SMART);
    s = { ...s, elapsedMs: 93500 };
    await repo.saveSession(s, 2);
    const revealed = (await reveal(repo, s)).session;

    const reopened = await restart();
    const loaded = (await reopened.loadSessions()).classic!;
    expect(loaded).toEqual(revealed);
    expect(loaded.elapsedMs).toBe(93500);
    expect(loaded.hint?.result.steps.length).toBeGreaterThan(0);
    expect(loaded.freeHintUsed).toBe(true);
    // Undo history still works on the restored session.
    expect(undoMove(loaded).values[empties[1]]).toBe(0);
  });

  it('keeps classic and daily sessions independent', async () => {
    const { repo, restart } = await setup();
    const classic = createSession(POOL[0], 'classic', 'c1', 1);
    const daily = createSession(POOL[1], 'daily', 'd1', 1, '2026-11-21');
    await repo.saveSession(classic, 1);
    await repo.saveSession(daily, 1);
    const cell = classic.values.findIndex((v) => v === 0);
    await repo.saveSession(enterDigit(classic, cell, classic.solution[cell], SMART), 2);

    const loaded = await (await restart()).loadSessions();
    expect(loaded.classic?.puzzleId).toBe(POOL[0].id);
    expect(loaded.classic?.values[cell]).toBe(classic.solution[cell]);
    expect(loaded.daily).toEqual(daily);
    expect(loaded.daily?.dateKey).toBe('2026-11-21');
  });

  it('ignores a corrupt saved session instead of crashing', async () => {
    const { db, repo } = await setup();
    await repo.saveSession(createSession(POOL[0], 'classic', 'c1', 1), 1);
    db.exec("UPDATE sessions SET data = '{not json'");
    expect((await repo.loadSessions()).classic).toBeNull();
  });
});

describe('completions', () => {
  it('records a completion once, however often it is submitted', async () => {
    const { repo, restart } = await setup();
    const done = { ...solveAll(createSession(POOL[0], 'classic', 'c1', 1)), elapsedMs: 120000, mistakes: 2, hintsUsed: 1 };
    expect(done.completed).toBe(true);
    await repo.saveSession(done, 1);

    expect((await repo.recordCompletion(done, 5)).recorded).toBe(true);
    expect((await repo.recordCompletion(done, 6)).recorded).toBe(false);
    // Even after a restart, replaying the same finished session adds nothing.
    const reopened = await restart();
    expect((await reopened.recordCompletion(done, 7)).recorded).toBe(false);

    const all = await reopened.listCompletions();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ sessionId: 'c1', timeMs: 120000, mistakes: 2, hints: 1, completedAt: 5 });
    expect((await reopened.loadSessions()).classic).toBeNull();
  });

  it('does not let a late autosave bring a finished session back', async () => {
    const { repo } = await setup();
    const done = solveAll(createSession(POOL[0], 'classic', 'c1', 1));
    await repo.recordCompletion(done, 5);
    expect(await repo.saveSession(done, 6)).toBe(false);
    expect((await repo.loadSessions()).classic).toBeNull();
  });

  it('records one daily completion per date, under the date the puzzle was started', async () => {
    const { repo } = await setup();
    const first = solveAll(createSession(POOL[1], 'daily', 'd1', 1, '2026-11-21'));
    // Finished after midnight: it still counts for the 21st.
    expect((await repo.recordCompletion(first, Date.UTC(2026, 10, 22, 3))).recorded).toBe(true);
    const again = solveAll(createSession(POOL[1], 'daily', 'd2', 1, '2026-11-21'));
    expect((await repo.recordCompletion(again, 9)).recorded).toBe(false);
    expect(await repo.listDailyCompletionDates()).toEqual(['2026-11-21']);
    expect((await repo.getDailyCompletion('2026-11-21'))?.sessionId).toBe('d1');
    expect(await repo.getDailyCompletion('2026-11-22')).toBeNull();
  });

  it('completes a puzzle fully offline', async () => {
    const { repo, restart } = await setup();
    let s = createSession(POOL[2], 'classic', 'c9', 1);
    await repo.saveSession(s, 1);
    s = solveAll(s);
    await repo.saveSession(s, 2);
    await repo.recordCompletion(s, 3);
    expect((await (await restart()).getCompletion('c9'))?.puzzleId).toBe(POOL[2].id);
  });
});

describe('hint payment', () => {
  it('gives each session one free hint and consumes it only when the hint is revealed', async () => {
    const { repo } = await setup();
    const s = createSession(POOL[0], 'classic', 'c1', 1);
    await repo.saveSession(s, 1);
    expect(evaluateHint(s, 0)).toMatchObject({ kind: 'available', cost: 'free' });
    // Looking at the offer changes nothing.
    expect((await repo.loadSessions()).classic?.freeHintUsed).toBe(false);

    const first = await reveal(repo, s);
    expect(first.charged).toBe(false);
    expect(first.session.freeHintUsed).toBe(true);
    expect(first.session.hintsUsed).toBe(1);
    expect((await repo.loadSessions()).classic?.hint).toEqual(first.session.hint);
  });

  it('reopens the hint for an unchanged board for free', async () => {
    const { repo } = await setup();
    const s = createSession(POOL[0], 'classic', 'c1', 1);
    await repo.saveSession(s, 1);
    const { session } = await reveal(repo, s);
    expect(evaluateHint(session, 0).kind).toBe('owned');
    expect(evaluateHint(session, 5).kind).toBe('owned');
    // Editing the board and returning to the same position is still free.
    const cell = session.values.findIndex((v) => v === 0);
    const detour = undoMove(enterDigit(session, cell, session.solution[cell], SMART));
    expect(evaluateHint(detour, 0).kind).toBe('owned');
  });

  it('asks for credits after the free hint, and a new session gets a new free hint', async () => {
    const { repo } = await setup();
    const s = createSession(POOL[0], 'classic', 'c1', 1);
    await repo.saveSession(s, 1);
    const moved = applyHint((await reveal(repo, s)).session);
    expect(evaluateHint(moved, 0).kind).toBe('needCredits');
    expect(evaluateHint(createSession(POOL[3], 'classic', 'c2', 2), 0)).toMatchObject({ kind: 'available', cost: 'free' });
  });

  it('spends one credit per paid hint, with the explanation saved in the same transaction', async () => {
    const { repo, restart } = await setup();
    await repo.grantReward('grant-1', 2, 1);
    let s = createSession(POOL[0], 'classic', 'c1', 1);
    await repo.saveSession(s, 1);
    s = applyHint((await reveal(repo, s)).session);

    const paid = await reveal(repo, s);
    expect(paid.offer).toMatchObject({ kind: 'available', cost: 'credit' });
    expect(paid.charged).toBe(true);
    expect(await repo.getCredits()).toBe(1);

    const reopened = await restart();
    const loaded = (await reopened.loadSessions()).classic!;
    expect(loaded.hint).toEqual(paid.session.hint);
    expect(loaded.hintsUsed).toBe(2);
    expect(evaluateHint(loaded, await reopened.getCredits()).kind).toBe('owned');
  });

  it('never charges twice for the same board, even on a repeated request', async () => {
    const { repo } = await setup();
    await repo.grantReward('grant-1', 2, 1);
    let s = createSession(POOL[0], 'classic', 'c1', 1);
    await repo.saveSession(s, 1);
    s = applyHint((await reveal(repo, s)).session);
    const offer = evaluateHint(s, 2);
    if (offer.kind !== 'available') throw new Error('expected an available hint');
    const next = withHintRevealed(s, offer.hint, offer.cost);
    // A double tap issues the same spend twice.
    const [a, b] = await Promise.all([repo.spendHint(next, 'credit', 2), repo.spendHint(next, 'credit', 2)]);
    expect([a.charged, b.charged]).toEqual([true, false]);
    expect(await repo.getCredits()).toBe(1);
  });

  it('rolls back completely when there are no credits: no debit, no saved hint', async () => {
    const { repo } = await setup();
    let s = createSession(POOL[0], 'classic', 'c1', 1);
    await repo.saveSession(s, 1);
    s = applyHint((await reveal(repo, s)).session);
    await repo.saveSession(s, 2);
    const offer = evaluateHint(s, 1); // The UI believed a credit existed.
    if (offer.kind !== 'available') throw new Error('expected an available hint');
    await expect(repo.spendHint(withHintRevealed(s, offer.hint, 'credit'), 'credit', 3)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(await repo.getCredits()).toBe(0);
    const stored = (await repo.loadSessions()).classic!;
    expect(stored.hint).toEqual(s.hint);
    expect(stored.hintsUsed).toBe(1);
  });

  it('does not charge when wrong entries block the hint, or when no hint exists', async () => {
    const { repo } = await setup();
    await repo.grantReward('grant-1', 2, 1);
    const s = createSession(POOL[0], 'classic', 'c1', 1);
    const cell = s.values.findIndex((v) => v === 0);
    const wrong = enterDigit(s, cell, (s.solution[cell] % 9) + 1, SMART);
    const blocked = await reveal(repo, wrong);
    expect(blocked.offer.kind).toBe('blocked');
    expect(blocked.session.freeHintUsed).toBe(false);

    const unsupported = { ...s, values: new Array(81).fill(0) };
    expect((await reveal(repo, unsupported)).offer.kind).toBe('none');
    expect(await repo.getCredits()).toBe(2);
  });
});

describe('transactions', () => {
  it('commits nothing when a transaction throws part-way', async () => {
    const db = createMemoryDb();
    db.exec('CREATE TABLE t (n INTEGER)');
    const database = new Database(nodeDriver(db));
    await expect(
      database.transaction(async (tx) => {
        await tx.run('INSERT INTO t VALUES (1)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await database.transaction((tx) => tx.run('INSERT INTO t VALUES (2)'));
    expect(db.prepare('SELECT n FROM t').all()).toEqual([{ n: 2 }]);
  });

  it('runs overlapping transactions one after another', async () => {
    const { repo } = await setup();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.grantReward(`g-${i}`, 2, i)));
    expect(results.map((r) => r.balance).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => (i + 1) * 2));
    expect(await repo.getCredits()).toBe(40);
  });
});
