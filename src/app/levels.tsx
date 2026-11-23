import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DIFFICULTIES, DIFFICULTY_NAMES, type Difficulty } from '../engine/grader';
import {
  LEVEL_BOARD_SIZES, LEVEL_COUNT, LEVEL_REWARD_INTERVAL, LEVEL_TIMES, MAX_EXTRA_MISTAKES, formatLimit, isLevelUnlocked, levelRules, nextLevel, totalStars,
} from '../game/levels';
import { miniClassicStatus } from '../game/miniClassic';
import { miniModeForDifficulty } from '../game/playFormat';
import { getSessionFailure } from '../game/session';
import { appStore, openLevel } from '../state/app';
import { useStore } from '../state/store';
import { Button, Card, Screen, type IconName } from '../ui/controls';
import { colors, gradients, radius, spacing, TOUCH, type } from '../ui/theme';

const TRACKS: Record<Difficulty, { icon: IconName; tint: string }> = {
  easy: { icon: 'leaf', tint: colors.good },
  medium: { icon: 'star', tint: colors.textDim },
  hard: { icon: 'diamond', tint: colors.blue },
  expert: { icon: 'ribbon', tint: colors.text },
};

const isDifficulty = (value: unknown): value is Difficulty => DIFFICULTIES.some((difficulty) => difficulty === value);

