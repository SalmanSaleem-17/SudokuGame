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

/** Elapsed time label. Ticks on its own so nothing else re-renders with it. */
export function useClockLabel(slot: SessionSlot, savedMs: number): string {
  // Until the clock is pointed at this session, show the saved time.
  const read = useCallback(() => formatTime(clock.slot === slot ? clock.read() : savedMs), [slot, savedMs]);
  const [label, setLabel] = useState(read);
  useEffect(() => {
    const tick = () => setLabel(read());
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [read]);
  return label;
}

/** Largest square board that fits beside the given vertical chrome. */
export function useBoardSize(reservedHeight: number): number {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const byWidth = width - insets.left - insets.right - 16;
  const byHeight = height - insets.top - insets.bottom - reservedHeight;
  return Math.floor(Math.max(252, Math.min(byWidth, byHeight, 560)));
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
