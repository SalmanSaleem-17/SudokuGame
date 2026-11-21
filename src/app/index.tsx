import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { DIFFICULTY_NAMES } from '../engine/grader';
import { dateKeyOf } from '../game/daily';
import { appStore } from '../state/app';
import { formatTime } from '../state/clock';
import { useStore } from '../state/store';
import { Button, IconButton, Screen } from '../ui/controls';
import { useScreenFocused } from '../ui/hooks';
import { Motion } from '../ui/Motion';
import { colors, radius, spacing, type, useReducedMotion } from '../ui/theme';

const HERO_TILES = ['2', '', '6', '', '5', '', '4', '', '8'];

export default function HomeScreen() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const classic = useStore(appStore, (s) => s.sessions.classic);
  const daily = useStore(appStore, (s) => s.sessions.daily);
  const dailyCompleted = useStore(appStore, (s) => s.dailyCompleted);
  const credits = useStore(appStore, (s) => s.credits);
  // Re-read the date whenever the screen is shown again, so it rolls over at midnight.
  useScreenFocused();
  const today = dateKeyOf(new Date());

  const dailyDetail = dailyCompleted.includes(today)
    ? 'Completed today'
    : daily && !daily.completed
      ? 'In progress'
      : "Today's puzzle is ready";

  return (
    <Screen back={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Motion reduced={reducedMotion} style={styles.hero}>
          <View style={styles.emblem} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {HERO_TILES.map((digit, index) => (
              <View key={index} style={[styles.tile, index === 4 && styles.tileSelected]}>
                <Text style={[styles.tileText, index === 4 && styles.tileTextSelected]}>{digit}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Sudoku Studio
          </Text>
          <Text style={type.dim}>Classic 9×9 puzzles, playable offline.</Text>
        </Motion>

        <View style={styles.menu}>
          {classic && !classic.completed && (
            <Button
              label="Continue"
              detail={`${DIFFICULTY_NAMES[classic.difficulty]} · ${formatTime(classic.elapsedMs)}`}
              variant="primary"
              icon="play"
              onPress={() => router.push({ pathname: '/game', params: { slot: 'classic' } })}
            />
          )}
          <Button
            label="New Game"
            variant={classic && !classic.completed ? 'secondary' : 'primary'}
            icon="add"
            onPress={() => router.push('/new-game')}
          />
          <Button label="Daily Puzzle" detail={dailyDetail} icon="calendar-outline" onPress={() => router.push('/daily')} />
          <Button
            label="Practice"
            detail="Free technique drills"
            icon="school-outline"
            onPress={() => router.push('/practice')}
          />
        </View>

        <View style={styles.footer}>
          <Text style={type.dim} accessibilityLabel={`${credits} hint credits`}>
            Hint credits: <Text style={styles.credits}>{credits}</Text>
          </Text>
          <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center', maxWidth: 520, width: '100%', alignSelf: 'center' },
  hero: {
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  emblem: {
    width: 112,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    padding: 7,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
  },
  tile: { width: 30, height: 30, borderRadius: 5, backgroundColor: colors.cellPeer, alignItems: 'center', justifyContent: 'center' },
  tileSelected: { backgroundColor: colors.accent },
  tileText: { fontSize: 17, fontWeight: '700', color: colors.textDim },
  tileTextSelected: { color: colors.onAccent },
  title: { ...type.title, fontSize: 34, letterSpacing: -1.2, textAlign: 'center' },
  menu: { gap: spacing.md },
  footer: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  credits: { color: colors.text, fontWeight: '700' },
});
