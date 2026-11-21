import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { appStore, initApp } from '../state/app';
import { useStore } from '../state/store';
import { colors, spacing, type, useReducedMotion } from '../ui/theme';

export default function RootLayout() {
  const ready = useStore(appStore, (s) => s.ready);
  const loadError = useStore(appStore, (s) => s.loadError);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    // Local data only. Consent and ads start afterwards, in the background.
    void initApp();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {!ready ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Text style={type.heading}>Saved data could not be opened</Text>
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
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.xl },
  message: { marginTop: spacing.sm, textAlign: 'center' },
});
