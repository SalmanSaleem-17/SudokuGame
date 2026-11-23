import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from 'react-native';

import { drillsOf } from '../../data/pool';
import { computeCandidates } from '../../engine/grid';
import { DRILL_TECHNIQUES, DrillTechnique } from '../../engine/pool';
import { TECHNIQUE_NAMES, type Step } from '../../engine/techniques';
import { DRILL_INFO, buildDrill } from '../../game/drills';
import { MARK_PATTERN, MARK_UNIT, overlayForStep } from '../../game/overlay';
import { Board } from '../../ui/Board';
import { Keypad } from '../../ui/Keypad';
import { Button, Card, Screen } from '../../ui/controls';
import { haptic, useBoardSize } from '../../ui/hooks';
import { PRACTICE_STYLES, PracticePreview } from '../../ui/PracticePreview';
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
  const [lessonStep, setLessonStep] = useState(0);
  const scroll = useRef<ScrollViewInstance>(null);

  const drill = useMemo(() => buildDrill(records[index % records.length]), [records, index]);
  const boardSize = useBoardSize(drill.answerType === 'digit' ? 360 : 306, 14);

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
    scroll.current?.scrollTo({ y: 0, animated: false });
    setIndex((i) => i + 1);
    setPhase({ kind: 'asking', wrong: false });
  };

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/practice');
  };

  const info = DRILL_INFO[technique];
  const { accent, edge, gradient } = PRACTICE_STYLES[technique];
  const drillNumber = (index % records.length) + 1;
  const progressText = `Drill ${drillNumber} of ${records.length}`;

  if (intro) {
    const last = lessonStep === info.steps.length - 1;
    return (
      <Screen title="Practice" onBack={done}>
        <ScrollView contentContainerStyle={styles.intro} showsVerticalScrollIndicator={false}>
          <Card style={[styles.lesson, { borderColor: edge, backgroundImage: gradient }]}>
            <PracticePreview technique={technique} large />
            <View style={styles.lessonCopy}>
              <Text style={styles.lessonTitle} accessibilityRole="header">{info.title}</Text>
              <Text style={type.body}>{info.summary}</Text>
              <Text style={[type.dim, { color: accent }]}>Also called {TECHNIQUE_NAMES[technique].toLowerCase()}.</Text>
            </View>
          </Card>
          <Card style={styles.guide}>
            <Text style={type.heading} accessibilityRole="header">How it works</Text>
            <Text style={[type.label, { color: accent }]}>{`Step ${lessonStep + 1} of ${info.steps.length}`}</Text>
            <Text style={type.body} accessibilityLiveRegion="polite">{info.steps[lessonStep]}</Text>
          </Card>
          <Button
            label={last ? 'Start practice' : 'Next step'}
            variant="primary"
            icon={last ? 'play' : undefined}
            trailingIcon={last ? undefined : 'arrow-forward'}
            onPress={() => last ? setIntro(false) : setLessonStep((step) => step + 1)}
          />
          {lessonStep > 0 && <Button label="Previous step" onPress={() => setLessonStep((step) => step - 1)} />}
          {!last && <Button label="Skip to practice" variant="ghost" onPress={() => setIntro(false)} />}
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen title={info.title} onBack={done}>
      <ScrollView ref={scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={{ width: boardSize }}>
          <View
            style={styles.progress}
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: records.length, now: drillNumber, text: progressText }}>
            <Text style={[type.label, { color: accent }]}>{progressText}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(drillNumber / records.length) * 100}%`, backgroundColor: accent }]} />
            </View>
          </View>
          {phase.kind === 'asking' && (
            <Card style={[styles.prompt, { borderColor: edge, backgroundImage: gradient }]}>
              <Ionicons name={drill.answerType === 'digit' ? 'keypad-outline' : 'grid-outline'} size={20} color={accent} />
              <Text style={[type.body, styles.promptText]}>{drill.prompt}</Text>
            </Card>
          )}
        </View>
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
        {phase.kind === 'asking' ? (
          <View style={[styles.answerControls, { width: boardSize }]}>
            {drill.answerType === 'digit' && <Keypad onDigit={answer} keyHeight={50} twoRows />}
            {phase.wrong && (
              <View style={styles.retry}>
                <Ionicons name="refresh" size={17} color={colors.warn} />
                <Text style={styles.retryText} accessibilityLiveRegion="polite">
                  {drill.answerType === 'digit' ? 'Try a different number.' : 'Try a different square.'}
                </Text>
              </View>
            )}
            <Button
              label="Show answer"
              icon="bulb-outline"
              onPress={() => setPhase({ kind: 'explained', step: drill.solution, correct: false })}
            />
          </View>
        ) : (
          <View style={[styles.answerControls, { width: boardSize }]}>
            <Card style={[styles.panel, phase.correct ? styles.correctPanel : { borderColor: edge, backgroundImage: gradient }]}>
              <View style={styles.answerHeading}>
                <Ionicons name={phase.correct ? 'checkmark-circle' : 'bulb-outline'} size={24} color={phase.correct ? colors.good : accent} />
                <Text style={[type.heading, styles.answerTitle, { color: phase.correct ? colors.good : accent }]} accessibilityLiveRegion="polite">
                  {phase.correct ? 'Correct' : 'How it works'}
                </Text>
              </View>
              <Text style={type.body}>{phase.step.explanation}</Text>
            </Card>
            <View style={styles.actions}>
              <Button label="Done" onPress={done} style={styles.flex} />
              <Button label="Next drill" variant="primary" trailingIcon="arrow-forward" onPress={next} style={styles.flex} />
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  intro: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  lesson: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  lessonCopy: { flex: 1, gap: spacing.xs },
  lessonTitle: { ...type.title, fontSize: 24, letterSpacing: -0.45 },
  guide: { padding: spacing.lg, gap: spacing.md },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  promptText: { flex: 1, fontWeight: '600' },
  answerControls: { gap: spacing.sm },
  panel: { padding: spacing.lg, gap: spacing.sm },
  retry: {
    padding: spacing.sm, gap: spacing.sm, flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.sm, backgroundColor: colors.warnSoft,
  },
  retryText: { ...type.dim, color: colors.warn, flex: 1 },
  answerHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  answerTitle: { flex: 1 },
  correctPanel: { borderColor: '#486051', backgroundColor: '#1C2922' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
