import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, gameControlSurfaces, radius } from './theme';

interface KeypadProps {
  /** Placed count per digit. Digits with all copies placed are dimmed. */
  counts?: readonly number[];
  digitCount?: 4 | 6 | 9;
  /** Digit armed for number-first entry; 0 for none. */
  activeDigit?: number;
  notesMode?: boolean;
  keyHeight?: number;
  onDigit: (digit: number) => void;
  /** Split digits into two rows for practice drills. */
  twoRows?: boolean;
  /** Arrange digits in a three-by-three grid. */
  grid?: boolean;
  disabled?: boolean;
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const TWO_ROWS = [DIGITS.slice(0, 5), DIGITS.slice(5)];
const GRID = [DIGITS.slice(0, 3), DIGITS.slice(3, 6), DIGITS.slice(6)];
const MINI_FOUR = [DIGITS.slice(0, 4)];
const MINI_SIX = GRID.slice(0, 2);

export const Keypad = memo(function Keypad({
  counts,
  digitCount = 9,
  activeDigit = 0,
  notesMode,
  keyHeight = 56,
  onDigit,
  twoRows,
  grid,
  disabled,
}: KeypadProps) {
  const rows = digitCount === 4 ? MINI_FOUR : digitCount === 6 ? MINI_SIX : grid ? GRID : twoRows ? TWO_ROWS : [DIGITS];
  const height = { height: keyHeight };
  return (
    <View style={styles.rows} accessibilityLabel={notesMode ? 'Digits, notes mode' : 'Digits'}>
      {rows.map((digits) => (
        <View key={digits[0]} style={styles.row}>
          {digits.map((d) => {
            const remaining = counts ? digitCount - counts[d] : null;
            const done = remaining !== null && remaining <= 0;
            const selected = activeDigit === d;
            const active = selected && !disabled;
            return (
              <Pressable
                key={d}
                onPress={() => onDigit(d)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={
                  remaining === null ? `${d}` : done ? `${d}, all placed` : `${d}, ${remaining} left`
                }
                accessibilityState={{ selected, disabled: !!disabled }}
                style={({ pressed }) => [
                  styles.key,
                  height,
                  gameControlSurfaces.key,
                  (done || disabled) && gameControlSurfaces.keyQuiet,
                  active && gameControlSurfaces.active,
                  pressed && !disabled && (active ? styles.keyActivePressed : gameControlSurfaces.keyPressed),
                  disabled && styles.keyDisabled,
                ]}>
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.digit,
                    remaining !== null && !grid && styles.digitStacked,
                    notesMode && styles.digitNotes,
                    done && styles.digitDone,
                    active && styles.digitActive,
                  ]}>
                  {d}
                </Text>
                {remaining !== null && (
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.count,
                      grid && styles.countCorner,
                      done && styles.countDone,
                      active && styles.countActive,
                    ]}>
                    {done ? '✓' : remaining}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  rows: { gap: 4 },
  row: { flexDirection: 'row', gap: 4 },
  key: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderBottomWidth: 2,
  },
  keyActivePressed: { opacity: 0.82, transform: [{ translateY: 1 }] },
  keyDisabled: { opacity: 0.6 },
  digit: {
    fontSize: 27, lineHeight: 30, fontWeight: '800', color: '#FFF9EE',
    includeFontPadding: false, fontVariant: ['tabular-nums'],
  },
  digitStacked: { fontSize: 23, lineHeight: 25 },
  digitNotes: { fontSize: 22, lineHeight: 24, color: colors.accent },
  digitDone: { color: '#A4A19A' },
  digitActive: { color: colors.onAccent },
  count: {
    minWidth: 17, borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1,
    backgroundColor: '#392E20', color: '#F0D29D', textAlign: 'center',
    fontSize: 11, lineHeight: 13, fontWeight: '700', includeFontPadding: false, fontVariant: ['tabular-nums'],
  },
  countCorner: { position: 'absolute', end: 6, bottom: 5 },
  countDone: { backgroundColor: '#2C2D2A', color: '#BBC3B1' },
  countActive: { backgroundColor: '#E3A430', color: colors.onAccent },
});
