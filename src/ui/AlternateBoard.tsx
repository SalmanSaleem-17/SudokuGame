import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { digitBit } from '../game/alternateRules';
import type { AlternatePuzzle } from '../game/alternateRules';
import { useBoardPalette } from './boardTheme';
import type { BoardPalette } from './boardTheme';

interface BoardProps {
  puzzle: AlternatePuzzle;
  edge: number;
  values: readonly number[];
  notes: readonly number[];
  selected: number | null;
  highlightDigit: number;
  errors: ReadonlySet<number>;
  disabled?: boolean;
  onSelect: (cell: number) => void;
}

export const AlternateBoard = memo(function AlternateBoard({
  puzzle, edge, values, notes, selected, highlightDigit, errors, disabled = false, onSelect,
}: BoardProps) {
  const palette = useBoardPalette();
  const { size, regions, cageOf, cages } = puzzle;
  const frame = 3;
  const cellEdge = (edge - frame * 2) / size;
  const peers = selected !== null ? puzzle.peers[selected] : [];
  const boundary = (cell: number, other: number) => regions[cell] !== regions[other] ? 2 : StyleSheet.hairlineWidth;
  const rows = Array.from({ length: size }, (_, row) => (
    <View key={row} style={styles.row}>
      {Array.from({ length: size }, (_, col) => {
        const cell = row * size + col;
        const cage = cageOf[cell];
        const total = cage >= 0 && cages[cage].cells[0] === cell ? cages[cage].sum : undefined;
        return (
          <AlternateCell
            key={cell}
            cell={cell}
            size={size}
            edge={cellEdge}
            value={values[cell]}
            notes={notes[cell]}
            given={puzzle.givens[cell] > 0}
            selected={cell === selected}
            peer={peers.includes(cell)}
            matched={highlightDigit > 0 && values[cell] === highlightDigit}
            error={errors.has(cell)}
            disabled={disabled}
            region={regions[cell]}
            diagonal={puzzle.mode === 'diagonal' && (row === col || row + col === size - 1)}
            cage={cage}
            sum={cage >= 0 ? cages[cage].sum : undefined}
            cageTotal={total}
            cageTop={cage >= 0 && (row === 0 || cageOf[cell - size] !== cage)}
            cageBottom={cage >= 0 && (row === size - 1 || cageOf[cell + size] !== cage)}
            cageLeft={cage >= 0 && (col === 0 || cageOf[cell - 1] !== cage)}
            cageRight={cage >= 0 && (col === size - 1 || cageOf[cell + 1] !== cage)}
            rightWidth={col < size - 1 ? boundary(cell, cell + 1) : 0}
            bottomWidth={row < size - 1 ? boundary(cell, cell + size) : 0}
            onSelect={onSelect}
            palette={palette}
          />
        );
      })}
    </View>
  ));
  return (
    <View
      accessibilityLabel={`${size} by ${size} Sudoku board`}
      style={[styles.board, { width: edge, height: edge, borderWidth: frame, borderColor: palette.frame }]}>
      {rows}
    </View>
  );
});

interface CellProps {
  cell: number;
  size: number;
  edge: number;
  value: number;
  notes: number;
  given: boolean;
  selected: boolean;
  peer: boolean;
  matched: boolean;
  error: boolean;
  disabled: boolean;
  region: number;
  diagonal: boolean;
  cage: number;
  sum: number | undefined;
  cageTotal: number | undefined;
  cageTop: boolean;
  cageBottom: boolean;
  cageLeft: boolean;
  cageRight: boolean;
  rightWidth: number;
  bottomWidth: number;
  palette: BoardPalette;
  onSelect: (cell: number) => void;
}

