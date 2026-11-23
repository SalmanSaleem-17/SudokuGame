import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getPuzzle } from '../data/pool';
import { DIFFICULTY_NAMES } from '../engine/grader';
import { cellName, parseGrid } from '../engine/grid';
import { techniqueDisplayName } from '../game/drills';
import {
  MAX_MISTAKE_REVIEW, TECHNIQUE_PACKS, candidateNotes, logicalFrame, mistakeLogic, mistakePosition, type MistakeAttempt,
} from '../game/learning';
import { SESSION_SLOTS, getSessionFailure, type SessionSlot } from '../game/session';
import { appStore, getCompletion } from '../state/app';
import { useStore } from '../state/store';
import type { Completion } from '../storage/repository';
import { Board } from '../ui/Board';
import { Button, Card, IconButton, Screen } from '../ui/controls';
import { useBoardSize } from '../ui/hooks';
import { colors, gradients, spacing, type } from '../ui/theme';
import { useCompletionHistory } from '../ui/useCompletionHistory';

const PAGE_SIZE = 12;
const emptyBoard = Object.freeze(Array<number>(81).fill(0));
const emptyErrors = new Set<number>();
const ignoreCell = () => {};

export default function MistakeReviewScreen() {
  const { id, slot, attempt } = useLocalSearchParams<{ id?: string; slot?: string; attempt?: string }>();
  const savedSlot = SESSION_SLOTS.find((candidate) => candidate === slot);
  return (
    <Screen title="Mistake Review">
      {id ? <CompletionReview key={id} id={id} /> : savedSlot && attempt ? (
        <AttemptReview key={attempt} slot={savedSlot} attempt={attempt} />
      ) : <ReviewHistory />}
    </Screen>
  );
}

function ReviewHistory() {
  const router = useRouter();
  const history = useCompletionHistory();
  const sessions = useStore(appStore, (state) => state.sessions);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const reviews = useMemo(() => (history ?? []).filter((item) => item.reviewCount).reverse(), [history]);
  const failed = SESSION_SLOTS.flatMap((slot) => {
    const session = sessions[slot];
    return session?.mistakeReview?.length && getSessionFailure(session) ? [{ slot, session }] : [];
  });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={type.dim}>Look back at incorrect entries and work through the logic for the correct number.</Text>
      {failed.map(({ slot, session }) => (
        <Button
          key={session.id}
          label={`${DIFFICULTY_NAMES[session.difficulty]} puzzle`}
          detail={`${session.mistakeReview!.length} entries · Ended attempt`}
          icon="search-outline"
          trailingIcon="chevron-forward"
          onPress={() => router.push({ pathname: '/mistake-review', params: { slot, attempt: session.id } })}
        />
      ))}
      {history === undefined ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel="Loading reviews" />
      ) : history === null ? (
        <Text style={type.body}>Saved reviews are currently unavailable.</Text>
      ) : reviews.length === 0 && failed.length === 0 ? (
        <Card style={styles.panel}>
          <Text style={type.heading}>No entries to review yet</Text>
          <Text style={type.dim}>After playing a game with incorrect entries, open Mistake Review from its results.</Text>
        </Card>
      ) : reviews.slice(0, limit).map((completion) => (
        <Button
          key={completion.sessionId}
          label={reviewTitle(completion)}
          detail={`${completion.reviewCount} ${completion.reviewCount === 1 ? 'entry' : 'entries'} · ${displayDate(completion.completedAt)}`}
          icon="search-outline"
          trailingIcon="chevron-forward"
          onPress={() => router.push({ pathname: '/mistake-review', params: { id: completion.sessionId } })}
        />
      ))}
      {reviews.length > limit && <Button label="Show older reviews" onPress={() => setLimit(limit + PAGE_SIZE)} />}
    </ScrollView>
  );
}

function reviewTitle(completion: Completion) {
  if (completion.techniquePack) return `${TECHNIQUE_PACKS[completion.techniquePack].title} practice`;
  if (completion.slot === 'daily') return 'Daily puzzle';
  const difficulty = DIFFICULTY_NAMES[completion.difficulty];
  return completion.slot === 'challenge' ? `${difficulty} friend challenge`
    : completion.slot === 'weekly' ? `${difficulty} weekly puzzle` : `${difficulty} puzzle`;
}

const displayDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function CompletionReview({ id }: { id: string }) {
  const [completion, setCompletion] = useState<Completion | null>();
  useEffect(() => {
    let live = true;
    void getCompletion(id).then(
      (result) => { if (live) setCompletion(result); },
      () => { if (live) setCompletion(null); },
    );
    return () => { live = false; };
  }, [id]);
  const rawGivens = completion && getPuzzle(completion.puzzleId)?.givens;
  const givens = useMemo(() => rawGivens ? parseGrid(rawGivens) : emptyBoard, [rawGivens]);
  if (completion === undefined) return <ActivityIndicator color={colors.accent} accessibilityLabel="Loading review" />;
  if (!completion?.mistakeReview?.length) return <ReviewUnavailable />;
  return <Review attempts={completion.mistakeReview} givens={givens} />;
}

