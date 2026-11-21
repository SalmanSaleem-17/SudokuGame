import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { drillsOf } from '../../data/pool';
import { DRILL_TECHNIQUES } from '../../engine/pool';
import { DRILL_INFO } from '../../game/drills';
import { Button, Screen } from '../../ui/controls';
import { spacing, type } from '../../ui/theme';

export default function PracticeScreen() {
  const router = useRouter();
  return (
    <Screen title="Practice">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.dim, styles.intro]}>
          Short drills on real board positions. They work offline, and every explanation is free.
        </Text>
        {DRILL_TECHNIQUES.map((technique) => (
          <Button
            key={technique}
            label={DRILL_INFO[technique].name}
            detail={`${DRILL_INFO[technique].summary} · ${drillsOf(technique).length} drills`}
            onPress={() => router.push({ pathname: '/practice/[technique]', params: { technique } })}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.md, maxWidth: 520, width: '100%', alignSelf: 'center' },
  intro: { marginBottom: spacing.sm },
});
