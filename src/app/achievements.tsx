import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { achievementsFor, isEarned, type Achievement } from '../game/achievements';
import { playerLevel } from '../game/rewards';
import { appStore } from '../state/app';
import { useStore } from '../state/store';
import { Card, type IconName, Screen } from '../ui/controls';
import { colors, gradients, radius, spacing, type } from '../ui/theme';
import { useCompletionHistory } from '../ui/useCompletionHistory';

export default function AchievementsScreen() {
  const completions = useCompletionHistory();
  const streakDays = useStore(appStore, (s) => s.streakDays);
  const rank = playerLevel(useStore(appStore, (s) => s.xp));
  const achievements = useMemo(() => achievementsFor(completions ?? [], streakDays), [completions, streakDays]);
  const unlocked = achievements.filter(isEarned).length;

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
                <View style={styles.summaryText}>
                  <Text style={type.heading} accessibilityRole="header">
                    {unlocked} of {achievements.length} badges unlocked
                  </Text>
                  <Text style={type.dim}>Player level {rank.level} · {rank.xp} XP</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${(unlocked / achievements.length) * 100}%` }]} />
              </View>
              <Text style={type.dim}>Each badge pays hint credits once, the first time you earn it.</Text>
            </Card>

            {achievements.map((achievement) => <Badge key={achievement.key} achievement={achievement} />)}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Badge({ achievement }: { achievement: Achievement }) {
  const { title, description, icon, progress, goal, credits } = achievement;
  const earned = isEarned(achievement);
  const status = earned ? 'Unlocked' : `${Math.min(progress, goal)} of ${goal}`;
  const reward = `${credits} hint ${credits === 1 ? 'credit' : 'credits'}`;
  return (
    <Card style={earned && styles.earned}>
      <View style={styles.badge} accessible accessibilityLabel={`${title}. ${description} ${status}. Reward: ${reward}.`}>
        <View style={[styles.badgeIcon, earned && styles.badgeIconEarned]}>
          <Ionicons name={icon as IconName} size={25} color={earned ? colors.accent : colors.textDim} />
        </View>
        <View style={styles.badgeText}>
          <Text style={type.body}>{title}</Text>
          <Text style={type.dim}>{description}</Text>
          <View style={styles.statusRow}>
            <Text style={[type.label, earned && styles.statusEarned]}>{status}</Text>
            <View style={styles.reward}>
              <Ionicons name="bulb-outline" size={13} color={earned ? colors.textFaint : colors.accent} />
              <Text style={[styles.rewardText, earned && styles.rewardPaid]}>+{credits}</Text>
            </View>
          </View>
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
  summaryText: { flex: 1, gap: 2 },
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
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rewardText: { fontSize: 13, fontWeight: '800', color: colors.accent, fontVariant: ['tabular-nums'] },
  rewardPaid: { color: colors.textFaint },
  earned: { borderColor: colors.accentEdge },
  statusEarned: { color: colors.accent },
});
