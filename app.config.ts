import type { ConfigContext, ExpoConfig } from 'expo/config';
import { ConfigPlugin, withAndroidManifest, withGradleProperties } from 'expo/config-plugins';

/**
 * Expo raises CMake's object-path limit to 1024, which stops CMake from shortening long
 * object file names. On Windows without long-path support that breaks the native build
 * ("Filename longer than 260 characters" from ninja). 0 restores CMake's platform defaults,
 * so long names are hashed on Windows; Linux and macOS builds are unaffected.
 */
const CMAKE_PATH_PROPERTY = 'expo.android.cmakeObjectPathMax';
const withCmakePlatformPathLimit: ConfigPlugin = (config) =>
  withGradleProperties(config, (gradle) => {
    gradle.modResults = gradle.modResults.filter((p) => !(p.type === 'property' && p.key === CMAKE_PATH_PROPERTY));
    gradle.modResults.push({ type: 'property', key: CMAKE_PATH_PROPERTY, value: '0' });
    return gradle;
  });

/**
 * Locking the app to portrait makes Android treat a portrait screen as required hardware,
 * which hides the app on Google Play from devices that do not report one (Chromebooks, PCs,
 * XR). Declaring the feature as optional keeps the app portrait while restoring availability.
 */
const PORTRAIT_FEATURE = 'android.hardware.screen.portrait';
const withOptionalPortraitFeature: ConfigPlugin = (config) =>
  withAndroidManifest(config, (android) => {
    const manifest = android.modResults.manifest;
    const features = (manifest['uses-feature'] ?? []).filter((f) => f.$['android:name'] !== PORTRAIT_FEATURE);
    features.push({ $: { 'android:name': PORTRAIT_FEATURE, 'android:required': 'false' } });
    manifest['uses-feature'] = features;
    return android;
  });

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

const LAUNCH_BACKGROUND = '#0C0D10';

// WorkManager instantiates these generated Room databases and input mergers by reflection.
// R8 removed their constructors in the version 2 release.
const ANDROID_STARTUP_KEEP_RULES = [
  '-keep class * extends androidx.room.RoomDatabase { <init>(); }',
  '-keep class * extends androidx.work.InputMerger { <init>(); }',
].join('\n');

export default ({ config }: ConfigContext): ExpoConfig => {
  const ads = resolveAds();
  const expo: ExpoConfig = {
    ...config,
    name: 'Sudoku Studio',
    slug: 'sudoku-studio',
    owner: 'salmansaleem',
    scheme: 'sudokustudio',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    backgroundColor: LAUNCH_BACKGROUND,
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.sudokustudio.app',
    },
    android: {
      package: 'com.sudoku.studio',
      // Game data and hint credits stay on the device: no Android cloud backup.
      allowBackup: false,
      versionCode: 3,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#19191B',
      },
    },
    plugins: [
      'expo-router',
      'expo-sqlite',
      ['expo-build-properties', { android: { extraProguardRules: ANDROID_STARTUP_KEEP_RULES } }],
      [
        'expo-splash-screen',
        {
          image: './assets/sudoku-graphite-wordmark.png',
          backgroundColor: LAUNCH_BACKGROUND,
          resizeMode: 'contain',
          // The wide wordmark fits inside Android's 192 dp circular splash safe area at this width.
          imageWidth: 172,
          ios: { imageWidth: 240 },
        },
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
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        projectId: 'b37fe119-ebc2-4d45-9a6c-2c28261e4969',
      },
      ads: {
        mode: ads.mode,
        rewardedUnitId: { android: ads.rewardedAndroid, ios: ads.rewardedIos },
        // Development only: simulate rewarded ads where the native SDK is absent (Expo Go).
        devMock: process.env.ADS_DEV_MOCK === '1',
      },
    },
  };
  return withOptionalPortraitFeature(withCmakePlatformPathLimit(expo));
};
