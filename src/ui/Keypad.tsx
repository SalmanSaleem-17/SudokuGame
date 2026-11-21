import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from './theme';

interface KeypadProps {
  /** Placed count per digit, index 1-9. Digits with nine placed are dimmed. */
  counts?: readonly number[];
  /** Digit armed for number-first entry; 0 for none. */
  activeDigit?: number;
  notesMode?: boolean;
  keyHeight?: number;
  onDigit: (digit: number) => void;
  disabled?: boolean;
}

export const Keypad = memo(function Keypad({ counts, activeDigit = 0, notesMode, keyHeight = 56, onDigit, disabled }: KeypadProps) {
  return (
    <View style={styles.row} accessibilityLabel={notesMode ? 'Digits, notes mode' : 'Digits'}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
        const remaining = counts ? 9 - counts[d] : null;
        const done = remaining !== null && remaining <= 0;
        const active = activeDigit === d;
        return (
          <Pressable
            key={d}
            onPress={() => onDigit(d)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={
              remaining === null ? `${d}` : done ? `${d}, all placed` : `${d}, ${remaining} left`
            }
            accessibilityState={{ selected: active, disabled: !!disabled }}
            style={({ pressed }) => [
              styles.key,
              { height: keyHeight },
              active && styles.keyActive,
              pressed && (active ? styles.keyActivePressed : styles.keyPressed),
            ]}>
            <Text
              allowFontScaling={false}
              style={[styles.digit, notesMode && styles.digitNotes, done && styles.digitDone, active && styles.digitActive]}>
              {d}
            </Text>
            {remaining !== null && (
              <Text allowFontScaling={false} style={[styles.count, active && styles.digitActive]}>
                {done ? '✓' : remaining}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 3 },
  key: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderBottomWidth: 3,
  },
  keyPressed: { backgroundColor: colors.surfaceHigh },
  keyActive: { backgroundColor: colors.accent, borderColor: colors.onAccent, borderWidth: 2 },
  keyActivePressed: { backgroundColor: colors.accentPressed },
  digit: { fontSize: 25, fontWeight: '700', color: colors.text, includeFontPadding: false, fontVariant: ['tabular-nums'] },
  digitNotes: { fontSize: 20, color: colors.entry },
  digitDone: { color: colors.textFaint },
  digitActive: { color: colors.onAccent },
  count: { fontSize: 11, color: colors.textFaint, marginTop: 1, includeFontPadding: false },
});
