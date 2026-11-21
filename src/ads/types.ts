/**
 * Provider-neutral rewarded-ad contract. Game code depends only on these types; the
 * Google Mobile Ads SDK is confined to googleProvider.ts.
 */

export type AdFailureReason =
  /** Ad SDK is not part of this build (for example Expo Go). */
  | 'unsupported'
  /** Consent state does not allow ad requests. */
  | 'consent'
  | 'no-fill'
  | 'offline'
  | 'timeout'
  | 'load-error'
  | 'show-error';

export interface AdProviderState {
  /** The native ad SDK exists in this build. */
  supported: boolean;
  /** Consent has been resolved and the SDK reports that ads may be requested. */
  canRequestAds: boolean;
  /** The user must be offered a way to change privacy choices (Settings entry point). */
  privacyOptionsRequired: boolean;
}

export interface AdRequestCallbacks {
  /** The ad is on screen. */
  onOpened(): void;
  /** The SDK's earned-reward event. The only event that may grant credits. */
  onEarned(): void;
  /** The ad was dismissed. Independent of onEarned; either may arrive first. */
  onClosed(): void;
  /** Load or show failed. No ad is on screen. */
  onFailed(reason: AdFailureReason): void;
}

export interface AdRequestHandle {
  /**
   * Stops the request: an ad that has not been shown yet will never be shown, and no
   * further callbacks are delivered. Safe to call more than once.
   */
  release(): void;
}

export interface RewardedAdProvider {
  /** Refreshes consent and initializes the SDK. Idempotent; never rejects. */
  start(): Promise<void>;
  getState(): AdProviderState;
  subscribe(listener: () => void): () => void;
  /** Opens the privacy options form. Resolves when it closes. */
  showPrivacyOptions(): Promise<void>;
  /** Loads one rewarded ad and shows it as soon as it is ready. */
  request(callbacks: AdRequestCallbacks): AdRequestHandle;
}

export const UNAVAILABLE_STATE: AdProviderState = {
  supported: false,
  canRequestAds: false,
  privacyOptionsRequired: false,
};

/** Provider used when the ad SDK is absent. Every request fails immediately. */
export class UnavailableAdProvider implements RewardedAdProvider {
  async start() {}
  getState() {
    return UNAVAILABLE_STATE;
  }
  subscribe() {
    return () => {};
  }
  async showPrivacyOptions() {}
  request(callbacks: AdRequestCallbacks): AdRequestHandle {
    callbacks.onFailed('unsupported');
    return { release() {} };
  }
}
