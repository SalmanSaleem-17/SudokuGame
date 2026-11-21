import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PEERS, colOf, digitsOf, hasDigit, rowOf } from '../engine/grid';
import { MARK_PATTERN, MARK_TARGET, MARK_UNIT } from '../game/overlay';
import { Motion } from './Motion';
import { colors, useReducedMotion } from './theme';

const MARK_NONE = 0;

export interface BoardProps {
  size: number;
  values: readonly number[];
  givens: readonly number[];
  notes: readonly number[];
  selected: number | null;
  /** Digit whose matching cells and notes are emphasised; 0 for none. */
  highlightDigit: number;
  /** Cells shown as errors (rule conflicts and, optionally, wrong entries). */
  errors: ReadonlySet<number>;
  /** Hint or drill marks per cell. */
  marks?: ReadonlyMap<number, number>;
  onCellPress: (cell: number) => void;
  disabled?: boolean;
}

const THIN = 1;
const THICK = 2;

/** Pixel layout: an outer frame, thick lines between boxes, thin lines between cells. */
function layout(size: number) {
  const lines = THICK * 4 + THIN * 6;
  const cell = (size - lines) / 9;
  const offset = (k: number) => THICK + k * cell + k * THIN + Math.floor(k / 3) * (THICK - THIN);
  return { cell, offset };
}

export const Board = memo(function Board(props: BoardProps) {
  const { size, values, givens, notes, selected, highlightDigit, errors, marks, onCellPress, disabled } = props;
  const { cell, offset } = useMemo(() => layout(size), [size]);
  const reducedMotion = useReducedMotion();
  const peers = useMemo(() => (selected === null ? null : new Set(PEERS[selected])), [selected]);

  const boxes = [];
  for (let b = 0; b < 9; b++) {
    const left = offset((b % 3) * 3);
    const top = offset(Math.floor(b / 3) * 3);
    const span = cell * 3 + THIN * 2;
    boxes.push(<View key={b} style={[styles.box, { left, top, width: span, height: span }]} />);
  }

  const cells = [];
  for (let i = 0; i < 81; i++) {
    cells.push(
      <Cell
        key={i}
        index={i}
        size={cell}
        left={offset(colOf(i))}
        top={offset(rowOf(i))}
        value={values[i]}
        notes={values[i] === 0 ? notes[i] : 0}
        given={givens[i] !== 0}
        selected={selected === i}
        peer={peers !== null && peers.has(i)}
        match={highlightDigit !== 0 && values[i] === highlightDigit}
        noteDigit={highlightDigit !== 0 && values[i] === 0 && hasDigit(notes[i], highlightDigit) ? highlightDigit : 0}
        error={errors.has(i)}
        mark={marks?.get(i) ?? MARK_NONE}
        onPress={onCellPress}
        disabled={!!disabled}
        animate={selected === i && !reducedMotion}
      />,
    );
  }

  return (
    <View style={[styles.board, { width: size, height: size }]} accessibilityLabel="Sudoku board">
      {boxes}
      {cells}
    </View>
  );
});

interface CellProps {
  index: number;
  size: number;
  left: number;
  top: number;
  value: number;
  notes: number;
  given: boolean;
  selected: boolean;
  peer: boolean;
  match: boolean;
  noteDigit: number;
  error: boolean;
  mark: number;
  onPress: (cell: number) => void;
  disabled: boolean;
  animate: boolean;
}

function describeCell(p: CellProps): string {
  const parts = [`Row ${rowOf(p.index) + 1}, column ${colOf(p.index) + 1}`];
  if (p.value !== 0) parts.push(p.given ? `${p.value}, given` : `${p.value}, your entry`);
  else if (p.notes !== 0) parts.push(`empty, notes ${digitsOf(p.notes).join(' ')}`);
  else parts.push('empty');
  if (p.error) parts.push('conflict');
  if (p.mark === MARK_PATTERN) parts.push('highlighted by hint');
  if (p.mark === MARK_TARGET) parts.push('affected by hint');
  return parts.join(', ');
}

