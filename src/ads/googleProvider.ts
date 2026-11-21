/**
 * Google Mobile Ads (AdMob) rewarded ads with UMP consent. The only file that touches
 * react-native-google-mobile-ads. The package is required lazily so the app still runs
 * where the native module is absent, such as Expo Go.
 */
import { TurboModuleRegistry } from 'react-native';

import type { AdsConfig } from './config';
import type {
  AdFailureReason,
  AdProviderState,
  AdRequestCallbacks,
  AdRequestHandle,
  RewardedAdProvider,
} from './types';

type AdsModule = typeof import('react-native-google-mobile-ads');

export function loadGoogleAdsModule(): AdsModule | null {
  // Checking the registry first avoids the hard error the package throws on import
  // when its native side is missing.
  if (!TurboModuleRegistry.get('RNGoogleMobileAdsModule')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads') as AdsModule;
  } catch {
    return null;
  }
}

export class GoogleAdProvider implements RewardedAdProvider {
  private state: AdProviderState = { supported: true, canRequestAds: false, privacyOptionsRequired: false };
  private listeners = new Set<() => void>();
  private startPromise: Promise<void> | null = null;
  private sdkInit: Promise<boolean> | null = null;

  constructor(
    private readonly ads: AdsModule,
    private readonly config: AdsConfig,
  ) {}

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setState(next: Partial<AdProviderState>) {
    const merged = { ...this.state, ...next };
    if (
      merged.canRequestAds === this.state.canRequestAds &&
      merged.privacyOptionsRequired === this.state.privacyOptionsRequired
    ) {
      return;
    }
    this.state = merged;
    for (const listener of [...this.listeners]) listener();
  }

  /** Runs once per app launch, however many callers or consent callbacks trigger it. */
  start(): Promise<void> {
    this.startPromise ??= this.gatherConsent();
    return this.startPromise;
  }

  private async gatherConsent(): Promise<void> {
    const { AdsConsent } = this.ads;
    // Consent stored from an earlier launch lets the SDK start without waiting on the network.
    await this.applyConsentInfo(() => AdsConsent.getConsentInfo());
    // Refresh consent every launch and show the form if one is required.
    await this.applyConsentInfo(() => AdsConsent.gatherConsent());
  }

  private async applyConsentInfo(read: () => Promise<import('react-native-google-mobile-ads').AdsConsentInfo>) {
    try {
      const info = await read();
      this.setState({
        canRequestAds: info.canRequestAds,
        privacyOptionsRequired:
          info.privacyOptionsRequirementStatus === this.ads.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
      });
      if (info.canRequestAds) void this.initializeSdk();
    } catch {
      // Offline or consent service error: keep whatever the last known state allows.
    }
  }

  /** Initializes the Mobile Ads SDK once, and only after consent allows ad requests. */
  private initializeSdk(): Promise<boolean> {
    this.sdkInit ??= this.ads
      .default()
      .initialize()
      .then(
        () => true,
        () => {
          this.sdkInit = null;
          return false;
        },
      );
    return this.sdkInit;
  }

  async showPrivacyOptions(): Promise<void> {
    await this.applyConsentInfo(() => this.ads.AdsConsent.showPrivacyOptionsForm());
  }

  request(callbacks: AdRequestCallbacks): AdRequestHandle {
    const { RewardedAd, RewardedAdEventType, AdEventType } = this.ads;
    let released = false;
    let ad: ReturnType<typeof RewardedAd.createForAdRequest> | null = null;

    const fail = (reason: AdFailureReason) => {
      if (!released) callbacks.onFailed(reason);
    };

    const begin = async () => {
      if (!this.state.canRequestAds) return fail('consent');
      if (!this.config.rewardedUnitId) return fail('unsupported');
      if (!(await this.initializeSdk())) return fail('load-error');
      if (released) return;

      ad = RewardedAd.createForAdRequest(this.config.rewardedUnitId);
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        // A released request (timeout, cancel) must never put an ad on screen.
        if (released || !ad) return;
        ad.show().catch(() => fail('show-error'));
      });
      ad.addAdEventListener(AdEventType.OPENED, () => {
        if (!released) callbacks.onOpened();
      });
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        if (!released) callbacks.onEarned();
      });
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        if (!released) callbacks.onClosed();
      });
      ad.addAdEventListener(AdEventType.ERROR, (error) => {
        if (error.phase === 'show') return fail('show-error');
        if (error.reason === 'no-fill' || error.reason === 'mediation-no-fill') return fail('no-fill');
        if (error.reason === 'network-error') return fail('offline');
        if (error.reason === 'timeout') return fail('timeout');
        fail('load-error');
      });
      ad.load();
    };
    void begin().catch(() => fail('load-error'));

    return {
      release: () => {
        if (released) return;
        released = true;
        try {
          ad?.destroy();
        } catch {
          // Already destroyed by the SDK.
        }
        ad = null;
      },
    };
  }
}
