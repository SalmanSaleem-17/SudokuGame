import { StyleSheet, Text, View } from 'react-native';

import { colors } from './theme';

export const WORDMARK = require('../../assets/sudoku-graphite-wordmark.png');
export const WORDMARK_ASPECT_RATIO = 1610 / 977;

export function BrandTitle({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel="Sudoku Studio">
      <Text style={[styles.wordmark, compact && styles.compact]}>
        Sud<Text style={styles.gold}>oku</Text>
      </Text>
      {!compact && <View style={styles.underline} />}
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center' },
  wordmark: {
    color: colors.text,
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -2,
    lineHeight: 51,
    textAlign: 'center',
    fontStyle: 'italic',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 5,
  },
  compact: { fontSize: 27, lineHeight: 30, letterSpacing: -0.8 },
  gold: { color: colors.accent },
  underline: { width: 100, height: 2, borderRadius: 1, backgroundColor: colors.accent },
});
