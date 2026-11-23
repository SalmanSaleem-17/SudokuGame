import { isRunningInExpoGo } from 'expo';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { syncReminder } from '../platform/reminders';
import { appStore, initApp } from '../state/app';
import { useStore } from '../state/store';
import { StartupSplash } from '../ui/StartupSplash';
import { colors, spacing, type, useReducedMotion } from '../ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const ready = useStore(appStore, (s) => s.ready);
  const loadError = useStore(appStore, (s) => s.loadError);
  const reducedMotion = useReducedMotion();
  const splashHidden = useRef(false);

  const hideSplash = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    if (!isRunningInExpoGo()) {
      SplashScreen.setOptions({ duration: reducedMotion ? 0 : 160, fade: !reducedMotion });
    }
    SplashScreen.hide();
  }, [reducedMotion]);

  useEffect(() => {
    // Local data only. Consent and ads start afterwards, in the background.
    void initApp().then(() => {
      // Re-create the daily reminder after an app update or a device restart.
      const { reminder, reminderHour } = appStore.getState().settings;
      if (reminder) void syncReminder(true, reminderHour);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!ready ? (
        <StartupSplash onBrandReady={hideSplash} reducedMotion={reducedMotion} />
      ) : (
        <View style={styles.root} onLayout={hideSplash}>
          {loadError ? (
            <View style={styles.center}>
              <Text style={[type.heading, styles.errorTitle]}>Saved data could not be opened</Text>
              <Text style={[type.dim, styles.message]}>{loadError}</Text>
            </View>
          ) : (
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: reducedMotion ? 'none' : 'fade',
              }}
            />
          )}
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.xl },
  errorTitle: { textAlign: 'center' },
  message: { marginTop: spacing.sm, textAlign: 'center' },
});
