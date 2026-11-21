import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockAdProvider } from '../src/ads/mockProvider';
import { CREDITS_PER_REWARD, RewardController, RewardOutcome } from '../src/ads/rewardController';
import { UnavailableAdProvider } from '../src/ads/types';
import puzzles from '../src/data/puzzles.json';
import type { PuzzleRecord } from '../src/engine/pool';
import { evaluateHint, withHintRevealed } from '../src/game/hintAccess';
import { createSession, enterDigit } from '../src/game/session';
import { Repository } from '../src/storage/repository';
import { createMemoryDb, nodeDriver } from './helpers';

const POOL = puzzles as PuzzleRecord[];

async function setup(options: ConstructorParameters<typeof MockAdProvider>[0] = {}) {
  const repo = await Repository.open(nodeDriver(createMemoryDb()));
  const provider = new MockAdProvider(options);
  const balances: number[] = [];
  let attempt = 0;
  const attemptIds: string[] = [];
  const controller = new RewardController({
    provider,
    ledger: { grant: (id, credits) => repo.grantReward(id, credits, 1) },
    newAttemptId: () => {
      const id = `attempt-${++attempt}`;
      attemptIds.push(id);
      return id;
    },
    onBalance: (b) => balances.push(b),
    loadTimeoutMs: 20000,
    closeGraceMs: 5000,
  });
  return { repo, provider, controller, balances, attemptIds };
}