function AttemptReview({ slot, attempt }: { slot: SessionSlot; attempt: string }) {
  const session = useStore(appStore, (state) => state.sessions[slot]);
  if (!session?.mistakeReview?.length || session.id !== attempt || !getSessionFailure(session)) return <ReviewUnavailable />;
  return <Review attempts={session.mistakeReview} givens={session.givens} />;
}

function ReviewUnavailable() {
  return <Text style={[styles.content, type.dim]}>No review is available for this puzzle.</Text>;
}

function Review({ attempts, givens }: { attempts: MistakeAttempt[]; givens: readonly number[] }) {
  const [index, setIndex] = useState(0);
  const [logicIndex, setLogicIndex] = useState<'deduction' | number | null>(null);
  const boardSize = useBoardSize(280, spacing.lg);
  const attempt = attempts[index];
  const position = useMemo(() => mistakePosition(attempt), [attempt]);
  const showLogic = logicIndex !== null;
  const logic = useMemo(() => showLogic ? mistakeLogic(attempt, givens) : null, [attempt, givens, showLogic]);
  const last = logic ? logic.path.steps.length - 1 : 0;
  const stepIndex = typeof logicIndex === 'number' ? logicIndex : last;
  const frame = useMemo(() => logic ? logicalFrame(logic.path, stepIndex) : null, [logic, stepIndex]);
  const errors = useMemo(() => frame ? emptyErrors : new Set([attempt.cell]), [attempt.cell, frame]);
  const notes = useMemo(() => frame ? candidateNotes(frame.overlay) : emptyBoard, [frame]);

  function move(delta: number) {
    setLogicIndex(null);
    setIndex(index + delta);
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.navigation}>
        <IconButton icon="chevron-back" label="Previous attempt" disabled={index === 0} onPress={() => move(-1)} />
        <View style={styles.navigatorText} accessibilityLiveRegion="polite">
          <Text style={styles.progress}>Entry {index + 1} of {attempts.length}</Text>
          <Text style={type.heading}>{cellName(attempt.cell)}</Text>
        </View>
        <IconButton icon="chevron-forward" label="Next attempt" disabled={index === attempts.length - 1} onPress={() => move(1)} />
      </View>

      <View style={styles.board}>
        <Board
          size={boardSize}
          values={frame?.values ?? position.values}
          givens={givens}
          notes={notes}
          marks={frame?.overlay.marks ?? position.overlay.marks}
          selected={null}
          highlightDigit={0}
          errors={errors}
          onCellPress={ignoreCell}
          disabled
        />
      </View>

      <Card style={styles.panel}>
        <View style={styles.digits}>
          <Text style={styles.entry}>Entered {attempt.entered}</Text>
          <Text style={styles.correct}>Correct {attempt.correct}</Text>
        </View>
        {frame && logic ? (
          <>
            <Text style={type.label} accessibilityLiveRegion="polite">
              {logic.fromGivens ? 'Solution from the original clues' : 'Logic from your position'}
              {last > 0 ? ` · Step ${stepIndex + 1} of ${last + 1}` : ''}
            </Text>
            <Text style={type.heading} accessibilityRole="header">{techniqueDisplayName(frame.step.technique)}</Text>
            <Text style={type.body}>{frame.step.explanation}</Text>
            {last > 0 && (
              <View style={styles.stepActions}>
                <Button label="Earlier step" disabled={stepIndex === 0} onPress={() => setLogicIndex(stepIndex - 1)} style={styles.stepAction} />
                <Button label="Next step" disabled={stepIndex === last} onPress={() => setLogicIndex(stepIndex + 1)} style={styles.stepAction} />
              </View>
            )}
            <Button label="See your entry" onPress={() => setLogicIndex(null)} variant="ghost" />
          </>
        ) : (
          <>
            <Text style={type.body} accessibilityLiveRegion="polite">{position.explanation}</Text>
            <Text style={type.dim}>This board shows the clues and correct entries you had at the time.</Text>
            {showLogic ? (
              <Text style={type.dim}>No teaching steps are available for this position.</Text>
            ) : (
              <Button label={`Show why ${attempt.correct} fits`} icon="bulb-outline" variant="primary" onPress={() => setLogicIndex('deduction')} />
            )}
          </>
        )}
      </Card>
      {attempts.length === MAX_MISTAKE_REVIEW && <Text style={type.dim}>Only the most recent {MAX_MISTAKE_REVIEW} entries are kept.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 592, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  navigatorText: { alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  progress: { ...type.label, color: colors.accent, textAlign: 'center' },
  board: { alignItems: 'center' },
  panel: { padding: spacing.lg, gap: spacing.md, backgroundImage: gradients.panel },
  digits: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  entry: { ...type.body, fontWeight: '700', color: colors.warn },
  correct: { ...type.body, fontWeight: '700', color: colors.good },
  stepActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stepAction: { flexGrow: 1 },
});
