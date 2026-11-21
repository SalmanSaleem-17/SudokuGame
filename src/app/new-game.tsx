import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { ENABLED_DIFFICULTIES } from '../data/pool';
import { DIFFICULTY_NAMES, Difficulty } from '../engine/grader';
import { appStore, startClassic } from '../state/app';
import { useStore } from '../state/store';
import { Button, Screen } from '../ui/controls';
import { spacing, type } from '../ui/theme';

const DESCRIPTIONS: Record<Difficulty, string> = {
  easy: 'Hidden singles only',
  medium: 'Naked and hidden singles',
  hard: 'Locked candidates and pairs',
  expert: 'Triples and X-Wings',
};

export default function NewGameScreen() {
  const router = useRouter();
  const current = useStore(appStore, (s) => s.sessions.classic);
  const inProgress = !!current && !current.completed && current.undo.length > 0;

  const begin = (difficulty: Difficulty) => {
    startClassic(difficulty);
    router.replace({ pathname: '/game', params: { slot: 'classic' } });
  };

  const choose = (difficulty: Difficulty) => {
    if (!inProgress) return begin(difficulty);
    Alert.alert('Start a new game?', 'Your current puzzle and its progress will be replaced.', [
      { text: 'Keep playing', style: 'cancel' },
      { text: 'Start new', style: 'destructive', onPress: () => begin(difficulty) },
    ]);
  };

  return (
    <Screen title="New Game">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.dim, styles.intro]}>Every puzzle has exactly one solution and can be solved by logic alone.</Text>
        {ENABLED_DIFFICULTIES.map((difficulty) => (
          <Button
            key={difficulty}
            label={DIFFICULTY_NAMES[difficulty]}
            detail={DESCRIPTIONS[difficulty]}
            onPress={() => choose(difficulty)}
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
