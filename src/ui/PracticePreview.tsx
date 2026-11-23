import { StyleSheet, Text, View } from 'react-native';

import type { DrillTechnique } from '../engine/pool';
import { colors, radius } from './theme';

interface TechniqueStyle {
  accent: string;
  edge: string;
  tile: string;
  gradient: string;
  sample: readonly (readonly (number | null)[])[];
  highlighted: readonly number[];
  showNotes?: boolean;
}

export const PRACTICE_STYLES: Record<DrillTechnique, TechniqueStyle> = {
  nakedSingle: {
    accent: '#B8CEDF',
    edge: '#495765',
    tile: '#303B46',
    gradient: 'linear-gradient(135deg, #292F37, #1E2229 67%, #191C22)',
    sample: [[2, 8, 3], [7, 5, 1], [4, 6, 9]],
    highlighted: [4],
  },
  hiddenSingle: {
    accent: '#B7D1C1',
    edge: '#49594F',
    tile: '#33423A',
    gradient: 'linear-gradient(135deg, #28312D, #1E2621 67%, #191E1B)',
    sample: [[4, 3, null], [null, 8, null], [6, null, 9]],
    highlighted: [4],
  },
  lockedCandidates: {
    accent: colors.accent,
    edge: '#6B573B',
    tile: '#443A2C',
    gradient: 'linear-gradient(135deg, #332C22, #27221C 67%, #1D1B18)',
    sample: [[null, 2, null], [4, null, 4], [null, 6, 7]],
    highlighted: [3, 5],
    showNotes: true,
  },
};

export function PracticePreview({ technique, large }: { technique: DrillTechnique; large?: boolean }) {
  const { accent, edge, tile, sample, highlighted, showNotes } = PRACTICE_STYLES[technique];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.preview, large && styles.previewLarge, { borderColor: edge }]}>
      {sample.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((value, column) => {
            const selected = highlighted.includes(rowIndex * 3 + column);
            return (
              <View key={column} style={[styles.cell, { backgroundColor: selected ? accent : tile }]}>
                {value !== null && (
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.digit,
                      large && styles.digitLarge,
                      selected && styles.selectedDigit,
                      selected && showNotes && styles.note,
                    ]}>
                    {value}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    width: 66,
    height: 66,
    padding: 5,
    gap: 3,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.bg,
  },
  previewLarge: { width: 84, height: 84, padding: 6 },
  row: { flex: 1, flexDirection: 'row', gap: 3 },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 3 },
  digit: { color: colors.text, fontSize: 11, fontWeight: '700', includeFontPadding: false },
  digitLarge: { fontSize: 15 },
  selectedDigit: { color: colors.bg },
  note: { position: 'absolute', start: 2, top: 1, fontSize: 8 },
});