/** Lets queued database work and promise chains finish while fake timers are active. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('rewarded ads', () => {
  it('grants exactly two credits for one earned reward', async () => {
    const { repo, provider, controller, balances } = await setup();
    const result = controller.watchAd();
    expect(controller.getState().phase).toBe('loading');
    provider.lastRequest.emit('opened');
    expect(controller.getState().phase).toBe('showing');
    provider.lastRequest.emit('earned');
    provider.lastRequest.emit('closed');
    await settle();
    expect(await result).toEqual({ kind: 'earned', credits: 2, balance: 2 });
    expect(CREDITS_PER_REWARD).toBe(2);
    expect(await repo.getCredits()).toBe(2);
    expect(balances).toEqual([2]);
    expect(controller.getState()).toMatchObject({ phase: 'idle', lastOutcome: { kind: 'earned' } });
    expect(provider.lastRequest.released).toBe(true);
  });

  it('grants nothing on load, open or dismissal alone', async () => {
    const { repo, provider, controller } = await setup();
    const result = controller.watchAd();
    provider.lastRequest.emit('opened');
    await settle();
    expect(await repo.getCredits()).toBe(0);
    provider.lastRequest.emit('closed'); // dismissed early
    expect(await result).toEqual({ kind: 'dismissed' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await repo.getCredits()).toBe(0);
    expect(provider.lastRequest.released).toBe(true);
  });

  it('ignores duplicate reward and close callbacks', async () => {
    const { repo, provider, controller, balances } = await setup();
    const result = controller.watchAd();
    const ad = provider.lastRequest;
    ad.emit('opened');
    ad.emit('earned');
    ad.emit('earned');
    ad.emit('earned');
    ad.emit('closed');
    ad.emit('closed');
    await settle();
    expect(await result).toMatchObject({ kind: 'earned', balance: 2 });
    expect(await repo.getCredits()).toBe(2);
    expect(balances).toEqual([2]);
  });

  it('cannot double-grant even if the same grant id reaches storage twice', async () => {
    const { repo } = await setup();
    expect(await repo.grantReward('same-attempt', 2, 1)).toEqual({ granted: true, balance: 2 });
    expect(await repo.grantReward('same-attempt', 2, 2)).toEqual({ granted: false, balance: 2 });
    expect(await repo.getCredits()).toBe(2);
  });

  it('handles the reward arriving after the close event', async () => {
    const { repo, provider, controller } = await setup();
    const result = controller.watchAd();
    const ad = provider.lastRequest;
    ad.emit('opened');
    ad.emit('closed');
    expect(await result).toEqual({ kind: 'dismissed' });
    // Listeners are still alive inside the grace period.
    expect(ad.released).toBe(false);
    ad.emit('earned');
    await settle();
    expect(await repo.getCredits()).toBe(2);
    expect(controller.getState().lastOutcome).toMatchObject({ kind: 'earned', balance: 2 });
    expect(ad.released).toBe(true);
  });

  it('uses a unique id for every show attempt', async () => {
    const { repo, provider, controller, attemptIds } = await setup();
    for (let i = 0; i < 3; i++) {
      const result = controller.watchAd();
      provider.lastRequest.emit('opened');
      provider.lastRequest.emit('earned');
      provider.lastRequest.emit('closed');
      await settle();
      await result;
    }
    expect(new Set(attemptIds).size).toBe(3);
    expect(await repo.getCredits()).toBe(6);
  });

  it('blocks rapid taps and simultaneous shows', async () => {
    const { repo, provider, controller } = await setup();
    const first = controller.watchAd();
    const taps = await Promise.all([controller.watchAd(), controller.watchAd(), controller.watchAd()]);
    expect(taps).toEqual([{ kind: 'busy' }, { kind: 'busy' }, { kind: 'busy' }]);
    expect(provider.requests).toHaveLength(1);

    provider.lastRequest.emit('opened');
    expect(await controller.watchAd()).toEqual({ kind: 'busy' });
    provider.lastRequest.emit('earned');
    provider.lastRequest.emit('closed');
    await settle();
    await first;
    expect(provider.requests).toHaveLength(1);
    expect(await repo.getCredits()).toBe(2);
  });

  it.each([
    ['no fill', 'no-fill'],
    ['offline', 'offline'],
    ['load failure', 'load-error'],
    ['show failure', 'show-error'],
  ] as const)('reports %s without granting, and returns to idle', async (_name, reason) => {
    const { repo, provider, controller } = await setup();
    const result = controller.watchAd();
    provider.lastRequest.emit({ fail: reason });
    expect(await result).toEqual({ kind: 'failed', reason });
    expect(controller.getState()).toEqual({ phase: 'idle', lastOutcome: { kind: 'failed', reason } });
    expect(provider.lastRequest.released).toBe(true);
    expect(await repo.getCredits()).toBe(0);
    // A later attempt needs a new opt-in and makes a new request; nothing retried by itself.
    await vi.advanceTimersByTimeAsync(60000);
    expect(provider.requests).toHaveLength(1);
  });

  it('times out a slow load and never shows that ad afterwards', async () => {
    const { repo, provider, controller } = await setup();
    const result = controller.watchAd();
    await vi.advanceTimersByTimeAsync(20000);
    expect(await result).toEqual({ kind: 'failed', reason: 'timeout' });
    const ad = provider.lastRequest;
    expect(ad.released).toBe(true);
    // The network comes back: the stale request stays dead.
    ad.emit('opened');
    ad.emit('earned');
    ad.emit('closed');
    await settle();
    expect(controller.getState().phase).toBe('idle');
    expect(await repo.getCredits()).toBe(0);
  });

  it('does not time out an ad that is already on screen', async () => {
    const { provider, controller } = await setup();
    const result = controller.watchAd();
    provider.lastRequest.emit('opened');
    await vi.advanceTimersByTimeAsync(120000);
    expect(controller.getState().phase).toBe('showing');
    provider.lastRequest.emit('earned');
    provider.lastRequest.emit('closed');
    await settle();
    expect(await result).toMatchObject({ kind: 'earned' });
  });

  it('makes no request when consent does not allow ads', async () => {
    const { repo, provider, controller } = await setup({ state: { canRequestAds: false } });
    expect(await controller.watchAd()).toEqual({ kind: 'failed', reason: 'consent' });
    expect(provider.requests).toHaveLength(0);
    expect(controller.getState().phase).toBe('idle');
    // Consent granted later: still nothing happens until the player opts in again.
    provider.setState({ canRequestAds: true });
    await vi.advanceTimersByTimeAsync(60000);
    expect(provider.requests).toHaveLength(0);
    expect(await repo.getCredits()).toBe(0);
  });

  it('makes no request when the ad SDK is absent', async () => {
    const repo = await Repository.open(nodeDriver(createMemoryDb()));
    const controller = new RewardController({
      provider: new UnavailableAdProvider(),
      ledger: { grant: (id, credits) => repo.grantReward(id, credits, 1) },
      newAttemptId: () => 'x',
      onBalance: () => undefined,
    });
    expect(await controller.watchAd()).toEqual({ kind: 'failed', reason: 'unsupported' });
    expect(await repo.getCredits()).toBe(0);
  });

  it('reports a storage failure instead of pretending credits were added', async () => {
    const provider = new MockAdProvider();
    const controller = new RewardController({
      provider,
      ledger: { grant: () => Promise.reject(new Error('disk full')) },
      newAttemptId: () => 'x',
      onBalance: () => undefined,
    });
    const result = controller.watchAd();
    provider.lastRequest.emit('opened');
    provider.lastRequest.emit('earned');
    provider.lastRequest.emit('closed');
    await settle();
    expect(await result).toEqual({ kind: 'failed', reason: 'grant-error' });
  });

  it('can run the simulated development script end to end', async () => {
    const { repo, controller } = await setup({
      autoPlay: [
        { event: 'opened', afterMs: 700 },
        { event: 'earned', afterMs: 2200 },
        { event: 'closed', afterMs: 2600 },
      ],
    });
    const result = controller.watchAd();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toMatchObject({ kind: 'earned' });
    expect(await repo.getCredits()).toBe(2);
  });
});

describe('earning online, spending offline', () => {
  it('spends an earned credit with no ad provider involved, leaving the puzzle intact', async () => {
    const { repo, provider, controller } = await setup();
    let session = createSession(POOL[0], 'classic', 'c1', 1);
    session = { ...session, elapsedMs: 41000 };
    await repo.saveSession(session, 1);

    // Online: watch an ad mid-puzzle.
    const watching = controller.watchAd();
    provider.lastRequest.emit('opened');
    provider.lastRequest.emit('earned');
    provider.lastRequest.emit('closed');
    await settle();
    const outcome: RewardOutcome = await watching;
    expect(outcome).toMatchObject({ kind: 'earned', balance: 2 });
    // The ad changed nothing about the puzzle.
    expect((await repo.loadSessions()).classic).toEqual(session);

    // Offline from here on: only local storage is touched.
    provider.setState({ canRequestAds: false });
    const free = evaluateHint(session, 2);
    if (free.kind !== 'available') throw new Error('expected free hint');
    session = withHintRevealed(session, free.hint, free.cost);
    await repo.spendHint(session, free.cost, 2);
    const { cell, digit } = free.hint.result.steps.at(-1)!.placement!;
    session = enterDigit(session, cell, digit, { smartNotes: true });

    const paid = evaluateHint(session, await repo.getCredits());
    expect(paid).toMatchObject({ kind: 'available', cost: 'credit' });
    if (paid.kind !== 'available') return;
    const result = await repo.spendHint(withHintRevealed(session, paid.hint, paid.cost), paid.cost, 3);
    expect(result).toEqual({ charged: true, balance: 1 });
    expect(provider.requests).toHaveLength(1);
  });
});
