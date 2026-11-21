import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { appStore, showPrivacyOptions, updateSettings } from '../state/app';
import { useStore } from '../state/store';
import { Card, Screen, SectionLabel, ToggleRow } from '../ui/controls';
import { colors, spacing, type } from '../ui/theme';

export default function SettingsScreen() {
  const settings = useStore(appStore, (s) => s.settings);
  const ads = useStore(appStore, (s) => s.ads);
  const credits = useStore(appStore, (s) => s.credits);

  return (
    <Screen title="Settings">
      <ScrollView contentContainerStyle={styles.content}>
        <SectionLabel>Game</SectionLabel>
        <Card>
          <ToggleRow
            label="Timer"
            description="Show elapsed time while you play."
            value={settings.timer}
            onChange={(timer) => updateSettings({ timer })}
          />
          <Divider />
          <ToggleRow
            label="Mistake feedback"
            description="Mark entries that don't match the solution. Duplicates in a row, column or box are always marked."
            value={settings.mistakeFeedback}
            onChange={(mistakeFeedback) => updateSettings({ mistakeFeedback })}
          />
          <Divider />
          <ToggleRow
            label="Smart notes"
            description="Placing a digit removes it from notes in the same row, column and box."
            value={settings.smartNotes}
            onChange={(smartNotes) => updateSettings({ smartNotes })}
          />
          <Divider />
          <ToggleRow
            label="Number-first entry"
            description="Pick a digit, then tap cells to place it."
            value={settings.numberFirst}
            onChange={(numberFirst) => updateSettings({ numberFirst })}
          />
        </Card>

        <SectionLabel>Feel</SectionLabel>
        <Card>
          <ToggleRow label="Haptics" description="Light vibration on entries." value={settings.haptics} onChange={(haptics) => updateSettings({ haptics })} />
          <Divider />
          <ToggleRow
            label="Reduce motion"
            description="Turn off transitions and animations. The system setting is also respected."
            value={settings.reducedMotion}
            onChange={(reducedMotion) => updateSettings({ reducedMotion })}
          />
        </Card>

        <SectionLabel>Hints and ads</SectionLabel>
        <Card>
          <View style={styles.info}>
            <Text style={type.body}>Hint credits: {credits}</Text>
            <Text style={type.dim}>
              Each puzzle has one free hint. Watching an optional ad from the hint panel adds 2 credits. Credits are stored
              only on this device: they are not backed up, cannot be transferred, and are lost if the app is uninstalled or
              its data is cleared.
            </Text>
          </View>
          {ads.privacyOptionsRequired && (
            <>
              <Divider />
              <Pressable
                onPress={() => void showPrivacyOptions()}
                accessibilityRole="button"
                accessibilityLabel="Ad privacy options"
                style={({ pressed }) => [styles.link, pressed && { backgroundColor: colors.surfaceHigh }]}>
                <View style={styles.linkText}>
                  <Text style={type.body}>Ad privacy options</Text>
                  <Text style={type.dim}>Review or change your ad consent choices.</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
              </Pressable>
            </>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl, maxWidth: 520, width: '100%', alignSelf: 'center' },
  divider: { height: 1, backgroundColor: colors.line, marginLeft: spacing.lg },
  info: { padding: spacing.lg, gap: spacing.xs },
  link: { minHeight: 60, flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  linkText: { flex: 1, gap: 2 },
});
