import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ENABLED_DIFFICULTIES } from '../data/pool';
import { DIFFICULTY_NAMES, Difficulty } from '../engine/grader';
import { miniClassicStatus } from '../game/miniClassic';
import { PLAY_BOARD_SIZES, miniModeForDifficulty, type MiniMode } from '../game/playFormat';
import { DEFAULT_SESSION_RULES, getSessionFailure, type SessionRules } from '../game/session';
import { appStore, prepareChallenge, startClassic, startMiniClassic } from '../state/app';
import { useStore } from '../state/store';
import { Button, Screen, type IconName } from '../ui/controls';
import { colors, gradients, radius, spacing, TOUCH, type } from '../ui/theme';

const DIFFICULTIES: Record<Difficulty, { detail: string; tint: string; icon: IconName }> = {
  easy: { detail: 'Find the only spot for a number.', tint: colors.good, icon: 'leaf' },
  medium: { detail: 'Find the only number that fits or the only spot left.', tint: colors.textDim, icon: 'star' },
  hard: { detail: 'Narrow the options and find pairs.', tint: colors.blue, icon: 'diamond' },
  expert: { detail: 'Use triples and X-Wings.', tint: colors.text, icon: 'ribbon' },
};

const TIMERS = [0, 5, 10, 15] as const;
const MINI_DETAILS = { 'mini-4': 'Fill a 4 × 4 board using digits 1–4.', 'mini-6': 'Fill a 6 × 6 board using digits 1–6.' };
const MISTAKE_OPTIONS = [
  { value: 'off', label: 'Off', hint: 'Turn off the mistake counter.' },
  { value: 3, label: '3', hint: 'The game ends at 3 mistakes.' },
  { value: 5, label: '5', hint: 'The game ends at 5 mistakes.' },
  { value: 'unlimited', label: 'Unlimited', hint: 'Count mistakes without a limit.' },
] as const;

export default function NewGameScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const challengeSetup = mode === 'challenge';
  const current = useStore(appStore, (s) => s.sessions.classic);
  const currentMini = useStore(appStore, (s) => s.miniClassic);
  const [difficulty, setDifficulty] = useState<Difficulty>(ENABLED_DIFFICULTIES[0]);
  const [rules, setRules] = useState<SessionRules>(DEFAULT_SESSION_RULES);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startInProgress = useRef(false);
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = width < 360 || fontScale > 1.2;
  const miniMode = challengeSetup ? null : miniModeForDifficulty(difficulty);
  const pendingMini = miniMode && currentMini && miniClassicStatus(currentMini) === 'solved' ? currentMini : null;

  const begin = () => {
    startClassic(difficulty, rules);
    router.replace({ pathname: '/game', params: { slot: 'classic' } });
  };

  const openMini = (mode: MiniMode) => router.replace({ pathname: '/alternate', params: { mode, play: 'classic' } });

  const beginMini = async (mode: MiniMode) => {
    if (startInProgress.current) return;
    startInProgress.current = true;
    setStarting(true);
    setError(null);
    try {
      await startMiniClassic(mode, rules);
      openMini(mode);
    } catch {
      setError('Could not save the new puzzle. Try again.');
    } finally {
      startInProgress.current = false;
      setStarting(false);
    }
  };

  const confirmStart = () => {
    if (challengeSetup) {
      const challenge = prepareChallenge(difficulty, rules);
      router.dismissTo({ pathname: '/challenge', params: { code: challenge.code } });
      return;
    }
    if (pendingMini) {
      openMini(pendingMini.mode);
      return;
    }
    if (miniMode) {
      const start = () => { void beginMini(miniMode); };
      if (currentMini?.progress.undo.length && miniClassicStatus(currentMini) === 'playing') {
        Alert.alert('Start a new mini puzzle?', 'Your current mini puzzle and its progress will be replaced.', [
          { text: 'Keep playing', style: 'cancel' },
          { text: 'Start new', style: 'destructive', onPress: start },
        ]);
      } else start();
      return;
    }
    if (!current || current.completed || getSessionFailure(current) || !(current.undo.length || current.redo?.length)) {
      begin();
      return;
    }
    Alert.alert('Start a new game?', 'Your current puzzle and its progress will be replaced.', [
      { text: 'Keep playing', style: 'cancel' },
      { text: 'Start new', style: 'destructive', onPress: begin },
    ]);
  };

  return (
    <Screen title={challengeSetup ? 'Challenge Setup' : 'Game Setup'}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.group}>
          <GroupHeading icon="stats-chart-outline" label="Difficulty" />
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="Difficulty">
            {ENABLED_DIFFICULTIES.map((level) => {
              const mini = challengeSetup ? null : miniModeForDifficulty(level);
              const size = PLAY_BOARD_SIZES[level];
              return (
                <Option
                  key={level}
                  label={DIFFICULTY_NAMES[level]}
                  detail={challengeSetup ? undefined : `${size} × ${size}`}
                  hint={mini ? MINI_DETAILS[mini] : DIFFICULTIES[level].detail}
                  icon={DIFFICULTIES[level].icon}
                  tint={DIFFICULTIES[level].tint}
                  twoColumns={twoColumns}
                  selected={level === difficulty}
                  onPress={() => setDifficulty(level)}
                />
              );
            })}
          </View>
          <Text style={styles.explanation}>{miniMode ? MINI_DETAILS[miniMode] : DIFFICULTIES[difficulty].detail}</Text>
        </View>

        <View style={[styles.group, styles.ruleGroup]}>
          <GroupHeading icon="timer-outline" label="Time limit" />
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="Time limit">
            {TIMERS.map((minutes) => (
              <Option
                key={minutes}
                label={minutes ? `${minutes} min` : 'No limit'}
                hint={minutes ? `Finish within ${minutes} minutes.` : 'Elapsed timer follows your Settings preference.'}
                twoColumns={twoColumns}
                selected={rules.timerMinutes === minutes}
                onPress={() => setRules((previous) => ({ ...previous, timerMinutes: minutes }))}
              />
            ))}
          </View>
          <Text style={styles.explanation}>
            {rules.timerMinutes === 0 ? 'Elapsed timer follows Settings.' : 'The game ends when time runs out.'}
          </Text>
        </View>

        <View style={[styles.group, styles.ruleGroup]}>
          <GroupHeading icon="warning-outline" label="Mistakes" />
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="Mistakes">
            {MISTAKE_OPTIONS.map(({ value, label, hint }) => (
              <Option
                key={value}
                label={label}
                hint={hint}
                twoColumns={twoColumns}
                selected={rules.mistakes === value}
                onPress={() => setRules((previous) => ({ ...previous, mistakes: value }))}
              />
            ))}
          </View>
          <Text style={styles.explanation}>
            {MISTAKE_OPTIONS.find(({ value }) => value === rules.mistakes)?.hint}
          </Text>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        <Button
          label={challengeSetup ? 'Create challenge' : pendingMini ? 'Save finished puzzle' : starting ? 'Starting…' : 'Start Game'}
          icon={challengeSetup ? 'link-outline' : 'play'}
          variant="primary"
          style={styles.start}
          onPress={confirmStart}
          disabled={starting}
        />
      </View>
    </Screen>
  );
}

