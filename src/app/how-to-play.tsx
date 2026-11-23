import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { isVariantMode, variantGuide, type VariantMode } from '../game/variantGuides';
import { AlternateBoard } from '../ui/AlternateBoard';
import { useBoardPalette } from '../ui/boardTheme';
import { Button, Card, Screen } from '../ui/controls';
import { colors, gradients, radius, spacing, type } from '../ui/theme';

const LESSONS = [
  { title: 'Fill the empty cells', body: 'The bold digits are clues. Fill the spaces so every row, column, and box uses each digit once.', mark: [1, 6, 9, 14], caption: 'Mini Sudoku uses 1–4. Classic uses 1–9.' },
  { title: 'Check the row', body: 'Read across. This row already has 1, 3, and 4, so the empty cell must be 2.', mark: [0, 1, 2, 3], target: 1, answer: 2, caption: 'Each digit appears once across a row.' },
  { title: 'Check the column', body: 'Read down. The third column has 3, 4, and 2. Its missing digit is 1.', mark: [2, 6, 10, 14], target: 6, answer: 1, clue: [14, 2], caption: 'Each digit appears once down a column.' },
  { title: 'Check the box', body: 'Thicker lines divide the board into boxes. The lower-left box is missing 1, so it belongs in the highlighted cell.', mark: [8, 9, 12, 13], target: 9, answer: 1, caption: 'Each digit appears once inside a box.' },
  { title: 'Tap, take notes, or ask for help', body: 'Tap a cell, then a digit. Turn on Notes to jot down possibilities. On 9×9 boards, Notes can also fill in every possibility at once and mark cells with a colour. Use Undo to reverse a move or Hint on a 9×9 board to see the next step.', mark: [14], target: 14, caption: 'Small digits are notes you can change.' },
  { title: 'Climb the levels', body: 'Levels give every puzzle a time limit and a mistake limit. Easy levels use 4×4 boards, Medium 6×6, and Hard and Expert 9×9. Solve faster to earn up to 3 stars, and clear a level to unlock the next.', mark: [0, 5, 10, 15], caption: 'Open Levels from the home screen.' },
] as const;

const EXAMPLE = [1, 0, 3, 4, 3, 4, 0, 2, 2, 0, 4, 3, 4, 3, 0, 1];
type Lesson = (typeof LESSONS)[number];

const NO_ERRORS: ReadonlySet<number> = new Set();
const ignoreSelect = () => undefined;

/** The tour takes three quarters of the screen's height, centred. */
const TOUR_HEIGHT = 0.75;
const TOUR_MAX_WIDTH = 500;

export default function HowToPlayScreen() {
  const { variant } = useLocalSearchParams<{ variant?: string }>();
  return isVariantMode(variant) ? <VariantHowToPlay key={variant} mode={variant} /> : <ClassicHowToPlay />;
}

interface TourProps {
  screenTitle: string;
  step: number;
  /** One title per card; also drives the progress bar. */
  titles: readonly string[];
  body: string;
  caption: string;
  illustration: ReactNode;
  /** Shown under the last card's caption, for example a button that starts a game. */
  extra?: ReactNode;
  onStep: (step: number) => void;
  onClose: () => void;
}

/**
 * The card-by-card tour frame. It sits in the middle of the screen at a fixed share of
 * its height, so every card is the same size. The card's content scrolls inside it when
 * it does not fit, and the Previous and Next buttons stay in place below it.
 */
function Tour({ screenTitle, step, titles, body, caption, illustration, extra, onStep, onClose }: TourProps) {
  const { height } = useWindowDimensions();
  const last = step === titles.length - 1;

  return (
    <Screen title={screenTitle} onBack={onClose}>
      <View style={styles.stage}>
        <View style={[styles.tour, { height: Math.round(height * TOUR_HEIGHT) }]}>
          <View style={styles.progress} accessibilityLabel={`Card ${step + 1} of ${titles.length}`} accessible>
            <Text style={styles.step}>Card {step + 1} of {titles.length}</Text>
            <View style={styles.segments} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {titles.map((title, index) => <View key={title} style={[styles.segment, index <= step && styles.segmentFilled]} />)}
            </View>
          </View>

          <Card style={styles.card}>
            {/* A fresh scroll view per card starts each one at the top. */}
            <ScrollView key={step} contentContainerStyle={styles.cardContent}>
              <Text accessibilityRole="header" style={styles.title}>{titles[step]}</Text>
              <Text style={type.body}>{body}</Text>
              {illustration}
              <Text style={styles.caption}>{caption}</Text>
              {last && extra}
            </ScrollView>
          </Card>

          <View style={styles.actions}>
            <Button label="Previous" icon="chevron-back" onPress={() => onStep(step - 1)} disabled={step === 0} style={styles.action} />
            <Button label={last ? 'Done' : 'Next'} variant="primary" trailingIcon={last ? 'checkmark' : 'chevron-forward'}
              onPress={last ? onClose : () => onStep(step + 1)} style={styles.action} />
          </View>
        </View>
      </View>
    </Screen>
  );
}

