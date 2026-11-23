import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DAILY_POOL } from '../data/pool';
import { DIFFICULTY_NAMES } from '../engine/grader';
import { dailyPuzzleFor, dateKeyOf, monthGrid, parseDateKey, resolveDaily } from '../game/daily';
import { currentStreak, repairableDay } from '../game/streak';
import { appStore, clearRewardOutcome, getDailyCompletion, startDaily, watchAdToRepairStreak } from '../state/app';
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
  const streakDays = useStore(appStore, (s) => s.streakDays);
  const streakRepairs = useStore(appStore, (s) => s.streakRepairs);
  const canRequestAds = useStore(appStore, (s) => s.ads.canRequestAds);
  const reward = useStore(appStore, (s) => s.reward);
  const [repairAsked, setRepairAsked] = useState(false);
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

  const streak = currentStreak(streakDays, new Date());
  const repairable = repairableDay(streakDays, new Date());
  const repaired = useMemo(() => new Set(streakRepairs), [streakRepairs]);
  const adBusy = reward.phase !== 'idle';
  const repairOutcome = repairAsked && !adBusy ? reward.lastOutcome : null;
  useEffect(() => () => clearRewardOutcome(), []);
  const repair = () => {
    if (!repairable || adBusy) return;
    setRepairAsked(true);
    void watchAdToRepairStreak(repairable);
  };

  const play = () => router.push({ pathname: '/game', params: { slot: 'daily' } });
  /** Opens an earlier date's puzzle. It fills the calendar but is too late to count for the streak. */
  const playPast = (dateKey: string) => {
    if (session?.dateKey === dateKey && !session.completed) return play();
    const start = () => {
      startDaily(dateKey);
      play();
    };
    const replacing = session && !session.completed && session.undo.length > 0
      ? ` Your unfinished puzzle from ${longDate(session.dateKey ?? today)} will be replaced.` : '';
    Alert.alert(`Play ${longDate(dateKey)}?`, `This fills the day on your calendar. It does not count toward your streak.${replacing}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Play', onPress: start },
    ]);
  };
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

        <Card style={styles.streak}>
          <View style={styles.streakHeading} accessible accessibilityLabel={`Daily streak, ${streak} ${streak === 1 ? 'day' : 'days'}`}>
            <Ionicons name="flame-outline" size={22} color={colors.accent} />
            <Text style={type.heading}>{streak} {streak === 1 ? 'day' : 'days'} streak</Text>
          </View>
          {repairable ? (
            <>
              <Text style={type.dim}>You missed {longDate(repairable)}. One optional ad repairs it and keeps your streak going.</Text>
              {canRequestAds ? (
                <Button label={adBusy ? 'Loading ad…' : 'Repair streak'} detail="Watch one ad" icon="play-circle-outline" onPress={repair} disabled={adBusy} />
              ) : (
                <Text style={type.dim}>Ads are unavailable right now.</Text>
              )}
              {repairOutcome && repairOutcome.kind !== 'earned' && (
                <Text accessibilityLiveRegion="polite" style={type.dim}>
                  {repairOutcome.kind === 'dismissed' ? 'The ad was closed before it finished, so the streak was not repaired.' : 'No ad is available right now.'}
                </Text>
              )}
            </>
          ) : (
            <Text style={type.dim}>Finish the Daily Puzzle on its own day to grow your streak. Every 7th day in a row pays 3 hint credits.</Text>
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
          <Text style={styles.calendarHint}>Tap an earlier day to play the puzzle you missed.</Text>
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
                const saved = !done && repaired.has(day.dateKey);
                const playable = !done && day.dateKey < today;
                const label = `${longDate(day.dateKey)}${done ? ', completed' : saved ? ', streak repaired' : ''}${isToday ? ', today' : ''}`;
                const inner = (
                  <View style={[styles.dayInner, done && styles.dayDone, saved && styles.daySaved, isToday && styles.dayToday]}>
                    <Text style={[styles.dayText, done && styles.dayTextDone]}>{day.day}</Text>
                    {/* A tick as well as the fill, so completion is not shown by colour alone. */}
                    {done && <Ionicons name="checkmark" size={11} color={colors.onAccent} style={styles.tick} />}
                    {saved && <Ionicons name="flame" size={10} color={colors.blue} style={styles.tick} />}
                  </View>
                );
                return playable ? (
                  <Pressable
                    key={i}
                    style={({ pressed }) => [styles.day, pressed && styles.dayPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityHint="Plays this day's puzzle"
                    onPress={() => playPast(day.dateKey)}>
                    {inner}
                  </Pressable>
                ) : (
                  <View key={i} style={styles.day} accessible accessibilityLabel={label}>{inner}</View>
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
  streak: { padding: spacing.lg, gap: spacing.sm },
  streakHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  calendarHint: { ...type.dim, fontSize: 12, lineHeight: 16, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  daySaved: { borderColor: colors.blue, borderStyle: 'dashed' },
  dayPressed: { opacity: 0.6 },
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
