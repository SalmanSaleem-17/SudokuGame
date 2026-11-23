import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BOARD_THEMES, isThemeAvailable, type BoardTheme } from '../game/settings';
import { appStore, updateSettings, watchAdToUnlockTheme } from '../state/app';
import { useStore } from '../state/store';
import { promptForAd } from '../ui/adPrompt';
import { BOARD_PALETTES, BOARD_THEME_NAMES } from '../ui/boardTheme';
import { Screen } from '../ui/controls';
import { colors, gradients, radius, spacing, type } from '../ui/theme';

/** A 3 × 3 corner of a board: givens, an entry, the selected cell and a note. */
const PREVIEW = [
  { kind: 'given', text: '5' }, { kind: 'empty', text: '' }, { kind: 'entry', text: '2' },
  { kind: 'peer', text: '' }, { kind: 'selected', text: '8' }, { kind: 'given', text: '1' },
  { kind: 'entry', text: '7' }, { kind: 'note', text: '3' }, { kind: 'given', text: '9' },
] as const;

export default function BoardThemesScreen() {
  const current = useStore(appStore, (s) => s.settings.boardTheme);
  const unlocked = useStore(appStore, (s) => s.unlockedThemes);
  const canRequestAds = useStore(appStore, (s) => s.ads.canRequestAds);
  const adIdle = useStore(appStore, (s) => s.reward.phase === 'idle');

  const choose = (theme: BoardTheme) => {
    if (isThemeAvailable(theme, unlocked, current)) {
      updateSettings({ boardTheme: theme });
      return;
    }
    const name = BOARD_THEME_NAMES[theme];
    if (!adIdle) return;
    if (!canRequestAds) {
      Alert.alert(`${name} is locked`, 'This theme opens with one optional ad, and ads are unavailable right now. Try again later.');
      return;
    }
    // The ad starts only if the player chooses it here.
    promptForAd({
      title: `Unlock ${name}?`,
      message: 'Watch one ad to unlock this board theme. It stays unlocked on this device.',
      watch: () => watchAdToUnlockTheme(theme),
      lost: 'the theme is still locked',
    });
  };

  return (
    <Screen title="Board Themes">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={type.dim}>
          Pick how the puzzle board looks. Your choice applies to every board in the game. Themes with a lock open after one optional ad.
        </Text>
        <View style={styles.grid} accessibilityLabel="Board theme">
          {BOARD_THEMES.map((theme) => (
            <ThemeTile key={theme} theme={theme} selected={theme === current}
              locked={!isThemeAvailable(theme, unlocked, current)} onPress={() => choose(theme)} />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

function ThemeTile({ theme, selected, locked, onPress }: { theme: BoardTheme; selected: boolean; locked: boolean; onPress: () => void }) {
  const palette = BOARD_PALETTES[theme];
  const name = BOARD_THEME_NAMES[theme];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={locked ? 'button' : 'radio'}
      accessibilityLabel={locked ? `${name}, locked` : name}
      accessibilityHint={locked ? 'Offers one optional ad to unlock this theme' : undefined}
      accessibilityState={locked ? undefined : { checked: selected }}
      style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && styles.pressed]}>
      <View style={[styles.preview, { backgroundColor: palette.frame, borderColor: palette.frame }]}>
        {PREVIEW.map(({ kind, text }, index) => {
          const background = kind === 'selected' ? palette.selected : kind === 'peer' ? palette.peer
            : index % 2 === 0 ? palette.cell : palette.alternate;
          const color = kind === 'selected' ? palette.selectedText : kind === 'entry' ? palette.entry
            : kind === 'note' ? palette.notes : palette.text;
          return (
            <View key={index} style={[styles.cell, { backgroundColor: background, borderColor: palette.line }]}>
              <Text
                allowFontScaling={false}
                style={[styles.digit, { color }, kind === 'given' && styles.given, kind === 'note' && styles.note]}>
                {text}
              </Text>
            </View>
          );
        })}
        {locked && (
          <View style={styles.lock}>
            <Ionicons name="lock-closed" size={13} color={colors.onAccent} />
          </View>
        )}
      </View>
      <View style={styles.caption}>
        <Text style={[styles.name, selected && styles.nameSelected]} numberOfLines={2}>{name}</Text>
        {selected && <Ionicons name="checkmark-circle" size={15} color={colors.accent} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    // Three tiles per row with two gaps between them.
    flexBasis: '29%', flexGrow: 1, maxWidth: '31.5%', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, backgroundImage: gradients.panel,
  },
  tileSelected: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentSoft, backgroundImage: gradients.selected },
  pressed: { opacity: 0.78 },
  preview: {
    width: '100%', aspectRatio: 1, flexDirection: 'row', flexWrap: 'wrap',
    borderWidth: 2, borderRadius: 6, overflow: 'hidden',
  },
  cell: { width: '33.333%', height: '33.333%', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  digit: { fontSize: 15, fontWeight: '600', includeFontPadding: false, fontVariant: ['tabular-nums'] },
  given: { fontWeight: '800' },
  note: { fontSize: 9, alignSelf: 'flex-start', marginLeft: 3 },
  // The preview stays fully visible so a locked theme can still be judged before unlocking.
  lock: {
    position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
  },
  caption: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  name: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  nameSelected: { color: colors.accent },
});
