/**
 * Deterministic stand-in for the ad SDK. Used by automated tests (driven event by event)
 * and, in development only, to walk through the reward flow where the native SDK is
 * absent. It never contacts an ad network.
 */
import type {
  AdFailureReason,
  AdProviderState,
  AdRequestCallbacks,
  AdRequestHandle,
  RewardedAdProvider,
} from './types';

export type MockAdEvent = 'opened' | 'earned' | 'closed' | { fail: AdFailureReason };

export interface MockAdRequest {
  released: boolean;
  /** Delivers an event unless the request was released, as a real SDK listener would. */
  emit(event: MockAdEvent): void;
}

export interface MockAdProviderOptions {
  state?: Partial<AdProviderState>;
  /** When set, each request plays this script on timers instead of waiting for emit(). */
  autoPlay?: { event: MockAdEvent; afterMs: number }[];
}

export class MockAdProvider implements RewardedAdProvider {
  readonly requests: MockAdRequest[] = [];
  startCalls = 0;
  privacyOptionsShown = 0;
  private state: AdProviderState;
  private listeners = new Set<() => void>();

  constructor(private readonly options: MockAdProviderOptions = {}) {
    this.state = { supported: true, canRequestAds: true, privacyOptionsRequired: false, ...options.state };
  }

  async start() {
    this.startCalls++;
  }

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setState(next: Partial<AdProviderState>) {
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  async showPrivacyOptions() {
    this.privacyOptionsShown++;
  }

  get lastRequest(): MockAdRequest {
    const request = this.requests[this.requests.length - 1];
    if (!request) throw new Error('No ad request has been made');
    return request;
  }

  request(callbacks: AdRequestCallbacks): AdRequestHandle {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const request: MockAdRequest = {
      released: false,
      emit(event) {
        if (request.released) return;
        if (event === 'opened') callbacks.onOpened();
        else if (event === 'earned') callbacks.onEarned();
        else if (event === 'closed') callbacks.onClosed();
        else callbacks.onFailed(event.fail);
      },
    };
    this.requests.push(request);
    for (const step of this.options.autoPlay ?? []) {
      timers.push(setTimeout(() => request.emit(step.event), step.afterMs));
    }
    return {
      release() {
        request.released = true;
        timers.forEach(clearTimeout);
      },
    };
  }
}