/** The guide for one Sudoku variant, shown on a real board of that variant. */
function VariantHowToPlay({ mode }: { mode: VariantMode }) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const guide = useMemo(() => variantGuide(mode), [mode]);
  const [step, setStep] = useState(0);
  const card = guide.cards[step];
  const close = () => router.canGoBack() ? router.back() : router.replace('/');
  // The board fits the card's width, and never takes more than half the tour's height.
  const edge = Math.floor(Math.min(Math.min(width, TOUR_MAX_WIDTH) - spacing.lg * 4, height * TOUR_HEIGHT * 0.5));
  const notes = useMemo(() => new Array<number>(guide.puzzle.givens.length).fill(0), [guide]);

  return (
    <Tour
      screenTitle={`How to Play ${guide.name}`}
      step={step}
      titles={guide.cards.map(({ title }) => title)}
      body={card.body}
      caption={card.caption}
      onStep={setStep}
      onClose={close}
      illustration={
        <View style={styles.variantBoard} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <AlternateBoard
            puzzle={guide.puzzle}
            edge={edge}
            values={guide.puzzle.givens}
            notes={notes}
            selected={card.selected}
            highlightDigit={0}
            errors={NO_ERRORS}
            onSelect={ignoreSelect}
            disabled
          />
        </View>
      }
      extra={
        <Button label={`Play ${guide.name}`} variant="ghost" icon="play"
          onPress={() => router.replace({ pathname: '/alternate', params: { mode, source: 'picker' } })} />
      }
    />
  );
}

function ClassicHowToPlay() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const lesson = LESSONS[step];
  const close = () => router.canGoBack() ? router.back() : router.replace('/');

  return (
    <Tour
      screenTitle="How to Play"
      step={step}
      titles={LESSONS.map(({ title }) => title)}
      body={lesson.body}
      caption={lesson.caption}
      onStep={setStep}
      onClose={close}
      illustration={<ExampleBoard lesson={lesson} />}
      extra={<Button label="Try a 4×4 puzzle" variant="ghost" icon="play" onPress={() => router.replace({ pathname: '/alternate', params: { mode: 'mini-4' } })} />}
    />
  );
}

function ExampleBoard({ lesson }: { lesson: Lesson }) {
  const palette = useBoardPalette();
  const marks: readonly number[] = lesson.mark;
  const target = 'target' in lesson ? lesson.target : -1;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.example, { backgroundColor: palette.frame }]}>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={[styles.exampleRow, row === 1 && styles.boxSpaceBottom]}>
          {[0, 1, 2, 3].map((col) => {
            const index = row * 4 + col;
            const selected = index === target;
            const value = selected && 'answer' in lesson ? lesson.answer
              : 'clue' in lesson && index === lesson.clue[0] ? lesson.clue[1] : EXAMPLE[index];
            const backgroundColor = selected ? palette.selected : marks.includes(index) ? palette.peer : palette.cell;
            const color = selected ? palette.selectedText : palette.text;
            return (
              <View key={col} style={[styles.exampleCell, { backgroundColor, borderColor: palette.line }, col === 1 && styles.boxSpaceRight]}>
                {value > 0 && <Text allowFontScaling={false} style={[styles.digit, { color }]}>{value}</Text>}
                {selected && value === 0 && <Text allowFontScaling={false} style={[styles.notes, { color }]}>2</Text>}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centres the tour on the screen, both ways.
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  tour: { width: '100%', maxWidth: TOUR_MAX_WIDTH, maxHeight: '100%', gap: spacing.md },
  progress: { gap: spacing.sm },
  step: { ...type.label, color: colors.accent },
  segments: { flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.line },
  segmentFilled: { backgroundColor: colors.accent },
  // The card keeps one size for every step; longer text scrolls inside it.
  card: { flex: 1, backgroundImage: gradients.panel },
  cardContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  title: { ...type.title, fontSize: 24, lineHeight: 30 },
  example: { width: '72%', maxWidth: 236, aspectRatio: 1, padding: 2, alignSelf: 'center', borderRadius: radius.sm, overflow: 'hidden' },
  exampleRow: { flex: 1, flexDirection: 'row' },
  exampleCell: { flex: 1, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  boxSpaceBottom: { marginBottom: 2 },
  boxSpaceRight: { marginRight: 2 },
  digit: { fontSize: 24, fontWeight: '800' },
  notes: { fontSize: 12, fontWeight: '700' },
  variantBoard: { alignItems: 'center' },
  caption: { ...type.dim, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
