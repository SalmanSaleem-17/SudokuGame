import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { getPuzzle } from '../data/pool';
import { DIFFICULTY_NAMES } from '../engine/grader';
import type { DrillTechnique, PuzzleRecord } from '../engine/pool';
import { parseDateKey } from '../game/daily';
import { DRILL_INFO } from '../game/drills';
import { TECHNIQUE_PACKS } from '../game/learning';
import { PLAY_BOARD_SIZES } from '../game/playFormat';
import { getCompletion } from '../state/app';
import { formatTime } from '../state/clock';
import type { Completion } from '../storage/repository';
import { ChallengeResults, formatChallengeTime } from '../ui/ChallengeResults';
import { Button, Card, type IconName, Screen } from '../ui/controls';
import { Motion } from '../ui/Motion';
import { colors, gradients, spacing, type, useReducedMotion } from '../ui/theme';

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
    void getCompletion(id ?? '').then(
      (result) => { if (live) setCompletion(result); },
      () => { if (live) setCompletion(null); },
    );
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
  const pack = completion.techniquePack;
  const lesson = pack ? null : lessonFor(puzzle);
  const isDaily = completion.slot === 'daily' && completion.dateKey;
  const isWeekly = completion.slot === 'weekly';
  const isMini = completion.slot === 'mini';
  const size = PLAY_BOARD_SIZES[completion.difficulty];
  const reviewCount = completion.mistakeReview?.length ?? 0;
  const challengeScore = completion.challengeCode ? {
    challengeCode: completion.challengeCode,
    sessionId: completion.sessionId,
    timeMs: completion.timeMs,
    mistakes: completion.mistakes,
    hints: completion.hints,
  } : null;
  const subtitle = isDaily
    ? `Daily puzzle · ${parseDateKey(completion.dateKey!).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
    : pack ? `${TECHNIQUE_PACKS[pack].title} practice`
      : isWeekly ? `Weekly challenge · ${DIFFICULTY_NAMES[completion.difficulty]}`
        : isMini ? `${DIFFICULTY_NAMES[completion.difficulty]} · ${size} × ${size}`
        : `${DIFFICULTY_NAMES[completion.difficulty]} ${challengeScore ? 'challenge' : 'puzzle'}`;

  return (
    <Screen back={false}>
      <ScrollView
        automaticallyAdjustKeyboardInsets={!!challengeScore}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps={challengeScore ? 'handled' : 'never'}
        showsVerticalScrollIndicator={false}>
        <Motion reduced={reducedMotion} style={styles.hero}>
          <View style={styles.medalHalo} accessible={false}>
            <Motion reduced={reducedMotion} variant="pop" style={styles.medal}>
              <Ionicons name="trophy-outline" size={40} color={colors.onAccent} />
            </Motion>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {challengeScore ? 'Challenge complete' : 'Puzzle solved'}
          </Text>
          <Text style={type.dim}>{subtitle}</Text>
        </Motion>

        <Card style={styles.stats}>
          <Stat
            label={challengeScore ? 'Active time' : 'Time'}
            value={challengeScore ? formatChallengeTime(completion.timeMs) : formatTime(completion.timeMs)}
            icon="time-outline"
            precise={!!challengeScore}
          />
          <View style={styles.divider} />
          <Stat label="Mistakes" value={String(completion.mistakes)} icon="alert-circle-outline" />
          {!isMini && (
            <>
              <View style={styles.divider} />
              <Stat label={pack ? 'Guided moves' : 'Hints'} value={String(completion.hints)} icon="bulb-outline" />
            </>
          )}
        </Card>

        {challengeScore && <ChallengeResults key={challengeScore.sessionId} score={challengeScore} />}

        {reviewCount > 0 && (
          <Button
            label="Review mistakes"
            detail={`${reviewCount} ${reviewCount === 1 ? 'entry' : 'entries'} to revisit`}
            icon="search-outline"
            trailingIcon="chevron-forward"
            onPress={() => router.push({ pathname: '/mistake-review', params: { id: completion.sessionId } })}
          />
        )}

        {lesson && (
          <Card style={styles.lesson}>
            <View style={styles.lessonLabel}>
              <Ionicons name="school-outline" size={17} color={colors.purple} />
              <Text style={styles.lessonEyebrow}>TECHNIQUE IN THIS PUZZLE</Text>
            </View>
            <Text style={type.heading}>{DRILL_INFO[lesson.technique].title}</Text>
            <Text style={type.dim}>
              {DRILL_INFO[lesson.technique].summary} The logical solution uses it {lesson.times === 1 ? 'once' : `${lesson.times} times`}.
            </Text>
            <Button
              label={`Practice ${DRILL_INFO[lesson.technique].title}`}
              icon="school-outline"
              onPress={() => router.push({ pathname: '/practice/[technique]', params: { technique: lesson.technique } })}
            />
          </Card>
        )}

        <View style={styles.actions}>
          {isDaily ? (
            <Button label="Daily calendar" variant="primary" icon="calendar-outline" onPress={() => router.replace('/daily')} />
          ) : challengeScore ? (
            <Button label="Challenge a Friend" variant="primary" icon="people-outline" onPress={() => router.dismissTo('/challenge')} />
          ) : isWeekly ? (
            <Button label="Weekly Challenge" variant="primary" icon="calendar-outline" onPress={() => router.dismissTo('/weekly')} />
          ) : pack ? (
            <Button label="Technique Packs" variant="primary" icon="layers-outline" onPress={() => router.dismissTo({ pathname: '/practice/packs', params: { pack } })} />
          ) : (
            <Button label="New Game" variant="primary" icon="add" onPress={() => router.replace('/new-game')} />
          )}
          <Button label="Home" onPress={() => router.dismissTo('/')} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value, icon, precise }: { label: string; value: string; icon: IconName; precise?: boolean }) {
  return (
    <View style={[styles.stat, precise && styles.preciseStat]} accessible accessibilityLabel={`${label} ${value}`}>
      <Ionicons name={icon} size={20} color={colors.blue} />
      <Text style={[styles.statValue, precise && styles.preciseValue]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', gap: spacing.xs },
  title: { ...type.title, fontSize: 32, textAlign: 'center' },
  medalHalo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderColor: colors.accentEdge,
    borderWidth: 1,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  medal: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.accent,
    backgroundImage: gradients.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: { flexDirection: 'row', paddingVertical: spacing.lg, backgroundImage: gradients.panel },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  preciseStat: { flex: 1.25 },
  statValue: { fontSize: 21, fontWeight: '700', color: colors.text, textAlign: 'center', fontVariant: ['tabular-nums'] },
  preciseValue: { fontSize: 17 },
  statLabel: { ...type.dim, textAlign: 'center' },
  divider: { width: 1, backgroundColor: colors.line },
  lesson: { padding: spacing.lg, gap: spacing.sm },
  lessonLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lessonEyebrow: { ...type.label, flex: 1 },
  actions: { gap: spacing.md },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
});
