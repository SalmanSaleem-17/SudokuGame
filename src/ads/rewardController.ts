/**
 * Runs one opt-in rewarded ad at a time and turns the SDK's earned-reward event into a
 * local credit grant. Knows nothing about the puzzle; the game only observes its state.
 */
import type { AdFailureReason, AdRequestHandle, RewardedAdProvider } from './types';

/** Hint credits granted for one earned reward. */
export const CREDITS_PER_REWARD = 2;

export type RewardOutcome =
  | { kind: 'earned'; credits: number; balance: number }
  /** The ad was closed before the reward was earned. */
  | { kind: 'dismissed' }
  | { kind: 'failed'; reason: AdFailureReason | 'grant-error' }
  /** Another ad attempt is already in progress; nothing was started. */
  | { kind: 'busy' };

export type RewardPhase = 'idle' | 'loading' | 'showing';

export interface RewardState {
  phase: RewardPhase;
  /** Result of the most recent attempt; cleared when a new attempt starts. */
  lastOutcome: RewardOutcome | null;
}

export interface RewardLedger {
  /** Must be idempotent per grantId: a repeated id never raises the balance twice. */
  grant(grantId: string, credits: number): Promise<{ granted: boolean; balance: number }>;
}

export interface RewardControllerOptions {
  provider: RewardedAdProvider;
  ledger: RewardLedger;
  /** Unique id per ad show attempt. */
  newAttemptId: () => string;
  onBalance: (balance: number) => void;
  /** Give up if the ad has not opened within this time. */
  loadTimeoutMs?: number;
  /** After a close without reward, keep listening this long for a late reward event. */
  closeGraceMs?: number;
}

interface Attempt {
  id: string;
  handle: AdRequestHandle | null;
  opened: boolean;
  closed: boolean;
  settled: boolean;
  grant: Promise<{ granted: boolean; balance: number } | null> | null;
  timeout: ReturnType<typeof setTimeout> | null;
}

export class RewardController {
  private state: RewardState = { phase: 'idle', lastOutcome: null };
  private listeners = new Set<() => void>();
  private current: Attempt | null = null;
  private readonly loadTimeoutMs: number;
  private readonly closeGraceMs: number;

  constructor(private readonly options: RewardControllerOptions) {
    this.loadTimeoutMs = options.loadTimeoutMs ?? 20000;
    this.closeGraceMs = options.closeGraceMs ?? 5000;
  }

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setState(next: Partial<RewardState>) {
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  clearOutcome() {
    if (this.state.lastOutcome) this.setState({ lastOutcome: null });
  }

  /**
   * Shows one rewarded ad. Call only from an explicit player opt-in. While an attempt is
   * loading or showing, further calls return `busy` without starting anything.
   */
  watchAd(): Promise<RewardOutcome> {
    if (this.current || this.state.phase !== 'idle') return Promise.resolve({ kind: 'busy' });

    const providerState = this.options.provider.getState();
    if (!providerState.supported || !providerState.canRequestAds) {
      const outcome: RewardOutcome = { kind: 'failed', reason: providerState.supported ? 'consent' : 'unsupported' };
      this.setState({ lastOutcome: outcome });
      return Promise.resolve(outcome);
    }

    return new Promise<RewardOutcome>((resolve) => {
      const attempt: Attempt = {
        id: this.options.newAttemptId(),
        handle: null,
        opened: false,
        closed: false,
        settled: false,
        grant: null,
        timeout: null,
      };
      this.current = attempt;
      this.setState({ phase: 'loading', lastOutcome: null });

      const clearLoadTimeout = () => {
        if (attempt.timeout) clearTimeout(attempt.timeout);
        attempt.timeout = null;
      };

      /** Ends the attempt for the UI. Listeners may stay alive afterwards (see onClosed). */
      const settle = (outcome: RewardOutcome, release: boolean) => {
        if (attempt.settled) return;
        attempt.settled = true;
        clearLoadTimeout();
        if (release) attempt.handle?.release();
        if (this.current === attempt) this.current = null;
        this.setState({ phase: 'idle', lastOutcome: outcome });
        resolve(outcome);
      };

      const earnedOutcome = async (): Promise<RewardOutcome> => {
        const result = await attempt.grant;
        return result
          ? { kind: 'earned', credits: CREDITS_PER_REWARD, balance: result.balance }
          : { kind: 'failed', reason: 'grant-error' };
      };

      attempt.timeout = setTimeout(() => {
        // Releasing guarantees an ad that finishes loading later is never shown.
        if (!attempt.opened) settle({ kind: 'failed', reason: 'timeout' }, true);
      }, this.loadTimeoutMs);

      const handle = this.options.provider.request({
        onOpened: () => {
          if (attempt.settled || attempt.opened) return;
          attempt.opened = true;
          clearLoadTimeout();
          this.setState({ phase: 'showing' });
        },

        onEarned: () => {
          // One grant per attempt, however many times the SDK repeats the event.
          if (attempt.grant) return;
          attempt.grant = this.options.ledger
            .grant(attempt.id, CREDITS_PER_REWARD)
            .then((result) => {
              this.options.onBalance(result.balance);
              return result;
            })
            .catch(() => null);
          if (attempt.closed) {
            // Reward arrived after the close event: upgrade the reported outcome.
            void earnedOutcome().then((outcome) => {
              attempt.handle?.release();
              if (this.state.lastOutcome?.kind === 'dismissed') this.setState({ lastOutcome: outcome });
            });
          }
        },

        onClosed: () => {
          if (attempt.closed) return;
          attempt.closed = true;
          if (attempt.grant) {
            void earnedOutcome().then((outcome) => settle(outcome, true));
            return;
          }
          // No reward yet. Report the dismissal now, but keep listening briefly because
          // the reward and close events are independent and may arrive in either order.
          settle({ kind: 'dismissed' }, false);
          setTimeout(() => attempt.handle?.release(), this.closeGraceMs);
        },

        onFailed: (reason) => {
          if (attempt.closed) return;
          if (attempt.grant) {
            // The reward was already earned; a late error must not lose it.
            attempt.closed = true;
            void earnedOutcome().then((outcome) => settle(outcome, true));
            return;
          }
          settle({ kind: 'failed', reason }, true);
        },
      });
      attempt.handle = handle;
      // A provider may fail synchronously, before the handle exists.
      if (attempt.settled && !attempt.closed) handle.release();
    });
  }
}