const AlternateCell = memo(function AlternateCell({
  cell, size, edge, value, notes, given, selected, peer, matched, error, disabled,
  region, diagonal, cage, sum, cageTotal, cageTop, cageBottom, cageLeft, cageRight,
  rightWidth, bottomWidth, palette, onSelect,
}: CellProps) {
  const digits = Array.from({ length: size }, (_, digit) => digit + 1);
  const notesLabel = notes ? `, notes ${digits.filter((digit) => notes & digitBit(digit)).join(' ')}` : '';
  const extra = (sum !== undefined ? `, cage ${cage + 1}, total ${sum}` : '')
    + (diagonal ? ', diagonal' : '') + (error ? ', conflict' : '');
  const contentLabel = value ? `${value}, ${given ? 'given' : 'your entry'}` : `empty${notesLabel}`;
  const backgroundColor = selected ? palette.selected
    : error ? palette.errorCell
    : matched ? palette.match
    : peer ? palette.peer
    : region % 2 ? palette.alternate : palette.cell;
  const digitColor = selected ? error ? palette.selectedError : palette.selectedText
    : error ? palette.error
    : matched ? palette.matchText
    : given ? palette.text : palette.entry;
  const markColor = selected ? palette.selectedText : palette.hint;
  const totalSize = Math.min(13, Math.max(8, Math.round(edge * 0.31)));
  const noteColumns = size === 4 ? 2 : 3;
  const noteRows = Math.ceil(size / noteColumns);
  return (
    <Pressable
      onPress={() => onSelect(cell)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Row ${Math.floor(cell / size) + 1}, column ${cell % size + 1}, ${contentLabel}${extra}`}
      accessibilityState={{ selected, disabled }}
      style={[
        styles.cell,
        {
          backgroundColor,
          borderRightWidth: rightWidth,
          borderRightColor: rightWidth > 1 ? palette.frame : palette.line,
          borderBottomWidth: bottomWidth,
          borderBottomColor: bottomWidth > 1 ? palette.frame : palette.line,
        },
      ]}>
      {selected && <View pointerEvents="none" style={[styles.selection, { borderColor: palette.selection }]} />}
      {cage >= 0 && (
        <View
          pointerEvents="none"
          style={[
            styles.cage,
            {
              top: cageTop ? 2 : 0,
              bottom: cageBottom ? 2 : -bottomWidth,
              left: cageLeft ? 2 : 0,
              right: cageRight ? 2 : -rightWidth,
              borderColor: markColor,
              borderTopWidth: cageTop ? 1 : 0,
              borderBottomWidth: cageBottom ? 1 : 0,
              borderLeftWidth: cageLeft ? 1 : 0,
              borderRightWidth: cageRight ? 1 : 0,
            },
          ]}
        />
      )}
      {cageTotal !== undefined && (
        <Text accessible={false} allowFontScaling={false} style={[styles.total, { color: markColor, fontSize: totalSize }]}>{cageTotal}</Text>
      )}
      {diagonal && <View pointerEvents="none" style={[styles.diagonal, { backgroundColor: markColor }]} />}
      {value ? (
        <Text
          allowFontScaling={false}
          style={[
            styles.number,
            {
              color: digitColor,
              fontSize: edge * (cageTotal === undefined ? 0.58 : 0.51),
              fontWeight: given ? '800' : '600',
              marginTop: cageTotal === undefined ? 0 : totalSize - 1,
              textDecorationLine: error ? 'underline' : 'none',
            },
          ]}>
          {value}
        </Text>
      ) : notes ? (
        <View
          accessible={false}
          style={[
            styles.notes,
            { width: edge * 0.82, height: edge * (cageTotal === undefined ? 0.80 : 0.62), marginTop: cageTotal === undefined ? 0 : totalSize - 1 },
          ]}>
          {digits.map((digit) => (
            <Text
              key={digit}
              allowFontScaling={false}
              style={[
                styles.note,
                {
                  width: `${100 / noteColumns}%`,
                  height: `${100 / noteRows}%`,
                  fontSize: edge * (cageTotal === undefined ? 0.24 : 0.19),
                  color: selected ? palette.selectedText : palette.notes,
                },
              ]}>
              {notes & digitBit(digit) ? digit : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  board: { overflow: 'hidden', borderRadius: 10, alignSelf: 'center' },
  row: { flexDirection: 'row', flex: 1 },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  selection: { ...StyleSheet.absoluteFill, borderWidth: 1.5, borderRadius: 2 },
  cage: { position: 'absolute' },
  total: { position: 'absolute', top: 2, left: 4, fontWeight: '800', includeFontPadding: false, fontVariant: ['tabular-nums'] },
  diagonal: { position: 'absolute', left: 3, top: 3, width: 4, height: 4, borderRadius: 2 },
  number: { includeFontPadding: false, textAlign: 'center', fontVariant: ['tabular-nums'] },
  notes: { flexDirection: 'row', flexWrap: 'wrap' },
  note: { includeFontPadding: false, fontWeight: '600', textAlign: 'center' },
});
