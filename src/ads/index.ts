import { getAdsConfig } from './config';
import { GoogleAdProvider, loadGoogleAdsModule } from './googleProvider';
import { MockAdProvider } from './mockProvider';
import { RewardedAdProvider, UnavailableAdProvider } from './types';

/**
 * Chooses the ad provider for this build:
 *  - native SDK present and a unit ID configured -> Google Mobile Ads
 *  - development with ADS_DEV_MOCK=1 and no native SDK -> simulated ads
 *  - anything else -> ads unavailable; the game is unaffected
 */
export function createAdProvider(): RewardedAdProvider {
  const config = getAdsConfig();
  const module = config.rewardedUnitId ? loadGoogleAdsModule() : null;
  if (module) return new GoogleAdProvider(module, config);
  if (config.devMock) {
    return new MockAdProvider({
      autoPlay: [
        { event: 'opened', afterMs: 700 },
        { event: 'earned', afterMs: 2200 },
        { event: 'closed', afterMs: 2600 },
      ],
    });
  }
  return new UnavailableAdProvider();
}

export function isSimulatedAds(provider: RewardedAdProvider): boolean {
  return provider instanceof MockAdProvider;
}
