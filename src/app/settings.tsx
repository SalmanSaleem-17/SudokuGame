import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useRef, useState } from 'react';
import { type LayoutChangeEvent, Linking, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from 'react-native';

import { CREDITS_PER_REWARD } from '../ads/rewardController';
import { BOARD_THEMES, type BoardTheme } from '../game/settings';
import { appStore, showPrivacyOptions, updateSettings } from '../state/app';
import { useStore } from '../state/store';
import { BOARD_PALETTES, BOARD_THEME_NAMES } from '../ui/boardTheme';
import { Card, type IconName, Screen, ToggleRow } from '../ui/controls';
import { colors, radius, spacing, TOUCH, type } from '../ui/theme';

const PRIVACY_URL = 'https://salmansaleem.dev/privacy/sudoku-studio';
const TERMS_URL = 'https://salmansaleem.dev/terms/sudoku-studio';

const palettes = {
  gameplay: { tint: '#C0CEDD', fill: '#1C2128', border: '#3A444E' },
  comfort: { tint: '#B4CCBF', fill: '#1C2522', border: '#3C4B43' },
  appearance: { tint: '#E8CA96', fill: '#252019', border: '#5B4B32' },
  about: { tint: '#D6D3CE', fill: '#222123', border: '#46413F' },
};

function openUrl(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

export default function SettingsScreen() {
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const openAbout = section === 'about';
  const scroll = useRef<ScrollViewInstance>(null);
  const aboutOffset = useRef<number | null>(null);
  const settings = useStore(appStore, (s) => s.settings);
  const privacyOptionsRequired = useStore(appStore, (s) => s.ads.privacyOptionsRequired);
  const credits = useStore(appStore, (s) => s.credits);

  const scrollToAbout = () => {
    const y = aboutOffset.current;
    if (y !== null) scroll.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: false });
  };
  const layoutAbout = (event: LayoutChangeEvent) => {
    aboutOffset.current = event.nativeEvent.layout.y;
    scrollToAbout();
  };

  return (
    <Screen title="Settings">
      <ScrollView
        key={openAbout ? 'about' : 'settings'}
        ref={scroll}
        contentContainerStyle={styles.content}
        onContentSizeChange={openAbout ? scrollToAbout : undefined}>
        <SettingsGroup title="Gameplay" palette={palettes.gameplay}>
          <ToggleRow label="Show elapsed timer" icon="time-outline" tint={palettes.gameplay.tint}
            value={settings.timer} onChange={(timer) => updateSettings({ timer })} />
          <Divider />
          <ToggleRow label="Mistake feedback" icon="shield-checkmark-outline" tint={palettes.gameplay.tint}
            accessibilityHint="Mark entries that differ from the solution. Conflicts and mistake limits still apply."
            value={settings.mistakeFeedback} onChange={(mistakeFeedback) => updateSettings({ mistakeFeedback })} />
          <Divider />
          <ToggleRow label="Smart notes" description="Clear matching notes" icon="pencil-outline" tint={palettes.gameplay.tint}
            accessibilityHint="Placing a digit clears that digit from notes in the same row, column, and box."
            value={settings.smartNotes} onChange={(smartNotes) => updateSettings({ smartNotes })} />
          <Divider />
          <ToggleRow label="Pick number first" icon="keypad-outline" tint={palettes.gameplay.tint}
            accessibilityHint="Choose a number, then tap a cell to place it."
            value={settings.numberFirst} onChange={(numberFirst) => updateSettings({ numberFirst })} />
        </SettingsGroup>

        <SettingsGroup title="Comfort" palette={palettes.comfort}>
          <ToggleRow label="Vibration" icon="phone-portrait-outline" tint={palettes.comfort.tint}
            value={settings.haptics} onChange={(haptics) => updateSettings({ haptics })} />
          <Divider />
          <ToggleRow label="Reduce motion" icon="contrast-outline" tint={palettes.comfort.tint}
            accessibilityHint="Reduce animations and transitions. Your system setting also applies."
            value={settings.reducedMotion} onChange={(reducedMotion) => updateSettings({ reducedMotion })} />
        </SettingsGroup>

        <SettingsGroup title="Board theme" palette={palettes.appearance}>
          {BOARD_THEMES.map((theme, index) => (
            <View key={theme}>
              {index > 0 && <Divider />}
              <ThemeOption theme={theme} selected={settings.boardTheme === theme} />
            </View>
          ))}
        </SettingsGroup>

        <HintCredits credits={credits} />

        <SettingsGroup title="About and privacy" palette={palettes.about} onLayout={openAbout ? layoutAbout : undefined}>
          <ActionRow label="How to Play" icon="book-outline" onPress={() => router.push('/how-to-play')} />
          <Divider />
          {privacyOptionsRequired && (
            <>
              <ActionRow label="Ad privacy choices" icon="options-outline" onPress={() => void showPrivacyOptions()} />
              <Divider />
            </>
          )}
          <ActionRow label="Privacy policy" icon="lock-closed-outline" external onPress={() => openUrl(PRIVACY_URL)} />
          <Divider />
          <ActionRow label="Terms of service" icon="document-text-outline" external onPress={() => openUrl(TERMS_URL)} />
        </SettingsGroup>
      </ScrollView>
    </Screen>
  );
}

