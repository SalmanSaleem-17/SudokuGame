import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DIFFICULTIES, DIFFICULTY_NAMES } from '../engine/grader';
import { SPEED_MINUTES, speedBoardSize, type SpeedOptions } from '../game/eventSpeed';
import { Card } from './controls';
import { colors, spacing, radius, TOUCH, type } from './theme';

interface Props {
  options: SpeedOptions;
  onChange: (next: SpeedOptions) => void;
}

export function SpeedOptionsPicker({ options, onChange }: Props) {
  return (
    <Card style={styles.options}>
      <Text style={type.heading}>Board</Text>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Board difficulty">
        {DIFFICULTIES.map((difficulty) => {
          const selected = options.difficulty === difficulty;
          const size = speedBoardSize(difficulty);
          return (
            <Pressable
              key={difficulty}
              accessibilityRole="radio"
              accessibilityLabel={`${DIFFICULTY_NAMES[difficulty]}, ${size} by ${size}`}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange({ ...options, difficulty })}
              style={({ pressed }) => [styles.choice, styles.boardChoice, selected && styles.selected, pressed && styles.pressed]}>
              <Ionicons name={size < 9 ? 'apps-outline' : 'grid-outline'} size={20} color={selected ? colors.accent : colors.textDim} />
              <View style={styles.boardLabel}>
                <Text style={[styles.label, selected && styles.selectedLabel]}>{DIFFICULTY_NAMES[difficulty]}</Text>
                <Text style={type.dim}>{size}×{size}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={[type.heading, styles.timeLabel]}>Round length</Text>
      <Text style={type.dim}>Minutes</Text>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Round length in minutes">
        {SPEED_MINUTES.map((minutes) => {
          const selected = options.minutes === minutes;
          return (
            <Pressable
              key={minutes}
              accessibilityRole="radio"
              accessibilityLabel={`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange({ ...options, minutes })}
              style={({ pressed }) => [styles.choice, styles.minuteChoice, selected && styles.selected, pressed && styles.pressed]}>
              <Text style={[styles.label, selected && styles.selectedLabel]}>{minutes}</Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  options: { padding: spacing.md, gap: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: TOUCH, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, alignItems: 'center',
  },
  boardChoice: { flexDirection: 'row', flexBasis: '46%', flexGrow: 1, gap: spacing.sm, padding: spacing.sm },
  boardLabel: { flex: 1 },
  minuteChoice: { flexBasis: '16%', flexGrow: 1, minWidth: TOUCH, justifyContent: 'center', padding: spacing.xs },
  timeLabel: { marginTop: spacing.xs },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.8 },
  label: { ...type.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  selectedLabel: { color: colors.accent },
});