export default function LevelsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ difficulty?: string }>();
  const levelStars = useStore(appStore, (s) => s.levelStars);
  const board = useStore(appStore, (s) => s.sessions.level);
  const mini = useStore(appStore, (s) => s.miniLevel);
  const [starting, setStarting] = useState(false);
  // Hard and Expert share one saved attempt; Easy and Medium share another.
  const boardLevel = board && !board.completed && !getSessionFailure(board) && board.level
    ? { difficulty: board.difficulty, number: board.level.number, started: board.undo.length > 0 } : null;
  const miniLevel = mini?.level && miniClassicStatus(mini) === 'playing'
    ? { difficulty: mini.difficulty as Difficulty, number: mini.level.number, started: mini.progress.undo.length > 0 } : null;

  const [difficulty, setDifficulty] = useState<Difficulty>(
    isDifficulty(params.difficulty) ? params.difficulty : miniLevel?.difficulty ?? boardLevel?.difficulty ?? 'easy',
  );
  const inProgress = miniModeForDifficulty(difficulty) ? miniLevel : boardLevel;
  const stars = levelStars[difficulty];
  const upNext = nextLevel(stars);
  const [picked, setPicked] = useState<{ difficulty: Difficulty; number: number } | null>(null);
  // Until the player picks a level, the next one to clear is selected.
  const number = picked?.difficulty === difficulty ? picked.number
    : inProgress?.difficulty === difficulty ? inProgress.number : upNext ?? LEVEL_COUNT;
  const rules = levelRules(difficulty, number);
  const times = LEVEL_TIMES[difficulty];
  const size = LEVEL_BOARD_SIZES[difficulty];
  const resuming = inProgress?.difficulty === difficulty && inProgress.number === number;
  const reward = number % LEVEL_REWARD_INTERVAL === 0 && stars[number - 1] === 0;

  const play = () => {
    if (starting) return;
    setStarting(true);
    void openLevel(difficulty, number)
      .then((route) => { if (route) router.push(route); }, () => undefined)
      .finally(() => setStarting(false));
  };
  const confirmPlay = () => {
    if (!inProgress || resuming || !inProgress.started) return play();
    Alert.alert('Start this level?', `Your progress in Level ${inProgress.number} (${DIFFICULTY_NAMES[inProgress.difficulty]}) will be replaced.`, [
      { text: 'Keep playing', style: 'cancel' },
      { text: 'Start', style: 'destructive', onPress: play },
    ]);
  };

  return (
    <Screen title="Levels">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.tracks} accessibilityRole="radiogroup" accessibilityLabel="Difficulty">
          {DIFFICULTIES.map((track) => {
            const selected = track === difficulty;
            const earned = totalStars(levelStars[track]);
            return (
              <Pressable
                key={track}
                accessibilityRole="radio"
                accessibilityLabel={`${DIFFICULTY_NAMES[track]}, ${earned} of ${LEVEL_COUNT * 3} stars`}
                accessibilityState={{ checked: selected }}
                onPress={() => setDifficulty(track)}
                style={({ pressed }) => [styles.track, selected && styles.trackSelected, pressed && styles.pressed]}>
                <Ionicons name={TRACKS[track].icon} size={22} color={selected ? colors.accent : TRACKS[track].tint} />
                <Text style={[styles.trackLabel, selected && styles.trackLabelSelected]}>{DIFFICULTY_NAMES[track]}</Text>
                <Text style={styles.trackStars}>★ {earned}</Text>
              </Pressable>
            );
          })}
        </View>

        <Card style={styles.summary}>
          <View style={styles.summaryIcon}>
            <Ionicons name="trending-up" size={26} color={colors.onAccent} />
          </View>
          <View style={styles.summaryText}>
            <Text style={type.heading} accessibilityRole="header">
              {stars.filter((earned) => earned > 0).length} of {LEVEL_COUNT} cleared
            </Text>
            <Text style={type.dim}>
              {DIFFICULTY_NAMES[difficulty]} levels are played on a {size} × {size} board. Solve faster for more stars.
            </Text>
          </View>
        </Card>

        <View style={styles.grid}>
          {stars.map((earned, index) => {
            const level = index + 1;
            const unlocked = isLevelUnlocked(stars, level);
            const selected = level === number;
            const current = unlocked && earned === 0;
            const status = !unlocked ? 'locked' : earned > 0 ? `${earned} of 3 stars` : 'not cleared yet';
            return (
              <Pressable
                key={level}
                disabled={!unlocked}
                accessibilityRole="radio"
                accessibilityLabel={`Level ${level}, ${status}`}
                accessibilityState={{ checked: selected, disabled: !unlocked }}
                onPress={() => setPicked({ difficulty, number: level })}
                style={({ pressed }) => [
                  styles.tile,
                  current && styles.tileCurrent,
                  selected && styles.tileSelected,
                  !unlocked && styles.tileLocked,
                  pressed && styles.pressed,
                ]}>
                {unlocked ? (
                  <>
                    <Text style={[styles.tileNumber, selected && styles.tileNumberSelected]}>{level}</Text>
                    <View style={styles.tileStars}>
                      {[1, 2, 3].map((star) => (
                        <Ionicons key={star} name={star <= earned ? 'star' : 'star-outline'} size={10}
                          color={star <= earned ? colors.accent : colors.lineStrong} />
                      ))}
                    </View>
                  </>
                ) : (
                  <Ionicons name="lock-closed" size={17} color={colors.lineStrong} />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.rules}>
          <Text style={styles.rulesTitle} accessibilityRole="header">
            Level {number} · {DIFFICULTY_NAMES[difficulty]}
          </Text>
          <View style={styles.ruleRow}>
            <Rule icon="grid-outline" text={`${size} × ${size}`} label={`${size} by ${size} board`} />
            <Rule icon="timer-outline" text={formatLimit(rules.timeLimitSec)} label={`Time limit ${formatLimit(rules.timeLimitSec)}`} />
            <Rule icon="warning-outline" text={`${rules.mistakeLimit} mistakes`} label={`Mistake limit ${rules.mistakeLimit}`} />
            {reward && <Rule icon="bulb-outline" text="+2 credits" label="First clear pays 2 hint credits" />}
          </View>
          <Text style={styles.rulesNote}>
            3 stars within {formatLimit(times.threeStarSec)}, 2 stars within {formatLimit(times.twoStarSec)}, 1 star for finishing in time.
            {' '}Out of mistakes or time? An optional ad adds one more mistake or extra time, each up to {MAX_EXTRA_MISTAKES} times per level.
          </Text>
        </View>
        <Button
          label={starting ? 'Starting…' : resuming ? 'Continue' : stars[number - 1] > 0 ? 'Play again' : 'Start Level'}
          icon="play"
          variant="primary"
          style={styles.start}
          onPress={confirmPlay}
          disabled={starting || !isLevelUnlocked(stars, number)}
        />
      </View>
    </Screen>
  );
}

function Rule({ icon, text, label }: { icon: IconName; text: string; label: string }) {
  return (
    <View style={styles.rule} accessible accessibilityLabel={label}>
      <Ionicons name={icon} size={15} color={colors.accent} />
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg },
  tracks: { flexDirection: 'row', gap: spacing.sm },
  track: {
    flex: 1, minHeight: TOUCH + 28, alignItems: 'center', justifyContent: 'center', gap: 2,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.xs,
    backgroundColor: colors.surface, backgroundImage: gradients.panel,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  trackSelected: { backgroundColor: colors.accentSoft, backgroundImage: gradients.selected, borderColor: colors.accent },
  trackLabel: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  trackLabelSelected: { color: colors.accent },
  trackStars: { ...type.dim, fontSize: 12, lineHeight: 15, fontVariant: ['tabular-nums'] },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundImage: gradients.panel },
  summaryIcon: {
    width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accent, backgroundImage: gradients.gold,
  },
  summaryText: { flex: 1, gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    // Five tiles per row with four gaps between them.
    flexBasis: '17%', flexGrow: 1, aspectRatio: 1, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center', gap: 3,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  tileCurrent: { borderColor: colors.accentEdge, backgroundImage: gradients.panel },
  tileSelected: { backgroundColor: colors.accentSoft, backgroundImage: gradients.selected, borderColor: colors.accent, borderWidth: 2 },
  tileLocked: { backgroundColor: colors.bg, borderColor: colors.line, opacity: 0.7 },
  tileNumber: { color: colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileNumberSelected: { color: colors.accent },
  tileStars: { flexDirection: 'row', gap: 1 },
  pressed: { opacity: 0.74 },
  footer: {
    width: '100%', maxWidth: 520, alignSelf: 'center', gap: spacing.sm, borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  rules: { gap: spacing.xs },
  rulesTitle: { ...type.heading, fontSize: 17 },
  ruleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rule: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 3, paddingHorizontal: spacing.sm,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
  },
  ruleText: { color: colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rulesNote: { ...type.dim, fontSize: 12, lineHeight: 16 },
  start: { minHeight: 54 },
});
