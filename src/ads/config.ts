/**
 * The single place ad configuration is read. Values come from app.config.ts, which
 * resolves them from environment variables at build time.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export interface AdsConfig {
  mode: 'test' | 'production';
  /** Rewarded ad unit for this platform, or null when ads are not configured for it. */
  rewardedUnitId: string | null;
  /** Simulate ads in development when the native SDK is missing. Never true in release builds. */
  devMock: boolean;
}

interface AdsExtra {
  mode?: string;
  rewardedUnitId?: { android?: string | null; ios?: string | null };
  devMock?: boolean;
}

export function getAdsConfig(): AdsConfig {
  const extra = (Constants.expoConfig?.extra?.ads ?? {}) as AdsExtra;
  const unit = Platform.OS === 'android' ? extra.rewardedUnitId?.android : Platform.OS === 'ios' ? extra.rewardedUnitId?.ios : null;
  return {
    mode: extra.mode === 'production' ? 'production' : 'test',
    rewardedUnitId: typeof unit === 'string' && unit.length > 0 ? unit : null,
    devMock: __DEV__ && extra.devMock === true && extra.mode !== 'production',
  };
}
