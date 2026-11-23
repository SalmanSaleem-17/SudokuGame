import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ENABLED_DIFFICULTIES } from '../data/pool';
import { DIFFICULTY_NAMES, type Difficulty } from '../engine/grader';
import { PLAY_BOARD_SIZES, isMiniResult } from '../game/playFormat';
import { playerLevel } from '../game/rewards';
import { currentStreak } from '../game/streak';
import { appStore } from '../state/app';
import { formatTime } from '../state/clock';
import { useStore } from '../state/store';
import type { Completion } from '../storage/repository';
import { Button, Card, type IconName, Screen } from '../ui/controls';
import { useAppActive } from '../ui/hooks';
import { colors, gradients, radius, spacing, type } from '../ui/theme';
import { useCompletionHistory } from '../ui/useCompletionHistory';

interface DifficultySummary {
  solved: number;
  bestMs: number;
}

function summarizeByDifficulty(completions: readonly Completion[]) {
  const results = new Map<string, DifficultySummary>();
  for (const completion of completions) {
    const size = isMiniResult(completion) ? PLAY_BOARD_SIZES[completion.difficulty] : 9;
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
  const streakDays = useStore(appStore, (state) => state.streakDays);
  const rank = playerLevel(useStore(appStore, (state) => state.xp));
  const completions = useCompletionHistory();
  useAppActive();

  const summary = useMemo(() => summarizeByDifficulty(completions ?? []), [completions]);
  const formats = [
    ...PLAY_FORMATS,
    ...FULL_SIZE_LEVELS.filter((difficulty) => summary.has(`${difficulty}:9`)).map((difficulty) => ({ difficulty, size: 9 })),
  ];
  const streak = currentStreak(streakDays, new Date());

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

            <Card style={styles.rank}>
              <View style={styles.rankHeading} accessible accessibilityLabel={`Player level ${rank.level}. ${rank.xp} of ${rank.next} experience.`}>
                <View style={[styles.statIcon, styles.statIconGold, styles.rankIcon]}>
                  <Ionicons name="ribbon-outline" size={23} color={colors.accent} />
                </View>
                <View style={styles.rowTitle}>
                  <Text style={type.heading}>Player level {rank.level}</Text>
                  <Text style={type.dim}>{rank.xp} / {rank.next} XP · each new level pays 1 hint credit</Text>
                </View>
              </View>
              <View style={styles.rankTrack}>
                <View style={[styles.rankFill, { width: `${Math.round(rank.progress * 100)}%` }]} />
              </View>
            </Card>

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
  rank: { padding: spacing.md, gap: spacing.md, backgroundImage: gradients.panel },
  rankHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rankIcon: { marginBottom: 0 },
  rankTrack: { height: 6, borderRadius: 3, backgroundColor: colors.bg, overflow: 'hidden' },
  rankFill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
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
