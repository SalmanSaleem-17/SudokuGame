import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ENABLED_DIFFICULTIES } from '../data/pool';
import type { Difficulty } from '../engine/grader';
import { dateKeyOf, parseDateKey } from '../game/daily';
import { weeklyBadgeWeeks } from '../game/events';
import type { Completion } from '../storage/repository';
import { Card, type IconName, Screen } from '../ui/controls';
import { colors, gradients, radius, spacing, type } from '../ui/theme';
import { useCompletionHistory } from '../ui/useCompletionHistory';

interface Milestone {
  title: string;
  description: string;
  icon: IconName;
  progress: number;
  goal: number;
}

function longestDailyStreak(dates: ReadonlySet<string>): number {
  let longest = 0;
  let consecutive = 0;
  let nextDate = '';
  for (const key of [...dates].sort()) {
    consecutive = key === nextDate ? consecutive + 1 : 1;
    longest = Math.max(longest, consecutive);
    const date = parseDateKey(key);
    date.setDate(date.getDate() + 1);
    nextDate = dateKeyOf(date);
  }
  return longest;
}

function milestonesFor(completions: readonly Completion[]): Milestone[] {
  const solvedDifficulties = new Set<Difficulty>();
  const dailyDates = new Set<string>();
  let solvedWithoutHints = 0;
  for (const completion of completions) {
    solvedDifficulties.add(completion.difficulty);
    if (completion.slot === 'daily' && completion.dateKey) dailyDates.add(completion.dateKey);
    if (completion.hints === 0) solvedWithoutHints++;
  }

  return [
    { title: 'First solve', description: 'Solve your first puzzle.', icon: 'trophy-outline', progress: completions.length, goal: 1 },
    { title: 'Ten solves', description: 'Solve 10 puzzles.', icon: 'medal-outline', progress: completions.length, goal: 10 },
    {
      title: 'Every difficulty',
      description: 'Solve a puzzle at each available difficulty.',
      icon: 'layers-outline',
      progress: ENABLED_DIFFICULTIES.filter((difficulty) => solvedDifficulties.has(difficulty)).length,
      goal: ENABLED_DIFFICULTIES.length,
    },
    { title: 'First daily', description: 'Finish a Daily Puzzle.', icon: 'calendar-outline', progress: dailyDates.size, goal: 1 },
    {
      title: 'Three-day streak',
      description: 'Finish Daily Puzzles for 3 consecutive dates.',
      icon: 'flame-outline',
      progress: longestDailyStreak(dailyDates),
      goal: 3,
    },
    { title: 'No hints', description: 'Solve a puzzle without using hints.', icon: 'star-outline', progress: solvedWithoutHints, goal: 1 },
    { title: 'Weekly Champion', description: 'Solve all three stages of a Weekly Challenge.', icon: 'ribbon-outline', progress: weeklyBadgeWeeks(completions).length, goal: 1 },
  ];
}

export default function AchievementsScreen() {
  const completions = useCompletionHistory();
  const milestones = useMemo(() => milestonesFor(completions ?? []), [completions]);
  const unlocked = milestones.filter(({ progress, goal }) => progress >= goal).length;

  return (
    <Screen title="Achievements">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {completions === undefined ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading achievements" style={styles.loading} />
        ) : completions === null ? (
          <Text style={type.body}>Achievements are currently unavailable.</Text>
        ) : (
          <>
            <Card style={styles.summary}>
              <View style={styles.summaryHeading}>
                <View style={styles.summaryIcon}>
                  <Ionicons name="trophy" size={29} color={colors.onAccent} />
                </View>
                <Text style={[type.heading, styles.summaryTitle]} accessibilityRole="header">
                  {unlocked} of {milestones.length} badges unlocked
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${(unlocked / milestones.length) * 100}%` }]} />
              </View>
            </Card>

            {milestones.map((milestone) => <Badge key={milestone.title} milestone={milestone} />)}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Badge({ milestone }: { milestone: Milestone }) {
  const { title, description, icon, progress, goal } = milestone;
  const earned = progress >= goal;
  const status = earned ? 'Unlocked' : `${progress} of ${goal}`;
  return (
    <Card style={earned && styles.earned}>
      <View style={styles.badge} accessible accessibilityLabel={`${title}. ${description} ${status}.`}>
        <View style={[styles.badgeIcon, earned && styles.badgeIconEarned]}>
          <Ionicons name={icon} size={25} color={earned ? colors.accent : colors.textDim} />
        </View>
        <View style={styles.badgeText}>
          <Text style={type.body}>{title}</Text>
          <Text style={type.dim}>{description}</Text>
          <Text style={[type.label, earned && styles.statusEarned]}>{status}</Text>
        </View>
        {earned && <Ionicons name="checkmark-circle" size={21} color={colors.accent} />}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxWidth: 520, width: '100%', alignSelf: 'center' },
  loading: { alignSelf: 'center', marginTop: spacing.lg },
  summary: { padding: spacing.lg, gap: spacing.md, backgroundImage: gradients.panel },
  summaryHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryTitle: { flex: 1 },
  summaryIcon: {
    width: 54, height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accent, backgroundImage: gradients.gold,
  },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.bg, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  badgeIcon: {
    width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.blueSoft,
  },
  badgeIconEarned: { backgroundColor: colors.accentSoft },
  badgeText: { flex: 1, gap: spacing.xs },
  earned: { borderColor: colors.accentEdge },
  statusEarned: { color: colors.accent },
});
