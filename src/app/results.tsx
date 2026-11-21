import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { getPuzzle } from '../data/pool';
import { DIFFICULTY_NAMES } from '../engine/grader';
import type { DrillTechnique, PuzzleRecord } from '../engine/pool';
import { parseDateKey } from '../game/daily';
import { DRILL_INFO } from '../game/drills';
import { getCompletion } from '../state/app';
import { formatTime } from '../state/clock';
import type { Completion } from '../storage/repository';
import { Button, Card, Screen } from '../ui/controls';
import { Motion } from '../ui/Motion';
import { colors, spacing, type, useReducedMotion } from '../ui/theme';

/**
 * The lesson most relevant to a puzzle, taken from its verified solution path: the
 * hardest practice technique that path actually uses.
 */
function lessonFor(puzzle: PuzzleRecord | null): { technique: DrillTechnique; times: number } | null {
  if (!puzzle) return null;
  for (const technique of ['lockedCandidates', 'nakedSingle', 'hiddenSingle'] as DrillTechnique[]) {
    const times = puzzle.techniques[technique] ?? 0;
    if (times > 0) return { technique, times };
  }
  return null;
}

export default function ResultsScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [completion, setCompletion] = useState<Completion | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void getCompletion(id ?? '').then((c) => live && setCompletion(c));
    return () => {
      live = false;
    };
  }, [id]);

  if (completion === undefined) return <Screen title="" back={false}>{null}</Screen>;

  if (completion === null) {
    return (
      <Screen title="Results">
        <View style={styles.missing}>
          <Text style={type.body}>This result is no longer available.</Text>
          <Button label="Home" variant="primary" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  const puzzle = getPuzzle(completion.puzzleId);
  const lesson = lessonFor(puzzle);
  const isDaily = completion.slot === 'daily' && completion.dateKey;
  const subtitle = isDaily
    ? `Daily puzzle · ${parseDateKey(completion.dateKey!).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
    : `${DIFFICULTY_NAMES[completion.difficulty]} puzzle`;

  return (
    <Screen back={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Motion reduced={reducedMotion} style={styles.hero}>
          <Motion reduced={reducedMotion} variant="pop" style={styles.medal}>
            <Ionicons name="checkmark" size={44} color={colors.onAccent} />
          </Motion>
          <Text style={type.title} accessibilityRole="header">
            Solved
          </Text>
          <Text style={type.dim}>{subtitle}</Text>
        </Motion>

        <Card style={styles.stats}>
          <Stat label="Time" value={formatTime(completion.timeMs)} />
          <View style={styles.divider} />
          <Stat label="Mistakes" value={String(completion.mistakes)} />
          <View style={styles.divider} />
          <Stat label="Hints" value={String(completion.hints)} />
        </Card>

        {lesson && (
          <Card style={styles.lesson}>
            <Text style={type.label}>TECHNIQUE IN THIS PUZZLE</Text>
            <Text style={type.heading}>{DRILL_INFO[lesson.technique].name}</Text>
            <Text style={type.dim}>
              The logical solution to this puzzle uses {DRILL_INFO[lesson.technique].name.toLowerCase()}{' '}
              {lesson.times === 1 ? 'once' : `${lesson.times} times`}. {DRILL_INFO[lesson.technique].summary}
            </Text>
            <Button
              label={`Practice ${DRILL_INFO[lesson.technique].name.toLowerCase()}`}
              icon="school-outline"
              onPress={() => router.push({ pathname: '/practice/[technique]', params: { technique: lesson.technique } })}
            />
          </Card>
        )}

        <View style={styles.actions}>
          {isDaily ? (
            <Button label="Daily calendar" variant="primary" icon="calendar-outline" onPress={() => router.replace('/daily')} />
          ) : (
            <Button label="New Game" variant="primary" icon="add" onPress={() => router.replace('/new-game')} />
          )}
          <Button label="Home" onPress={() => router.replace('/')} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label} ${value}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={type.label}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', gap: spacing.xs },
  medal: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  stats: { flexDirection: 'row', paddingVertical: spacing.lg },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xs },
  statValue: { fontSize: 24, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  divider: { width: 1, backgroundColor: colors.line },
  lesson: { padding: spacing.lg, gap: spacing.sm },
  actions: { gap: spacing.md },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
});
