import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { drillsOf } from '../../data/pool';
import { computeCandidates } from '../../engine/grid';
import { DRILL_TECHNIQUES, DrillTechnique } from '../../engine/pool';
import type { Step } from '../../engine/techniques';
import { DRILL_INFO, buildDrill } from '../../game/drills';
import { MARK_PATTERN, MARK_UNIT, overlayForStep } from '../../game/overlay';
import { Board } from '../../ui/Board';
import { Keypad } from '../../ui/Keypad';
import { Button, Screen } from '../../ui/controls';
import { haptic, useBoardSize } from '../../ui/hooks';
import { colors, radius, spacing, type } from '../../ui/theme';

const NO_ERRORS: ReadonlySet<number> = new Set();
const EMPTY_NOTES: number[] = new Array(81).fill(0);

type Phase = { kind: 'asking'; wrong: boolean } | { kind: 'explained'; step: Step; correct: boolean };

export default function DrillScreen() {
  const params = useLocalSearchParams<{ technique?: string }>();
  const router = useRouter();
  const technique: DrillTechnique = DRILL_TECHNIQUES.includes(params.technique as DrillTechnique)
    ? (params.technique as DrillTechnique)
    : 'nakedSingle';
  const records = useMemo(() => drillsOf(technique), [technique]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'asking', wrong: false });
  const [intro, setIntro] = useState(true);
  const boardSize = useBoardSize(56 + 250);

  const drill = useMemo(() => buildDrill(records[index % records.length]), [records, index]);

  const answer = useCallback(
    (value: number) => {
      const step = drill.check(value);
      if (step) {
        haptic('success');
        setPhase({ kind: 'explained', step, correct: true });
      } else {
        haptic('warn');
        setPhase({ kind: 'asking', wrong: true });
      }
    },
    [drill],
  );

  const onCellPress = useCallback(
    (cell: number) => {
      if (drill.answerType === 'cell' && drill.values[cell] === 0) answer(cell);
    },
    [drill, answer],
  );

  const view = useMemo(() => {
    if (phase.kind === 'explained') {
      const overlay = overlayForStep(phase.step, computeCandidates(drill.values));
      // Keep the drill's own candidates visible alongside the step's.
      drill.candidates.forEach((mask, cell) => {
        if (!overlay.candidates.has(cell)) overlay.candidates.set(cell, mask);
      });
      return overlay;
    }
    const marks = new Map<number, number>();
    const mark = drill.focusCells.length === 1 ? MARK_PATTERN : MARK_UNIT;
    for (const cell of drill.focusCells) marks.set(cell, mark);
    return { marks, candidates: drill.candidates };
  }, [phase, drill]);

  const notes = useMemo(() => {
    if (view.candidates.size === 0) return EMPTY_NOTES;
    const out = EMPTY_NOTES.slice();
    view.candidates.forEach((mask, cell) => (out[cell] = mask));
    return out;
  }, [view]);

  const values = useMemo(() => {
    if (phase.kind !== 'explained' || !phase.step.placement) return drill.values;
    const out = drill.values.slice();
    out[phase.step.placement.cell] = phase.step.placement.digit;
    return out;
  }, [phase, drill]);

  const next = () => {
    setIndex((i) => i + 1);
    setPhase({ kind: 'asking', wrong: false });
  };

  const info = DRILL_INFO[technique];

  if (intro) {
    return (
      <Screen title={info.name}>
        <ScrollView contentContainerStyle={styles.intro}>
          <Text style={type.heading}>{info.summary}</Text>
          <Text style={type.body}>{info.lesson}</Text>
          <Button label="Start drills" variant="primary" onPress={() => setIntro(false)} />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen title={`${info.name} · ${(index % records.length) + 1}/${records.length}`} style={styles.body}>
      <Board
        size={boardSize}
        values={values}
        givens={drill.values}
        notes={notes}
        selected={null}
        highlightDigit={0}
        errors={NO_ERRORS}
        marks={view.marks}
        onCellPress={onCellPress}
        disabled={phase.kind === 'explained' || drill.answerType !== 'cell'}
      />
      <View style={[styles.panel, { width: boardSize }]}>
        {phase.kind === 'asking' ? (
          <>
            <Text style={type.body}>{drill.prompt}</Text>
            {phase.wrong && (
              <Text style={styles.wrong} accessibilityLiveRegion="polite">
                Not that one. Try again, or see the answer.
              </Text>
            )}
            {drill.answerType === 'digit' && <Keypad onDigit={answer} keyHeight={52} />}
            <Button
              label="Show the answer"
              variant="ghost"
              onPress={() => setPhase({ kind: 'explained', step: drill.solution, correct: false })}
            />
          </>
        ) : (
          <>
            <Text style={[type.heading, phase.correct && { color: colors.good }]} accessibilityLiveRegion="polite">
              {phase.correct ? 'Correct' : 'Here is the answer'}
            </Text>
            <ScrollView style={styles.explanation}>
              <Text style={type.body}>{phase.step.explanation}</Text>
            </ScrollView>
            <View style={styles.actions}>
              <Button label="Done" onPress={() => router.back()} style={styles.flex} />
              <Button label="Next drill" variant="primary" onPress={next} style={styles.flex} />
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingTop: spacing.sm },
  intro: { padding: spacing.xl, gap: spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  panel: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
  },
  wrong: { ...type.dim, color: colors.warn },
  explanation: { maxHeight: 120 },
  actions: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
});
