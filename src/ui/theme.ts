import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { appStore } from '../state/app';
import { useStore } from '../state/store';

/** Ink-blue surfaces, mint actions, and amber feedback. */
export const colors = {
  bg: '#101524',
  surface: '#192236',
  surfaceHigh: '#253650',
  line: '#31405A',
  lineStrong: '#657C9E',
  text: '#F2F6FF',
  textDim: '#B1C0D7',
  textFaint: '#91A4BF',
  accent: '#80EAC6',
  accentPressed: '#5DCFAC',
  accentSoft: '#214A49',
  onAccent: '#0C2728',
  /** Digits the player entered. */
  entry: '#9FEFD8',
  /** Conflicts and mistakes. Always paired with a marker, never colour alone. */
  warn: '#FFD48A',
  warnSoft: '#47351F',
  good: '#A2E9A4',
  cell: '#182135',
  cellAlternate: '#1C2940',
  cellPeer: '#2A3C59',
  overlay: 'rgba(8, 12, 22, 0.78)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 9, md: 14, lg: 22 };

/** Minimum touch target edge, in dp. */
export const TOUCH = 48;

export const type = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 16, lineHeight: 23, color: colors.text },
  dim: { fontSize: 14, lineHeight: 20, color: colors.textDim },
  label: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.6, color: colors.textDim },
};

/** True when the player or the system asks for reduced motion. */
export function useReducedMotion(): boolean {
  const setting = useStore(appStore, (s) => s.settings.reducedMotion);
  const [system, setSystem] = useState(true);
  useEffect(() => {
    let mounted = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      changed = true;
      setSystem(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted && !changed) setSystem(enabled);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return setting || system;
}