/**
 * One cell. Memoised on primitive props, so a move re-renders only the cells whose
 * appearance changed.
 */
const Cell = memo(function Cell(p: CellProps) {
  const box = Math.floor(rowOf(p.index) / 3) + Math.floor(colOf(p.index) / 3);
  const background = p.selected
    ? colors.accent
    : p.match
      ? colors.accentSoft
      : p.mark === MARK_PATTERN || p.mark === MARK_TARGET
        ? colors.surfaceHigh
        : p.peer || p.mark === MARK_UNIT
          ? colors.cellPeer
          : box % 2 === 0 ? colors.cell : colors.cellAlternate;
  const digitColor = p.selected ? colors.onAccent : p.error ? colors.warn : p.given ? colors.text : colors.entry;
  const digit = (
    <Text
      style={[
        styles.digit,
        {
          fontSize: p.size * 0.6,
          lineHeight: p.size * 0.78,
          color: digitColor,
          fontWeight: p.given ? '700' : '500',
          textDecorationLine: p.error ? 'underline' : 'none',
        },
      ]}
      allowFontScaling={false}>
      {p.value}
    </Text>
  );

  return (
    <Pressable
      onPress={() => p.onPress(p.index)}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityLabel={describeCell(p)}
      accessibilityState={{ selected: p.selected }}
      style={[styles.cell, { left: p.left, top: p.top, width: p.size, height: p.size, backgroundColor: background }]}>
      {p.value !== 0 ? (
        p.animate && !p.given ? (
          <Motion key={p.value} variant="pop" reduced={false}>{digit}</Motion>
        ) : digit
      ) : p.notes !== 0 ? (
        <View style={styles.notes}>
          {[0, 1, 2].map((r) => (
            <View key={r} style={styles.noteRow}>
              {[1, 2, 3].map((k) => {
                const d = r * 3 + k;
                const on = hasDigit(p.notes, d);
                const strong = on && d === p.noteDigit;
                return (
                  <Text
                    key={d}
                    allowFontScaling={false}
                    style={[
                      styles.note,
                      { fontSize: p.size * 0.26, lineHeight: p.size * 0.31 },
                      strong && styles.noteStrong,
                      p.selected && { color: colors.onAccent },
                    ]}>
                    {on ? d : ' '}
                  </Text>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
      {/* Selection ring: selection is visible as a shape, not only as a fill colour. */}
      {p.selected && (
        <View pointerEvents="none" style={FILL}>
          <Motion variant="pop" reduced={!p.animate} style={styles.selectedRing} />
        </View>
      )}
      {p.mark === MARK_PATTERN && !p.selected && <View pointerEvents="none" style={styles.patternRing} />}
      {p.mark === MARK_TARGET && !p.selected && <View pointerEvents="none" style={styles.targetRing} />}
      {p.error && (
        <View pointerEvents="none" style={[styles.errorDot, { backgroundColor: p.selected ? colors.onAccent : colors.warn }]} />
      )}
    </Pressable>
  );
});

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  board: { backgroundColor: colors.lineStrong, borderRadius: 8, overflow: 'hidden' },
  box: { position: 'absolute', backgroundColor: colors.line },
  cell: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  digit: { textAlign: 'center', includeFontPadding: false, fontVariant: ['tabular-nums'] },
  notes: { ...FILL, padding: 1, justifyContent: 'center' },
  noteRow: { flexDirection: 'row' },
  note: { flex: 1, textAlign: 'center', color: colors.textDim, includeFontPadding: false },
  noteStrong: { color: colors.text, fontWeight: '800' },
  selectedRing: { ...FILL, borderWidth: 2, borderColor: colors.onAccent },
  patternRing: { ...FILL, borderWidth: 2, borderColor: colors.accent },
  targetRing: { ...FILL, borderWidth: 2, borderColor: colors.warn, borderStyle: 'dashed' },
  errorDot: { position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: 3 },
});
