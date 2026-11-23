import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SessionSlot } from '../game/session';
import { appStore, clock } from '../state/app';
import { formatTime } from '../state/clock';

/** True while the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}

/** True while this screen is the one on top of the navigation stack. */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}

/** Game time label. Ticks on its own so the board doesn't re-render with it. */
export function useClockLabel(
  slot: SessionSlot,
  sessionId: string,
  savedMs: number,
  timeLimitMs: number | null,
  ticking: boolean,
): string {
  const read = useCallback(() => {
    const elapsed = ticking && clock.matches(slot, sessionId) ? clock.read() : savedMs;
    if (timeLimitMs === null) return formatTime(elapsed).padStart(5, '0');
    const remaining = Math.max(0, timeLimitMs - elapsed);
    return formatTime(Math.ceil(remaining / 1000) * 1000).padStart(5, '0');
  }, [slot, sessionId, savedMs, timeLimitMs, ticking]);
  const [label, setLabel] = useState(read);
  useEffect(() => {
    const tick = () => setLabel(read());
    tick();
    if (!ticking) return;
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [read, ticking]);
  return label;
}

/** Largest square board that fits beside the given vertical chrome. */
export function useBoardSize(reservedHeight: number, horizontalGutter = 8): number {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const byWidth = width - insets.left - insets.right - horizontalGutter * 2;
  const byHeight = height - insets.top - insets.bottom - reservedHeight;
  return Math.floor(Math.min(byWidth, 560, Math.max(252, byHeight)));
}

type HapticKind = 'tap' | 'warn' | 'success';

/** Fire-and-forget haptics, honouring the setting. Never awaited on the input path. */
export function haptic(kind: HapticKind) {
  if (!appStore.getState().settings.haptics) return;
  const run =
    kind === 'tap'
      ? Haptics.selectionAsync()
      : Haptics.notificationAsync(
          kind === 'warn' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
        );
  run.catch(() => undefined);
}
