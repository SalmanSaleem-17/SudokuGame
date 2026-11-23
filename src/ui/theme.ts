import { useEffect, useState } from 'react';
import { AccessibilityInfo, type ViewStyle } from 'react-native';

import { appStore } from '../state/app';
import { useStore } from '../state/store';

/** Brushed charcoal, silver type, and warm gold actions. */
export const colors = {
  bg: '#0C0D10',
  surface: '#1C1D21',
  surfaceHigh: '#292A2E',
  line: '#42434A',
  lineStrong: '#77777E',
  text: '#FAFAFB',
  textDim: '#C9C8CB',
  textFaint: '#AAA9AF',
  blue: '#A8CDEC',
  blueSoft: '#282F3E',
  purple: '#C3B6D2',
  purpleSoft: '#342D3E',
  accent: '#FFC64A',
  accentPressed: '#E7A321',
  accentSoft: '#49381E',
  accentEdge: '#A86D22',
  onAccent: '#201405',
  /** Digits the player entered. */
  entry: '#BCDFFF',
  /** Conflicts and mistakes. Always paired with a marker, never colour alone. */
  warn: '#FFB0A8',
  warnSoft: '#4A2928',
  good: '#ACD5B6',
  cell: '#141416',
  cellAlternate: '#19191B',
  cellPeer: '#332E27',
  overlay: 'rgba(6, 6, 8, 0.88)',
};

export const gradients = {
  screen: 'linear-gradient(155deg, #191A1E 0%, #0A0B0D 38%, #101114 72%, #19191C 100%)',
  gold: 'linear-gradient(180deg, #FFE798 0%, #FFC845 49%, #F4A110 100%)',
  panel: 'linear-gradient(145deg, #303137 0%, #1E1F24 48%, #141416 100%)',
  selected: 'linear-gradient(135deg, #48371F 0%, #29251F 60%, #18181A 100%)',
};

/** Gameplay controls share a lit top edge and a darker lower edge. */
export const gameControlSurfaces = {
  key: {
    backgroundColor: '#232326',
    backgroundImage: 'linear-gradient(180deg, #393738 0%, #272628 21%, #1B1A1D 77%, #211B15 100%)',
    borderColor: '#6E5839', borderTopColor: '#AE8A55', borderBottomColor: '#47341F',
  },
  keyPressed: {
    backgroundColor: '#3B2C19',
    backgroundImage: 'linear-gradient(180deg, #523C20, #2A2118)',
    borderColor: '#B88943', borderTopColor: '#E2B672', borderBottomColor: '#755224',
  },
  keyQuiet: {
    backgroundColor: '#19191C',
    backgroundImage: 'linear-gradient(180deg, #242428, #171719)',
    borderColor: '#3F3B35', borderTopColor: '#56514A', borderBottomColor: '#303031',
  },
  tool: {
    backgroundColor: '#24262C',
    backgroundImage: 'linear-gradient(175deg, #363940, #24262C 57%, #1B1D22)',
    borderColor: '#494D55', borderTopColor: '#656975', borderBottomColor: '#32343D',
  },
  toolWarm: {
    backgroundColor: '#30271D',
    backgroundImage: 'linear-gradient(165deg, #4A3823, #2A241D 64%, #211D19)',
    borderColor: '#846637', borderTopColor: '#BA9254', borderBottomColor: '#53432B',
  },
  toolPressed: {
    backgroundColor: '#36333A',
    backgroundImage: 'linear-gradient(180deg, #494448, #24252A)',
    borderColor: '#7C6D62', borderTopColor: '#A69B92', borderBottomColor: '#544D48',
  },
  toolQuiet: {
    backgroundColor: '#1D1E22',
    backgroundImage: 'linear-gradient(180deg, #26282E, #191A1E)',
    borderColor: '#383A42', borderTopColor: '#474952', borderBottomColor: '#2A2C33',
  },
  active: {
    backgroundColor: colors.accent,
    backgroundImage: gradients.gold,
    borderColor: '#FFDF8B', borderTopColor: '#FFF2B9', borderBottomColor: '#AD6D25',
  },
} satisfies Record<string, ViewStyle>;

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
