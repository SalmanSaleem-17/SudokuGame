/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest';

import appConfig from '../app.config';
import drills from '../src/data/drills.json';
import { DRILL_TECHNIQUES, DrillRecord } from '../src/engine/pool';
import { buildDrill } from '../src/game/drills';

const KEYS = ['ADS_MODE', 'ADMOB_ANDROID_APP_ID', 'ADMOB_REWARDED_UNIT_ANDROID', 'ADMOB_IOS_APP_ID', 'ADMOB_REWARDED_UNIT_IOS', 'ADS_DEV_MOCK'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function resolve(env: Record<string, string>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const adsPlugin = (config: ReturnType<typeof appConfig>) =>
  (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'react-native-google-mobile-ads') as [string, Record<string, unknown>];

describe('ad configuration', () => {
  it('defaults to Google test IDs, so an unconfigured build serves no production ads', () => {
    const config = resolve({});
    const ads = config.extra?.ads;
    expect(ads.mode).toBe('test');
    expect(ads.rewardedUnitId.android).toBe('ca-app-pub-3940256099942544/5224354917');
    expect(adsPlugin(config)[1].androidAppId).toBe('ca-app-pub-3940256099942544~3347511713');
  });

  it('fails the build clearly when production IDs are missing', () => {
    expect(() => resolve({ ADS_MODE: 'production' })).toThrow(/requires ADMOB_ANDROID_APP_ID/);
    expect(() => resolve({ ADS_MODE: 'production', ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456~1234567890' })).toThrow(
      /requires ADMOB_REWARDED_UNIT_ANDROID/,
    );
  });

  it('rejects test IDs and malformed IDs in production', () => {
    expect(() =>
      resolve({
        ADS_MODE: 'production',
        ADMOB_ANDROID_APP_ID: 'ca-app-pub-3940256099942544~3347511713',
        ADMOB_REWARDED_UNIT_ANDROID: 'ca-app-pub-1234567890123456/1234567890',
      }),
    ).toThrow(/Google test ID/);
    expect(() =>
      resolve({
        ADS_MODE: 'production',
        // App ID and unit ID swapped.
        ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456/1234567890',
        ADMOB_REWARDED_UNIT_ANDROID: 'ca-app-pub-1234567890123456~1234567890',
      }),
    ).toThrow(/not a valid AdMob ID/);
    expect(() => resolve({ ADS_MODE: 'live' })).toThrow(/ADS_MODE/);
  });

  it('keeps the app ID and the rewarded unit ID separate in production', () => {
    const config = resolve({
      ADS_MODE: 'production',
      ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456~1234567890',
      ADMOB_REWARDED_UNIT_ANDROID: 'ca-app-pub-1234567890123456/9876543210',
      ADS_DEV_MOCK: '1',
    });
    expect(adsPlugin(config)[1].androidAppId).toBe('ca-app-pub-1234567890123456~1234567890');
    expect(config.extra?.ads.rewardedUnitId).toEqual({ android: 'ca-app-pub-1234567890123456/9876543210', ios: null });
    expect(config.extra?.ads.mode).toBe('production');
  });
});

describe('practice drills', () => {
  const all = drills as DrillRecord[];

  it('covers naked singles, hidden singles and locked candidates', () => {
    for (const technique of DRILL_TECHNIQUES) {
      expect(all.filter((d) => d.technique === technique).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('builds a question whose answer is accepted and explained', () => {
    for (const record of all) {
      const drill = buildDrill(record);
      const s = drill.solution;
      const answer = drill.answerType === 'cell' ? s.placement!.cell : (s.placement?.digit ?? s.eliminations[0].digit);
      const step = drill.check(answer);
      expect(step).not.toBeNull();
      expect(step!.explanation.length).toBeGreaterThan(20);
      expect(drill.focusCells.length).toBeGreaterThan(0);
      // A wrong answer is rejected: 0 is never a valid digit, and a filled cell never the target.
      expect(drill.check(drill.answerType === 'cell' ? drill.values.findIndex((v) => v !== 0) : 0)).toBeNull();
    }
  });
});
