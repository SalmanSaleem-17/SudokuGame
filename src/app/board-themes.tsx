import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BOARD_THEMES, type BoardTheme } from '../game/settings';
import { appStore, updateSettings } from '../state/app';
import { useStore } from '../state/store';
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

  return (
    <Screen title="Board Themes">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={type.dim}>Pick how the puzzle board looks. Your choice applies to every board in the game.</Text>
        <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Board theme">
          {BOARD_THEMES.map((theme) => (
            <ThemeTile key={theme} theme={theme} selected={theme === current} />
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

function ThemeTile({ theme, selected }: { theme: BoardTheme; selected: boolean }) {
  const palette = BOARD_PALETTES[theme];
  return (
    <Pressable
      onPress={() => updateSettings({ boardTheme: theme })}
      accessibilityRole="radio"
      accessibilityLabel={BOARD_THEME_NAMES[theme]}
      accessibilityState={{ checked: selected }}
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
      </View>
      <View style={styles.caption}>
        <Text style={[styles.name, selected && styles.nameSelected]} numberOfLines={2}>{BOARD_THEME_NAMES[theme]}</Text>
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
  caption: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  name: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  nameSelected: { color: colors.accent },
});
