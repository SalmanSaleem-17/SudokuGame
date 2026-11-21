import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * AdMob configuration is read from environment variables (see .env.example).
 *
 *   ADS_MODE=test        Google's sample app ID and test rewarded units. No real ads.
 *   ADS_MODE=production  Requires your own IDs. The build fails here if any are missing
 *                        or still point at Google's test publisher.
 */
const GOOGLE_TEST_PUBLISHER = 'ca-app-pub-3940256099942544';
const TEST = {
  androidAppId: `${GOOGLE_TEST_PUBLISHER}~3347511713`,
  iosAppId: `${GOOGLE_TEST_PUBLISHER}~1458002511`,
  rewardedAndroid: `${GOOGLE_TEST_PUBLISHER}/5224354917`,
  rewardedIos: `${GOOGLE_TEST_PUBLISHER}/1712485313`,
};

const APP_ID_PATTERN = /^ca-app-pub-\d{16}~\d{10}$/;
const UNIT_ID_PATTERN = /^ca-app-pub-\d{16}\/\d{10}$/;

function productionId(name: string, pattern: RegExp, required: boolean): string | null {
  const value = process.env[name]?.trim();
  if (!value) {
    if (required) throw new Error(`ADS_MODE=production requires ${name}. See .env.example and the README.`);
    return null;
  }
  if (!pattern.test(value)) throw new Error(`${name} is not a valid AdMob ID: "${value}".`);
  if (value.startsWith(GOOGLE_TEST_PUBLISHER)) {
    throw new Error(`${name} is a Google test ID. Production builds must use your own AdMob IDs.`);
  }
  return value;
}

function resolveAds() {
  const mode = (process.env.ADS_MODE ?? 'test').trim();
  if (mode !== 'test' && mode !== 'production') {
    throw new Error(`ADS_MODE must be "test" or "production", got "${mode}".`);
  }
  if (mode === 'test') {
    return { mode, ...TEST };
  }
  // Android is the release platform; iOS IDs are optional and iOS ads stay off without them.
  return {
    mode,
    androidAppId: productionId('ADMOB_ANDROID_APP_ID', APP_ID_PATTERN, true)!,
    rewardedAndroid: productionId('ADMOB_REWARDED_UNIT_ANDROID', UNIT_ID_PATTERN, true)!,
    iosAppId: productionId('ADMOB_IOS_APP_ID', APP_ID_PATTERN, false),
    rewardedIos: productionId('ADMOB_REWARDED_UNIT_IOS', UNIT_ID_PATTERN, false),
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const ads = resolveAds();
  return {
    ...config,
    name: 'Sudoku Studio',
    slug: 'sudoku-studio',
    scheme: 'sudokustudio',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    backgroundColor: '#19191B',
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.sudokustudio.app',
    },
    android: {
      package: 'com.sudokustudio.app',
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#19191B',
      },
    },
    plugins: [
      'expo-router',
      'expo-sqlite',
      [
        'expo-splash-screen',
        { image: './assets/splash-icon.png', imageWidth: 180, backgroundColor: '#19191B' },
      ],
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: ads.androidAppId,
          ...(ads.iosAppId ? { iosAppId: ads.iosAppId } : {}),
          // Hold measurement until consent has been gathered.
          delayAppMeasurementInit: true,
        },
      ],
    ],
    extra: {
      ads: {
        mode: ads.mode,
        rewardedUnitId: { android: ads.rewardedAndroid, ios: ads.rewardedIos },
        // Development only: simulate rewarded ads where the native SDK is absent (Expo Go).
        devMock: process.env.ADS_DEV_MOCK === '1',
      },
    },
  };
};
