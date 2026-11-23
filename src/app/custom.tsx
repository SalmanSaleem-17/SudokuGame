import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DIFFICULTY_NAMES, gradePuzzle } from '../engine/grader';
import { findConflicts, serializeGrid } from '../engine/grid';
import type { PuzzleRecord } from '../engine/pool';
import { countSolutions, solve } from '../engine/solver';
import { digitCounts, getSessionFailure } from '../game/session';
import { appStore, startCustom } from '../state/app';
import { useStore } from '../state/store';
import { Board } from '../ui/Board';
import { Keypad } from '../ui/Keypad';
import { Button, Screen } from '../ui/controls';
import { haptic, useBoardSize } from '../ui/hooks';
import { colors, spacing, TOUCH, type } from '../ui/theme';

/** Fewer givens than this can never give a single solution. */
const MIN_GIVENS = 17;
const EMPTY: readonly number[] = new Array<number>(81).fill(0);
const NO_NOTES: readonly number[] = EMPTY;

/** A stable id for a typed-in puzzle, so the same puzzle is recognised if entered again. */
function customId(givens: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < givens.length; i++) hash = Math.imul(hash ^ givens.charCodeAt(i), 0x01000193);
  return `custom-${(hash >>> 0).toString(36)}`;
}

/** Checks a typed-in grid. Returns the playable puzzle, or a message saying what to fix. */
function checkPuzzle(values: readonly number[]): { puzzle: PuzzleRecord } | { problem: string } {
  const given = values.filter((value) => value !== 0).length;
  if (given < MIN_GIVENS) return { problem: `Enter at least ${MIN_GIVENS} digits. You have entered ${given}.` };
  if (findConflicts(values).size > 0) return { problem: 'The same digit appears twice in a row, column or box. The marked cells need fixing.' };
  const solutions = countSolutions(values, 2);
  if (solutions === 0) return { problem: 'This puzzle has no solution. Check the digits against your source.' };
  if (solutions > 1) return { problem: 'This puzzle has more than one solution, so some digits are missing. Check it against your source.' };
  const grade = gradePuzzle(values);
  const givens = serializeGrid(values);
  return {
    puzzle: {
      id: customId(givens),
      // A puzzle beyond the built-in techniques still plays; it is filed under Expert.
      difficulty: grade.difficulty ?? 'expert',
      givens,
      solution: serializeGrid(solve(values)!),
      score: grade.score,
      techniques: grade.techniques,
    },
  };
}

export default function CustomPuzzleScreen() {
  const router = useRouter();
  const classic = useStore(appStore, (s) => s.sessions.classic);
  const [values, setValues] = useState<readonly number[]>(EMPTY);
  const [selected, setSelected] = useState<number | null>(40);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const boardSize = useBoardSize(58 + TOUCH * 3 + 190, 12);

  const errors = useMemo(() => findConflicts(values), [values]);
  const counts = useMemo(() => digitCounts(values), [values]);
  const given = 81 - counts[0];

  const setCell = useCallback((digit: number) => {
    if (selected === null) return;
    setProblem(null);
    setValues((current) => {
      const next = current.slice();
      next[selected] = current[selected] === digit ? 0 : digit;
      return next;
    });
    haptic('tap');
  }, [selected]);

  const play = (puzzle: PuzzleRecord) => {
    startCustom(puzzle);
    router.replace({ pathname: '/game', params: { slot: 'classic' } });
  };

  const check = () => {
    if (checking) return;
    setChecking(true);
    setProblem(null);
    // Let "Checking…" paint before the solver runs.
    setTimeout(() => {
      const result = checkPuzzle(values);
      setChecking(false);
      if ('problem' in result) {
        setProblem(result.problem);
        haptic('warn');
        return;
      }
      const busy = classic && !classic.completed && !getSessionFailure(classic) && classic.undo.length > 0;
      if (!busy) return play(result.puzzle);
      Alert.alert('Start this puzzle?', 'Your current Play Now puzzle and its progress will be replaced.', [
        { text: 'Keep playing', style: 'cancel' },
        { text: 'Start', style: 'destructive', onPress: () => play(result.puzzle) },
      ]);
    }, 30);
  };

  const clearAll = () => {
    setValues(EMPTY);
    setProblem(null);
  };

  return (
    <Screen title="Your Puzzle">
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={[type.dim, { width: boardSize }]}>
          Copy a puzzle from a newspaper or book. Tap a cell, then a digit. You get the same checking and hints as any other game.
        </Text>
        <View style={styles.boardFrame}>
          <Board
            size={boardSize}
            values={values}
            givens={values}
            notes={NO_NOTES}
            selected={selected}
            highlightDigit={selected !== null ? values[selected] : 0}
            errors={errors}
            onCellPress={setSelected}
          />
        </View>
        <View style={[styles.controls, { width: boardSize }]}>
          <Keypad grid counts={counts} activeDigit={selected !== null ? values[selected] : 0} keyHeight={TOUCH} onDigit={setCell} />
          <View style={styles.status}>
            <Text style={type.dim} accessibilityLabel={`${given} digits entered`}>{given} of 81 entered</Text>
            <Button label="Clear all" variant="ghost" icon="trash-outline" onPress={clearAll} disabled={given === 0 || checking} />
          </View>
          {problem && <Text accessibilityLiveRegion="polite" style={styles.problem}>{problem}</Text>}
          <Button
            label={checking ? 'Checking…' : 'Check and play'}
            variant="primary"
            icon="play"
            onPress={check}
            disabled={checking || given === 0}
            style={styles.start}
          />
          <Text style={styles.note}>
            The puzzle must have exactly one solution. Its difficulty ({Object.values(DIFFICULTY_NAMES).join(', ')}) is worked out when you start.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  boardFrame: { backgroundColor: colors.surface, borderColor: colors.lineStrong, borderWidth: 1, borderRadius: 6 },
  controls: { gap: spacing.sm },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  problem: { ...type.dim, color: colors.warn },
  start: { minHeight: 54 },
  note: { ...type.dim, fontSize: 12, lineHeight: 16 },
});
