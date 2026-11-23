import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DAILY_POOL } from '../data/pool';
import { DIFFICULTY_NAMES } from '../engine/grader';
import { dailyPuzzleFor, dateKeyOf, monthGrid, parseDateKey, resolveDaily } from '../game/daily';
import { appStore, getDailyCompletion, startDaily } from '../state/app';
import { formatTime } from '../state/clock';
import { useStore } from '../state/store';
import type { Completion } from '../storage/repository';
import { Button, Card, IconButton, Screen } from '../ui/controls';
import { useAppActive, useScreenFocused } from '../ui/hooks';
import { colors, gradients, radius, spacing, type } from '../ui/theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const longDate = (key: string) =>
  parseDateKey(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export default function DailyScreen() {
  const router = useRouter();
  const session = useStore(appStore, (s) => s.sessions.daily);
  const completedList = useStore(appStore, (s) => s.dailyCompleted);
  // The date is re-read when the screen or app comes back, so the puzzle rolls over at local midnight.
  useScreenFocused();
  useAppActive();
  const today = dateKeyOf(new Date());

  const completed = useMemo(() => new Set(completedList), [completedList]);
  const status = resolveDaily(today, session, completed);
  const puzzle = dailyPuzzleFor(today, DAILY_POOL);

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const weeks = useMemo(() => monthGrid(month.year, month.month), [month]);
  const monthName = new Date(month.year, month.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shiftMonth = (delta: number) =>
    setMonth((m) => {
      const d = new Date(m.year, m.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  const now = new Date();
  const atCurrentMonth = month.year === now.getFullYear() && month.month === now.getMonth();

  const [loaded, setLoaded] = useState<{ dateKey: string; completion: Completion | null } | null>(null);
  const isDone = status.kind === 'completed';
  const result = isDone && loaded?.dateKey === today ? loaded.completion : null;
  useEffect(() => {
    let live = true;
    if (isDone) void getDailyCompletion(today).then((completion) => live && setLoaded({ dateKey: today, completion }));
    return () => {
      live = false;
    };
  }, [isDone, today]);

  const play = () => router.push({ pathname: '/game', params: { slot: 'daily' } });
  const startToday = () => {
    startDaily(today);
    play();
  };
  const carried = status.kind === 'fresh' ? status.carried : null;
  const confirmStartToday = () => {
    if (!carried) return startToday();
    Alert.alert("Start today's puzzle?", `Your unfinished puzzle from ${longDate(carried)} will be replaced.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start today', style: 'destructive', onPress: startToday },
    ]);
  };

  return (
    <Screen title="Daily Puzzle">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.hero}>
          <View style={styles.heroHeading}>
            <View style={styles.heroText}>
              <Text style={styles.todayLabel}>TODAY’S CHALLENGE</Text>
              <Text style={styles.heroTitle} accessibilityRole="header">{longDate(today)}</Text>
              <Text style={type.dim}>{DIFFICULTY_NAMES[puzzle.difficulty]} difficulty</Text>
            </View>
            <View style={styles.calendarEmblem} accessible={false}>
              <Ionicons name="calendar-outline" size={30} color={colors.accent} />
            </View>
          </View>
          {status.kind === 'completed' ? (
            <View style={styles.doneRow}>
              <Ionicons name="checkmark-circle" size={22} color={colors.good} />
              <Text style={[type.body, styles.doneText]}>
                Completed{result ? ` in ${formatTime(result.timeMs)}` : ''}. Come back tomorrow for a new puzzle.
              </Text>
            </View>
          ) : status.kind === 'resume' ? (
            <Button label="Continue" detail={formatTime(session?.elapsedMs ?? 0)} variant="primary" icon="play" onPress={play} />
          ) : (
            <Button label="Play today's puzzle" variant="primary" icon="play" onPress={confirmStartToday} />
          )}
        </Card>

        {carried && (
          <Card style={styles.today}>
            <Text style={type.label}>STILL IN PROGRESS</Text>
            <Text style={type.body}>{longDate(carried)}</Text>
            <Text style={type.dim}>This puzzle stays with the day it was started and will count for that date.</Text>
            <Button label="Continue this puzzle" detail={formatTime(session?.elapsedMs ?? 0)} onPress={play} />
          </Card>
        )}

        <Card style={styles.calendar}>
          <View style={styles.calendarHeading}>
            <Ionicons name="checkmark-done-outline" size={21} color={colors.blue} />
            <Text style={type.heading} accessibilityRole="header">Completed days</Text>
          </View>
          <View style={styles.monthRow}>
            <IconButton icon="chevron-back" label="Previous month" onPress={() => shiftMonth(-1)} />
            <Text style={styles.monthName}>{monthName}</Text>
            <IconButton icon="chevron-forward" label="Next month" onPress={() => shiftMonth(1)} disabled={atCurrentMonth} />
          </View>
          <View style={styles.week}>
            {WEEKDAYS.map((d, i) => (
              <Text key={i} style={styles.weekday}>
                {d}
              </Text>
            ))}
          </View>
          {weeks.map((week, w) => (
            <View key={w} style={styles.week}>
              {week.map((day, i) => {
                if (!day) return <View key={i} style={styles.day} />;
                const done = completed.has(day.dateKey);
                const isToday = day.dateKey === today;
                return (
                  <View
                    key={i}
                    style={styles.day}
                    accessible
                    accessibilityLabel={`${longDate(day.dateKey)}${done ? ', completed' : ''}${isToday ? ', today' : ''}`}>
                    <View style={[styles.dayInner, done && styles.dayDone, isToday && styles.dayToday]}>
                      <Text style={[styles.dayText, done && styles.dayTextDone]}>{day.day}</Text>
                      {/* A tick as well as the fill, so completion is not shown by colour alone. */}
                      {done && <Ionicons name="checkmark" size={11} color={colors.onAccent} style={styles.tick} />}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  hero: { padding: spacing.lg, gap: spacing.md, backgroundImage: gradients.panel },
  today: { padding: spacing.lg, gap: spacing.md },
  heroHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  heroText: { flex: 1, gap: spacing.xs },
  todayLabel: { ...type.label, color: colors.accent, letterSpacing: 1 },
  heroTitle: { ...type.title, fontSize: 27, lineHeight: 32 },
  calendarEmblem: {
    width: 59, height: 59, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accentSoft, borderColor: colors.accentEdge, borderWidth: 1,
  },
  doneRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.sm, backgroundColor: colors.blueSoft,
  },
  doneText: { flex: 1, fontSize: 14, lineHeight: 20 },
  calendar: { padding: spacing.sm, paddingBottom: spacing.md },
  calendarHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  monthRow: { flexDirection: 'row', alignItems: 'center' },
  monthName: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: spacing.xs, ...type.label },
  day: { flex: 1, aspectRatio: 1, padding: 3 },
  dayInner: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 2, borderColor: 'transparent' },
  dayDone: { backgroundColor: colors.accent },
  dayToday: { borderColor: colors.accent },
  dayText: { fontSize: 14, color: colors.textDim, fontVariant: ['tabular-nums'] },
  dayTextDone: { color: colors.onAccent, fontWeight: '700' },
  tick: { position: 'absolute', bottom: 1 },
});
