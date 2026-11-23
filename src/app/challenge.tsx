import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, type ScrollViewInstance, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { DIFFICULTY_NAMES } from '../engine/grader';
import { type Challenge, decodeChallenge, describeChallengeRules } from '../game/challenge';
import { STORE_URL } from '../game/links';
import { getSessionFailure } from '../game/session';
import { appStore, startChallenge } from '../state/app';
import { formatTime } from '../state/clock';
import { useStore } from '../state/store';
import type { Completion } from '../storage/repository';
import { Button, Card, IconButton, type IconName, Screen } from '../ui/controls';
import { colors, gradients, radius, spacing, TOUCH, type } from '../ui/theme';
import { useCompletionHistory } from '../ui/useCompletionHistory';

type Preview = { challenge: Challenge; error?: never } | { error: string; challenge?: never };

function readChallenge(text: string): Preview {
  try {
    return { challenge: decodeChallenge(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Check the challenge code and try again.' };
  }
}

function resultCodeInput(text: string): boolean {
  return /\bSDR\d+[-\u2010-\u2015\u2212]/i.test(text);
}

export default function ChallengeScreen() {
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams<{ code?: string | string[] }>();
  const code = typeof codeParam === 'string' ? codeParam : '';
  const saved = useStore(appStore, (state) => state.sessions.challenge);
  const completions = useCompletionHistory();
  const scroll = useRef<ScrollViewInstance>(null);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [actionError, setActionError] = useState('');
  const [sharing, setSharing] = useState(false);
  const savedCode = saved?.challengeCode ?? null;
  const preview = useMemo(() => code ? readChallenge(code) : null, [code]);
  const savedPreview = useMemo(() => savedCode ? readChallenge(savedCode) : null, [savedCode]);
  const challenge = preview?.challenge ?? savedPreview?.challenge;
  const savedMatch = !!saved && !!challenge && savedCode === challenge.code;
  const results = useMemo(() => (completions ?? []).filter((result) => result.challengeCode).reverse(), [completions]);
  const matchingResult = challenge && results.find((result) => result.challengeCode === challenge.code);
  const savedResultPending = savedMatch && saved.completed && !results.some((result) => result.sessionId === saved.id);
  const unfinishedMatch = savedMatch && !saved.completed;
  const failure = unfinishedMatch ? getSessionFailure(saved) : null;
  const checkingResults = !unfinishedMatch && completions === undefined;
  const resultToOpen = !unfinishedMatch && !savedResultPending ? matchingResult : undefined;

  const showResult = (id: string) => router.push({ pathname: '/results', params: { id } });

  const enterCode = () => {
    setInputError('');
    const text = input.trim();
    if (!text) {
      setInputError('Paste a challenge code to continue.');
      return;
    }
    const next = readChallenge(text);
    if (!next.challenge) {
      setInputError(resultCodeInput(text)
        ? 'Open your matching game under Recent results to compare this result code.'
        : next.error);
      return;
    }
    Keyboard.dismiss();
    setInput('');
    setActionError('');
    router.setParams({ code: next.challenge.code });
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const closePreview = () => {
    setActionError('');
    router.setParams({ code: '' });
  };

  const shareChallenge = async (selected: Challenge) => {
    setSharing(true);
    setActionError('');
    try {
      await Share.share({
        title: 'Sudoku Studio challenge',
        message: [
          'Try my Sudoku Studio challenge',
          `${DIFFICULTY_NAMES[selected.puzzle.difficulty]} · ${describeChallengeRules(selected.rules)}`,
          '',
          selected.code,
          '',
          'Open Challenge a Friend in Sudoku Studio and paste this message.',
          '',
          `Get Sudoku Studio: ${STORE_URL}`,
        ].join('\n'),
      });
    } catch {
      setActionError('Sharing is unavailable. Press and hold the challenge code to copy it.');
    } finally {
      setSharing(false);
    }
  };

  const playChallenge = (selected: Challenge) => {
    setActionError('');
    const play = () => {
      try {
        startChallenge(selected);
        router.push({ pathname: '/game', params: { slot: 'challenge' } });
      } catch {
        setActionError('This challenge could not be started. Please try again.');
      }
    };
    const current = appStore.getState().sessions.challenge;
    if (current && current.challengeCode !== selected.code) {
      const pendingSave = current.completed && !results.some((result) => result.sessionId === current.id);
      const inProgress = !current.completed && !getSessionFailure(current);
      if (pendingSave || inProgress) {
        Alert.alert('Start a different challenge?', pendingSave
          ? 'This will replace a solved challenge whose result is waiting to be saved.'
          : 'This will replace the challenge you have in progress.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Start challenge', style: 'destructive', onPress: play },
        ]);
        return;
      }
    }
    play();
  };

  const previewTitle = savedResultPending ? 'Challenge solved'
    : unfinishedMatch ? (failure ? 'Challenge ended' : 'Challenge in progress')
      : matchingResult ? 'Challenge completed' : 'Challenge ready';
  const playLabel = checkingResults ? 'Checking results…'
    : savedResultPending ? 'Save result'
      : unfinishedMatch ? (failure ? 'Try again' : 'Resume challenge')
        : resultToOpen ? 'View result' : 'Play challenge';

  return (
    <Screen title="Challenges">
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {preview?.error ? <ErrorText>{preview.error}</ErrorText> : null}
        {challenge && (
          <Card style={styles.preview}>
            <View style={styles.previewHeading}>
              <View style={styles.headingTitle}><Heading icon="grid-outline" title={previewTitle} /></View>
              {preview?.challenge && !savedMatch && <IconButton icon="close" label="Close challenge preview" onPress={closePreview} />}
            </View>
            <Text style={type.body}>{DIFFICULTY_NAMES[challenge.puzzle.difficulty]} puzzle</Text>
            <Text style={type.dim}>{describeChallengeRules(challenge.rules)}</Text>
            <View style={styles.codeBox}>
              <Text style={type.label}>Challenge code</Text>
              <Text selectable selectionColor={colors.accentSoft} style={styles.code}>{challenge.code}</Text>
              <Text style={type.dim}>Press and hold to copy.</Text>
            </View>
            <Button
              label={playLabel}
              icon={savedResultPending ? 'save-outline' : resultToOpen ? 'trophy-outline' : 'play'}
              variant="primary"
              disabled={checkingResults}
              onPress={() => resultToOpen ? showResult(resultToOpen.sessionId) : playChallenge(challenge)}
            />
            <Button label="Share challenge" icon="share-social-outline" disabled={sharing} onPress={() => void shareChallenge(challenge)} />
            {actionError ? <ErrorText>{actionError}</ErrorText> : null}
          </Card>
        )}

        <Card style={styles.panel}>
          <Heading icon="people-outline" title="Challenge a friend" />
          <Text style={type.dim}>Choose a puzzle and rules, then share a code to play the same challenge.</Text>
          <Button
            label="Create challenge"
            icon="add"
            variant={challenge ? 'secondary' : 'primary'}
            onPress={() => {
              setActionError('');
              router.push({ pathname: '/new-game', params: { mode: 'challenge' } });
            }}
          />
        </Card>

        <Card style={styles.panel}>
          <Heading icon="key-outline" title="Enter a code" />
          <TextInput
            accessibilityLabel="Challenge code or message"
            style={[styles.input, inputError ? styles.inputError : undefined]}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste the code or full message"
            placeholderTextColor={colors.textFaint}
            onChangeText={(text) => { setInput(text); setInputError(''); }}
            selectionColor={colors.accentSoft}
            value={input}
          />
          {inputError ? <ErrorText>{inputError}</ErrorText> : null}
          <Button label="Preview challenge" icon="arrow-forward" onPress={enterCode} />
        </Card>

        <View style={styles.history}>
          <Text style={type.heading} accessibilityRole="header">Recent results</Text>
          {completions === undefined ? (
            <ActivityIndicator color={colors.accent} accessibilityLabel="Loading challenge results" />
          ) : completions === null ? (
            <Text style={type.dim}>Challenge results are unavailable right now.</Text>
          ) : results.length ? (
            <Card>
              {results.slice(0, 5).map((result, index) => (
                <ResultRow key={result.sessionId} result={result} divided={index > 0} onPress={() => showResult(result.sessionId)} />
              ))}
            </Card>
          ) : (
            <Text style={type.dim}>Finish a challenge to share and compare your result.</Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Heading({ icon, title }: { icon: IconName; title: string }) {
  return (
    <View style={styles.heading}>
      <View style={styles.headingIcon}>
        <Ionicons name={icon} size={21} color={colors.accent} />
      </View>
      <Text style={[type.heading, styles.headingTitle]} accessibilityRole="header">{title}</Text>
    </View>
  );
}

function ErrorText({ children }: { children: string }) {
  return <Text accessibilityLiveRegion="polite" role="alert" style={styles.error}>{children}</Text>;
}

function ResultRow({ result, divided, onPress }: { result: Completion; divided: boolean; onPress: () => void }) {
  const difficulty = DIFFICULTY_NAMES[result.difficulty];
  const time = formatTime(result.timeMs);
  const date = new Date(result.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <Pressable
      accessibilityLabel={`${difficulty} challenge, ${date}, ${time}`}
      accessibilityRole="button"
      accessibilityHint="Open to share or compare this result"
      onPress={onPress}
      style={({ pressed }) => [styles.resultRow, divided && styles.resultDivider, pressed && styles.resultPressed]}>
      <Ionicons name="trophy-outline" size={20} color={colors.accent} />
      <View style={styles.resultCopy}>
        <Text style={type.body}>{difficulty} challenge</Text>
        <Text style={type.dim}>{date}</Text>
      </View>
      <Text style={styles.resultTime}>{time}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  panel: { gap: spacing.md, padding: spacing.lg },
  preview: { gap: spacing.sm, padding: spacing.lg, borderColor: colors.accentEdge, backgroundImage: gradients.panel },
  previewHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headingIcon: {
    width: 39, height: 39, borderRadius: radius.sm, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  headingTitle: { flex: 1 },
  codeBox: {
    padding: spacing.md, gap: spacing.xs, marginVertical: spacing.xs, borderWidth: 1,
    borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.bg,
  },
  code: { ...type.body, color: colors.accent, fontWeight: '700', fontVariant: ['tabular-nums'] },
  input: {
    ...type.body, minHeight: 76, maxHeight: 148, padding: spacing.md, textAlignVertical: 'top', borderWidth: 1,
    borderRadius: radius.md, borderColor: colors.line, backgroundColor: colors.bg,
  },
  inputError: { borderColor: colors.warn },
  error: { ...type.dim, color: colors.warn },
  history: { gap: spacing.sm },
  resultRow: {
    minHeight: TOUCH + 6, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
  },
  resultDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  resultPressed: { backgroundColor: colors.surfaceHigh },
  resultCopy: { flex: 1 },
  resultTime: { ...type.label, color: colors.accent, fontVariant: ['tabular-nums'] },
});
