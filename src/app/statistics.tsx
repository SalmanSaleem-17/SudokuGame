import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ENABLED_DIFFICULTIES } from '../data/pool';
import { DIFFICULTY_NAMES, type Difficulty } from '../engine/grader';
import { dateKeyOf } from '../game/daily';
import { PLAY_BOARD_SIZES } from '../game/playFormat';
import { appStore } from '../state/app';
import { formatTime } from '../state/clock';
import { useStore } from '../state/store';
import type { Completion } from '../storage/repository';
import { Button, Card, type IconName, Screen } from '../ui/controls';
import { useAppActive } from '../ui/hooks';
import { colors, gradients, radius, spacing, type } from '../ui/theme';
import { useCompletionHistory } from '../ui/useCompletionHistory';

function dailyStreak(dates: readonly string[], today: Date): number {
  const completed = new Set(dates);
  const day = new Date(today);
  if (!completed.has(dateKeyOf(day))) day.setDate(day.getDate() - 1);

  let streak = 0;
  while (completed.has(dateKeyOf(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

interface DifficultySummary {
  solved: number;
  bestMs: number;
}

function summarizeByDifficulty(completions: readonly Completion[]) {
  const results = new Map<string, DifficultySummary>();
  for (const completion of completions) {
    const size = completion.slot === 'mini' ? PLAY_BOARD_SIZES[completion.difficulty] : 9;
    const key = `${completion.difficulty}:${size}`;
    const previous = results.get(key);
    results.set(key, {
      solved: (previous?.solved ?? 0) + 1,
      bestMs: previous ? Math.min(previous.bestMs, completion.timeMs) : completion.timeMs,
    });
  }
  return results;
}

const PLAY_FORMATS = ENABLED_DIFFICULTIES.map((difficulty) => ({ difficulty, size: PLAY_BOARD_SIZES[difficulty] }));
const FULL_SIZE_LEVELS: Difficulty[] = ['easy', 'medium'];

export default function StatisticsScreen() {
  const router = useRouter();
  const completedDays = useStore(appStore, (state) => state.dailyCompleted);
  const completions = useCompletionHistory();
  useAppActive();

  const summary = useMemo(() => summarizeByDifficulty(completions ?? []), [completions]);
  const formats = [
    ...PLAY_FORMATS,
    ...FULL_SIZE_LEVELS.filter((difficulty) => summary.has(`${difficulty}:9`)).map((difficulty) => ({ difficulty, size: 9 })),
  ];
  const streak = dailyStreak(completedDays, new Date());

  return (
    <Screen title="Statistics">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {completions === undefined ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading statistics" style={styles.loading} />
        ) : completions === null ? (
          <Text style={type.body}>Game statistics are currently unavailable.</Text>
        ) : (
          <>
            <View style={styles.overview}>
              <Stat icon="trophy-outline" label="Puzzles solved" value={String(completions.length)} gold />
              <Stat icon="flame-outline" label="Daily streak" value={`${streak} ${streak === 1 ? 'day' : 'days'}`} />
            </View>

            <Button label="Mistake Review" detail="Revisit mistakes from past games" icon="search-outline"
              trailingIcon="chevron-forward" onPress={() => router.push('/mistake-review')} />
            <Button label="Speed Round Statistics" icon="flash-outline"
              trailingIcon="chevron-forward" onPress={() => router.push('/speed-statistics')} />

            <Card style={styles.breakdown}>
              <View style={styles.heading}>
                <Ionicons name="bar-chart-outline" size={21} color={colors.blue} />
                <Text style={type.heading} accessibilityRole="header">By difficulty and board</Text>
              </View>
              {formats.map(({ difficulty, size }) => {
                const key = `${difficulty}:${size}`;
                const stats = summary.get(key);
                return (
                  <View key={key} style={styles.row}>
                    <View style={styles.rowTitle}>
                      <Text style={type.body}>{DIFFICULTY_NAMES[difficulty]} · {size} × {size}</Text>
                      <Text style={type.dim}>{`${stats?.solved ?? 0} solved`}</Text>
                    </View>
                    {stats && (
                      <View style={styles.best}>
                        <Text style={styles.time}>{formatTime(stats.bestMs)}</Text>
                        <Text style={type.dim}>Best time</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ icon, label, value, gold }: { icon: IconName; label: string; value: string; gold?: boolean }) {
  return (
    <Card style={styles.stat}>
      <View style={[styles.statIcon, gold && styles.statIconGold]}>
        <Ionicons name={icon} size={23} color={gold ? colors.accent : colors.entry} />
      </View>
      <Text style={styles.number}>{value}</Text>
      <Text style={type.dim}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  loading: { alignSelf: 'center', marginTop: spacing.lg },
  overview: { flexDirection: 'row', gap: spacing.md },
  stat: { flex: 1, padding: spacing.md, gap: spacing.xs, backgroundImage: gradients.panel },
  statIcon: {
    width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs, backgroundColor: colors.blueSoft,
  },
  statIconGold: { backgroundColor: colors.accentSoft },
  number: { ...type.title, fontSize: 25, lineHeight: 31, fontVariant: ['tabular-nums'] },
  breakdown: { padding: spacing.lg },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingVertical: spacing.md,
  },
  rowTitle: { flex: 1, gap: spacing.xs },
  best: { flexShrink: 1, alignItems: 'flex-end', gap: spacing.xs },
  time: { ...type.body, fontWeight: '700', color: colors.accent, fontVariant: ['tabular-nums'], textAlign: 'right' },
});
