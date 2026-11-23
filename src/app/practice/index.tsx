import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { drillsOf } from '../../data/pool';
import { DRILL_TECHNIQUES } from '../../engine/pool';
import { DRILL_INFO } from '../../game/drills';
import { Button, Card, Screen } from '../../ui/controls';
import { PRACTICE_STYLES, PracticePreview } from '../../ui/PracticePreview';
import { colors, radius, spacing, type } from '../../ui/theme';

export default function PracticeScreen() {
  const router = useRouter();
  return (
    <Screen title="Practice">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <View style={styles.introIcon}>
            <Ionicons name="school-outline" size={27} color={colors.accent} />
          </View>
          <View style={styles.introText}>
            <Text style={styles.introTitle} accessibilityRole="header">Learn by solving</Text>
            <Text style={type.dim}>Pick a technique to try on a real board.</Text>
          </View>
        </View>
        <Button
          label="Technique Packs"
          detail="Full puzzles for Pairs, Triples, and X-Wing"
          icon="layers-outline"
          trailingIcon="chevron-forward"
          onPress={() => router.push('/practice/packs')}
        />
        {DRILL_TECHNIQUES.map((technique) => {
          const { title, summary } = DRILL_INFO[technique];
          const drills = `${drillsOf(technique).length} drills`;
          const { accent, edge, gradient } = PRACTICE_STYLES[technique];
          return (
            <Card key={technique} style={{ borderColor: edge, backgroundImage: gradient }}>
              <Pressable
                onPress={() => router.push({ pathname: '/practice/[technique]', params: { technique } })}
                accessibilityRole="button"
                accessibilityLabel={`${title}. ${summary} ${drills}.`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                <PracticePreview technique={technique} />
                <View style={styles.technique}>
                  <Text style={styles.techniqueTitle}>{title}</Text>
                  <Text style={type.dim}>{summary}</Text>
                  <Text style={[styles.drills, { color: accent }]}>{drills}</Text>
                </View>
                <View style={[styles.arrow, { borderColor: edge }]}>
                  <Ionicons name="chevron-forward" size={17} color={accent} />
                </View>
              </Pressable>
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, maxWidth: 520, width: '100%', alignSelf: 'center' },
  intro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  introIcon: {
    width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accentSoft, borderColor: '#655136', borderWidth: 1,
  },
  introText: { flex: 1, gap: spacing.xs },
  introTitle: { ...type.title, fontSize: 25, letterSpacing: -0.45 },
  row: { minHeight: 116, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowPressed: { backgroundColor: 'rgba(255, 255, 255, 0.10)' },
  technique: { flex: 1, gap: spacing.xs },
  techniqueTitle: { ...type.heading, fontSize: 18 },
  drills: { ...type.label, letterSpacing: 0.2 },
  arrow: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