function ThemeOption({ theme, selected }: { theme: BoardTheme; selected: boolean }) {
  const palette = BOARD_PALETTES[theme];
  return (
    <Pressable
      onPress={() => updateSettings({ boardTheme: theme })}
      accessibilityRole="radio"
      accessibilityLabel={BOARD_THEME_NAMES[theme]}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <View style={[styles.themeSwatch, { borderColor: palette.frame, backgroundColor: palette.line }]}>
        {[palette.cell, palette.selected, palette.alternate, palette.cell].map((color, index) => (
          <View key={index} style={[styles.themeSquare, { backgroundColor: color }]} />
        ))}
      </View>
      <Text style={[styles.actionLabel, styles.rowCopy]}>{BOARD_THEME_NAMES[theme]}</Text>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.accent : colors.textFaint} />
    </Pressable>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function SettingsGroup({ title, palette, children, onLayout }: {
  title: string;
  palette: { tint: string; fill: string; border: string };
  children: ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  return (
    <View style={styles.group} onLayout={onLayout}>
      <Text style={[styles.groupTitle, { color: palette.tint }]} accessibilityRole="header">{title}</Text>
      <Card style={{ backgroundColor: palette.fill, borderColor: palette.border }}>{children}</Card>
    </View>
  );
}

function HintCredits({ credits }: { credits: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card style={styles.creditCard}>
      <Pressable
        onPress={() => setExpanded((previous) => !previous)}
        accessibilityRole="button"
        accessibilityLabel={`${credits} hint ${credits === 1 ? 'credit' : 'credits'}. One free hint per puzzle.`}
        accessibilityHint="Shows how credits work"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [styles.creditAction, pressed && styles.pressed]}>
        <View style={styles.creditIcon}>
          <Ionicons name="bulb" size={22} color={colors.onAccent} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.actionLabel}>Hint credits</Text>
          <Text style={styles.creditSubtitle}>1 free hint per puzzle</Text>
        </View>
        <Text style={styles.creditCount}>{credits}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={colors.accent} />
      </Pressable>
      {expanded && (
        <View style={styles.creditDetails}>
          <Text style={type.dim}>Finish an optional ad in the hint panel to earn {CREDITS_PER_REWARD} credits.</Text>
          <Text style={type.dim}>Credits stay on this device. Clearing app data or uninstalling removes them.</Text>
        </View>
      )}
    </Card>
  );
}

function ActionRow({ label, icon, external = false, onPress }: {
  label: string;
  icon: IconName;
  external?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={external ? 'Opens in your browser' : undefined}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={19} color={palettes.about.tint} />
      </View>
      <Text style={[styles.actionLabel, styles.rowCopy]}>{label}</Text>
      <Ionicons name={external ? 'open-outline' : 'chevron-forward'} size={17} color={palettes.about.tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  group: { gap: spacing.sm },
  groupTitle: { ...type.label, fontSize: 14, fontWeight: '800', paddingHorizontal: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(233, 234, 235, 0.16)', marginHorizontal: spacing.md },
  action: {
    minHeight: TOUCH + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.23)',
  },
  themeSwatch: {
    width: 33, height: 33, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    alignContent: 'space-between', borderWidth: 1, borderRadius: 5, overflow: 'hidden',
  },
  themeSquare: { width: '48%', height: '48%' },
  actionLabel: { ...type.body, fontWeight: '700' },
  rowCopy: { flex: 1 },
  pressed: { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  creditCard: {
    backgroundColor: '#29241C',
    backgroundImage: 'linear-gradient(130deg, #332B20 0%, #28231C 64%, #1C1B19 100%)',
    borderColor: '#695637',
  },
  creditAction: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  creditIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    width: 39,
    height: 39,
    borderRadius: radius.md,
    marginRight: spacing.xs,
  },
  creditSubtitle: { ...type.dim, fontSize: 12, lineHeight: 17 },
  creditCount: {
    color: colors.accent,
    backgroundColor: '#191713',
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    fontSize: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  creditDetails: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
});