function GroupHeading({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.groupHeading}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text accessibilityRole="header" style={styles.groupLabel}>{label}</Text>
    </View>
  );
}

function Option({ label, detail, hint, icon, tint, selected, twoColumns, onPress }: {
  label: string;
  detail?: string;
  hint?: string;
  icon?: IconName;
  tint?: string;
  selected: boolean;
  twoColumns: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityHint={hint}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        icon && styles.optionWithIcon,
        twoColumns && styles.optionWide,
        selected && styles.optionSelected,
        pressed && styles.pressed,
      ]}>
      {selected && <Ionicons name="checkmark-circle" size={13} color={colors.accent} style={styles.check} />}
      {icon && <Ionicons name={icon} size={24} color={selected ? colors.accent : tint ?? colors.textDim} />}
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{label}</Text>
      {detail && <Text style={styles.optionDetail}>{detail}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg },
  group: { gap: spacing.sm },
  ruleGroup: { paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  groupHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  groupLabel: { ...type.heading, fontSize: 18, flexShrink: 1 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    flexGrow: 1,
    flexBasis: '22%',
    minHeight: TOUCH + 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  optionWithIcon: { minHeight: TOUCH + 21, backgroundImage: gradients.panel },
  optionWide: { flexBasis: '45%' },
  optionSelected: { backgroundColor: colors.accentSoft, backgroundImage: gradients.selected, borderColor: colors.accent },
  optionLabel: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  optionLabelSelected: { color: colors.accent },
  optionDetail: { ...type.dim, fontSize: 12, lineHeight: 15, textAlign: 'center' },
  check: { position: 'absolute', top: 4, end: 4 },
  explanation: { ...type.dim, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.74 },
  footer: {
    width: '100%', maxWidth: 520, alignSelf: 'center', borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  start: { minHeight: 54 },
  error: { ...type.dim, color: colors.warn, marginBottom: spacing.sm },
});
