import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { listPlayNowSaves, type SavedGame } from '../game/savedGames';
import { appStore, quitMiniClassic, quitSession } from '../state/app';
import { useStore } from '../state/store';
import { Button, Card, IconButton, Screen } from '../ui/controls';
import { colors, gradients, radius, spacing, type } from '../ui/theme';

export default function SavedGamesScreen() {
  const router = useRouter();
  const classic = useStore(appStore, (state) => state.sessions.classic);
  const mini = useStore(appStore, (state) => state.miniClassic);
  const games = listPlayNowSaves(classic, mini);
  const busy = useRef(false);
  const [quitting, setQuitting] = useState(false);
  const [message, setMessage] = useState('');

  const quit = async (game: SavedGame) => {
    if (busy.current) return;
    busy.current = true;
    setQuitting(true);
    setMessage('');
    try {
      const removed = await (game.kind === 'mini' ? quitMiniClassic(game.id) : quitSession('classic', game.id));
      if (!removed) setMessage('This game is no longer available to quit.');
    } catch {
      setMessage('Could not quit this game. Try again.');
    } finally {
      busy.current = false;
      setQuitting(false);
    }
  };

  const confirmQuit = (game: SavedGame) => {
    Alert.alert(`Quit ${game.title}?`, 'This will discard your progress on this puzzle.', [
      { text: 'Keep Game', style: 'cancel' },
      { text: 'Quit Game', style: 'destructive', onPress: () => { void quit(game); } },
    ]);
  };

  return (
    <Screen title="Saved Games">
      <ScrollView contentContainerStyle={styles.content}>
        {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
        {games.length === 0 ? (
          <Card style={styles.empty}>
            <Ionicons name="bookmark-outline" size={30} color={colors.accent} />
            <Text style={type.heading} accessibilityRole="header">No saved games</Text>
            <Text style={styles.emptyDetail}>Puzzles started from Play Now appear here when you leave the board.</Text>
            <Button label="Play Now" icon="play" variant="primary" onPress={() => router.push('/new-game')} />
          </Card>
        ) : games.map((game) => (
          <Card key={game.id} style={styles.saved}>
            <View style={styles.heading}>
              <View style={styles.boardIcon}>
                <Ionicons name={game.solved ? 'checkmark-circle-outline' : game.kind === 'mini' ? 'apps-outline' : 'grid-outline'} size={23} color={colors.accent} />
              </View>
              <View style={styles.headingText}>
                <Text style={type.heading} accessibilityRole="header">{game.title}</Text>
                <Text style={type.dim}>{game.detail}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Button
                label={game.solved ? 'Save Result' : 'Resume'}
                accessibilityHint={`${game.solved ? 'Save the result for' : 'Resume'} ${game.title}`}
                icon={game.solved ? 'checkmark' : 'play'}
                variant="primary"
                style={styles.resume}
                disabled={quitting}
                onPress={() => router.push(game.href)}
              />
              {!game.solved && (
                <IconButton
                  icon="trash-outline"
                  label={`Quit ${game.title}`}
                  color={colors.warn}
                  disabled={quitting}
                  onPress={() => confirmQuit(game)}
                />
              )}
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  saved: { padding: spacing.lg, gap: spacing.md, backgroundImage: gradients.panel },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headingText: { flex: 1 },
  boardIcon: {
    width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resume: { flex: 1 },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.md, backgroundImage: gradients.panel },
  emptyDetail: { ...type.dim, textAlign: 'center' },
  message: { ...type.dim, color: colors.warn },
});
