import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DIFFICULTY_NAMES } from '../engine/grader';
import { parseDateKey } from '../game/daily';
import { WEEKLY_DIFFICULTIES, localWeekKey, weeklyProgress } from '../game/events';
import { appStore, startWeekly } from '../state/app';
import { formatTime } from '../state/clock';
import { useStore } from '../state/store';
import { Button, Card, Screen } from '../ui/controls';
import { useAppActive, useScreenFocused } from '../ui/hooks';
import { colors, gradients, radius, spacing, type } from '../ui/theme';

const STAGE_ICONS = ['leaf-outline', 'star-outline', 'diamond-outline'] as const;
const STAGE_TINTS = [colors.good, colors.accent, colors.blue];

function weekRange(weekKey: string): string {
  const monday = parseDateKey(weekKey);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 12);
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const start = monday.toLocaleDateString(undefined, options);
  const end = sunday.toLocaleDateString(undefined, options);
  return `${start} – ${end}`;
}

export default function WeeklyScreen() {
  const router = useRouter();
  const session = useStore(appStore, (s) => s.sessions.weekly);
  const completions = useStore(appStore, (s) => s.weeklyCompleted);
  const ready = useStore(appStore, (s) => s.ready);
  const loadError = useStore(appStore, (s) => s.loadError);
  const focused = useScreenFocused();
  const appActive = useAppActive();
  const [displayedWeek, setDisplayedWeek] = useState(localWeekKey);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focused || !appActive) return;
    const updateWeek = () => setDisplayedWeek(localWeekKey());
    updateWeek();
    const rollover = setInterval(updateWeek, 30_000);
    return () => clearInterval(rollover);
  }, [appActive, focused]);

  const week = displayedWeek;
  const progress = weeklyProgress(week, completions);
  const activeWeek = session?.dateKey ?? null;
  const carried = activeWeek !== week ? activeWeek : null;
  const activeStage = activeWeek === week ? session?.difficulty : null;
  const atNextStage = !!progress.next && progress.next === activeStage;
  const pending = !!session?.completed;
  const play = () => router.push({ pathname: '/game', params: { slot: 'weekly' } });

  const launch = () => {
    setError(null);
    if (week !== localWeekKey()) {
      setDisplayedWeek(localWeekKey());
      setError('A new weekly challenge is ready.');
      return;
    }
    if (!progress.next) return;
    const next = startWeekly(week, progress.next);
    if (next) play();
    else setError('Could not open this stage. Try again.');
  };

  const launchNext = () => {
    if (!carried) return launch();
    Alert.alert('Start this week’s challenge?', 'This replaces the unfinished board from your previous week.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start new week', onPress: launch },
    ]);
  };

  return (
    <Screen title="Weekly Challenge">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.hero}>
          <View style={styles.heroHeading}>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>{weekRange(week)}</Text>
              <Text style={type.title} accessibilityRole="header">
                {progress.earned ? 'Weekly badge earned' : 'Three puzzles, one badge'}
              </Text>
              <Text style={type.dim}>
                {progress.earned
                  ? 'You cleared all three stages. A new set opens Monday.'
                  : 'Solve all three stages in order to earn your weekly badge.'}
              </Text>
            </View>
            <View style={[styles.emblem, progress.earned && styles.emblemEarned]} accessible={false}>
              <Ionicons name={progress.earned ? 'ribbon' : 'ribbon-outline'} size={34}
                color={progress.earned ? colors.onAccent : colors.accent} />
            </View>
          </View>
          <View style={styles.progressRow}>
            {WEEKLY_DIFFICULTIES.map((difficulty) => (
              <View key={difficulty} style={[styles.progressBar, progress.completed.includes(difficulty) && styles.progressDone]} />
            ))}
            <Text accessibilityLabel={`${progress.completed.length} of 3 stages complete`} style={styles.progressCount}>
              {progress.completed.length}/3
            </Text>
          </View>
        </Card>

        <View style={styles.stageList}>
          {WEEKLY_DIFFICULTIES.map((difficulty, index) => {
            const done = progress.completed.includes(difficulty);
            const current = progress.next === difficulty;
            const moving = current && atNextStage;
            const result = done ? completions.find((item) => item.dateKey === week && item.difficulty === difficulty) : null;
            const status = done ? 'Completed' : moving ? (pending ? 'Result ready to save' : 'In progress')
              : current ? 'Ready to play' : 'Locked';
            const tint = STAGE_TINTS[index];
            return (
              <Card key={difficulty} style={[styles.stage, current && styles.currentStage]}>
                <View style={[styles.stageIcon, { borderColor: `${tint}80`, backgroundColor: `${tint}20` }]}>
                  <Ionicons name={STAGE_ICONS[index]} size={21} color={tint} />
                </View>
                <View style={styles.stageText}>
                  <Text style={type.heading}>{DIFFICULTY_NAMES[difficulty]}</Text>
                  <Text style={type.dim}>{status}{result ? ` · ${formatTime(result.timeMs)}` : ''}</Text>
                </View>
                <Ionicons name={done ? 'checkmark-circle' : current ? 'play-circle-outline' : 'lock-closed-outline'}
                  size={22} color={done ? colors.good : current ? colors.accent : colors.textFaint} />
              </Card>
            );
          })}
        </View>

        {loadError ? (
          <Text style={styles.error}>Your weekly progress could not be loaded.</Text>
        ) : pending ? (
          <Button label="Save pending result" variant="primary" icon="checkmark-circle-outline" onPress={play} />
        ) : progress.next ? (
          <Button label={atNextStage ? 'Continue puzzle' : `Play ${DIFFICULTY_NAMES[progress.next]}`}
            variant="primary" icon="play" disabled={!ready} onPress={atNextStage ? play : launchNext} />
        ) : (
          <Button label="View achievements" icon="trophy-outline" onPress={() => router.push('/achievements')} />
        )}
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        {carried && !pending ? (
          <Card style={styles.carried}>
            <Text style={type.heading}>Previous round in progress</Text>
            <Text style={type.dim}>{weekRange(carried)}</Text>
            <Button label="Continue previous puzzle" icon="return-up-back-outline" onPress={play} />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 540, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  hero: { padding: spacing.lg, gap: spacing.lg, backgroundImage: gradients.panel, borderColor: colors.accentEdge },
  heroHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { ...type.label, color: colors.accent },
  emblem: {
    width: 62, height: 62, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accentSoft, borderColor: colors.accentEdge, borderWidth: 1,
  },
  emblemEarned: { backgroundColor: colors.accent, backgroundImage: gradients.gold, borderColor: colors.accent },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.line },
  progressDone: { backgroundColor: colors.accent },
  progressCount: { ...type.label, color: colors.accent, fontVariant: ['tabular-nums'] },
  stageList: { gap: spacing.sm },
  stage: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  currentStage: { borderColor: colors.accentEdge },
  stageIcon: {
    width: 42, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  stageText: { flex: 1, gap: spacing.xs },
  carried: { gap: spacing.sm, padding: spacing.lg },
  error: { ...type.dim, color: colors.warn },
});
