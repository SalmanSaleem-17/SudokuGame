import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

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

export default function HowToPlayScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const lesson = LESSONS[step];
  const last = step === LESSONS.length - 1;
  const close = () => router.canGoBack() ? router.back() : router.replace('/');

  return (
    <Screen title="How to Play" onBack={close}>
      <ScrollView key={step} contentContainerStyle={styles.content}>
        <View style={styles.progress} accessibilityLabel={`Card ${step + 1} of ${LESSONS.length}`} accessible>
          <Text style={styles.step}>Card {step + 1} of {LESSONS.length}</Text>
          <View style={styles.segments} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {LESSONS.map(({ title }, index) => <View key={title} style={[styles.segment, index <= step && styles.segmentFilled]} />)}
          </View>
        </View>
        <Card style={styles.card}>
          <Text accessibilityRole="header" style={type.title}>{lesson.title}</Text>
          <Text style={type.body}>{lesson.body}</Text>
          <ExampleBoard lesson={lesson} />
          <Text style={styles.caption}>{lesson.caption}</Text>
        </Card>
        <View style={styles.actions}>
          {step > 0 && <Button label="Previous" onPress={() => setStep(step - 1)} style={styles.action} />}
          <Button label={last ? 'Done' : 'Next'} variant="primary" trailingIcon={last ? 'checkmark' : 'chevron-forward'}
            onPress={last ? close : () => setStep(step + 1)} style={styles.action} />
        </View>
        {last && <Button label="Try a 4×4 puzzle" variant="ghost" onPress={() => router.replace({ pathname: '/alternate', params: { mode: 'mini-4' } })} />}
      </ScrollView>
    </Screen>
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
  content: { width: '100%', maxWidth: 500, alignSelf: 'center', padding: spacing.lg, gap: spacing.lg },
  progress: { gap: spacing.sm },
  step: { ...type.label, color: colors.accent },
  segments: { flexDirection: 'row', gap: spacing.xs },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.line },
  segmentFilled: { backgroundColor: colors.accent },
  card: { padding: spacing.lg, gap: spacing.md, backgroundImage: gradients.panel },
  example: { width: '72%', maxWidth: 236, aspectRatio: 1, padding: 2, alignSelf: 'center', borderRadius: radius.sm, overflow: 'hidden' },
  exampleRow: { flex: 1, flexDirection: 'row' },
  exampleCell: { flex: 1, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  boxSpaceBottom: { marginBottom: 2 },
  boxSpaceRight: { marginRight: 2 },
  digit: { fontSize: 24, fontWeight: '800' },
  notes: { fontSize: 12, fontWeight: '700' },
  caption: { ...type.dim, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
