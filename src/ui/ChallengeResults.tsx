import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import {
  type ChallengeScore,
  decodeChallengeRules,
  decodeChallengeScore,
  describeChallengeRules,
  encodeChallengeScore,
} from '../game/challenge';
import { STORE_URL } from '../game/links';
import { getFriendChallengeScore, saveFriendChallengeScore } from '../state/app';
import { formatTime } from '../state/clock';
import { OwnChallengeScoreError } from '../storage/repository';
import { Button, Card } from './controls';
import { TOUCH, colors, gradients, radius, spacing, type } from './theme';

export function formatChallengeTime(ms: number): string {
  return `${formatTime(ms)}.${String(ms % 1000).padStart(3, '0')}`;
}

export function ChallengeResults({ score }: { score: ChallengeScore }) {
  const [friend, setFriend] = useState<ChallengeScore | null>(null);
  const [input, setInput] = useState('');
  const [compareError, setCompareError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const comparing = useRef(false);
  const sharing = useRef(false);
  const shareData = useMemo(() => {
    try {
      return {
        code: encodeChallengeScore(score),
        challengeCode: score.challengeCode,
        rules: describeChallengeRules(decodeChallengeRules(score.challengeCode)),
      };
    } catch {
      return null;
    }
  }, [score]);
  const challengeCode = shareData?.challengeCode;
  const { sessionId } = score;

  useEffect(() => {
    if (!challengeCode) return;
    let active = true;
    void getFriendChallengeScore(challengeCode)
      .then((saved) => {
        if (active && saved?.challengeCode === challengeCode && saved.sessionId !== sessionId) {
          setFriend((current) => current ?? saved);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [challengeCode, sessionId]);

  if (!shareData) {
    return (
      <Card style={styles.panel}>
        <Text style={type.heading} accessibilityRole="header">Challenge result</Text>
        <Text style={type.dim}>The result code for this challenge could not be generated.</Text>
      </Card>
    );
  }

  const share = async () => {
    if (sharing.current) return;
    sharing.current = true;
    setShareError(null);
    const title = 'Sudoku Studio challenge result';
    const message = [
      `${title}\nI solved the puzzle in ${formatChallengeTime(score.timeMs)}.`,
      shareData.code,
      'Paste this result code into Sudoku Studio to compare times.',
      `Get Sudoku Studio: ${STORE_URL}`,
    ].join('\n\n');
    try {
      await Share.share({ title, message }, { dialogTitle: title, subject: title });
    } catch {
      setShareError('Sharing is unavailable. You can select and copy the code below.');
    } finally {
      sharing.current = false;
    }
  };

  const compare = async () => {
    if (comparing.current) return;
    setCompareError(null);
    let other: ChallengeScore;
    try {
      other = decodeChallengeScore(input);
      if (other.challengeCode !== shareData.challengeCode) throw new Error('This result belongs to a different challenge.');
      if (other.sessionId === sessionId) throw new OwnChallengeScoreError();
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : 'This result code could not be read.');
      return;
    }

    comparing.current = true;
    setSaving(true);
    Keyboard.dismiss();
    try {
      await saveFriendChallengeScore(other);
      setFriend(other);
      setInput('');
      setEditing(false);
    } catch (error) {
      setCompareError(error instanceof OwnChallengeScoreError
        ? error.message
        : 'This comparison could not be saved. Tap Compare results to try again.');
    } finally {
      comparing.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <Card style={styles.panel}>
        <Text style={type.heading} accessibilityRole="header">Share your result</Text>
        <Text style={type.dim}>{shareData.rules}</Text>
        <Button label="Share result" variant="primary" icon="share-social-outline" onPress={() => void share()} />
        {shareError && <Text style={styles.error} accessibilityLiveRegion="polite">{shareError}</Text>}
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Your result code</Text>
          <Text selectable textBreakStrategy="simple" style={styles.code}>{shareData.code}</Text>
        </View>
      </Card>

      <Card style={styles.panel}>
        <Text style={type.heading} accessibilityRole="header">Compare with a friend</Text>
        {friend && <Comparison score={score} friend={friend} />}
        {friend && !editing ? (
          <Button label="Compare another result" icon="people-outline" onPress={() => setEditing(true)} />
        ) : (
          <>
            <TextInput
              accessibilityLabel="Friend’s result code"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!saving}
              maxLength={4096}
              multiline
              onChangeText={(text) => {
                setInput(text);
                setCompareError(null);
              }}
              onFocus={() => setEditing(true)}
              placeholder="Paste your friend’s result code"
              placeholderTextColor={colors.textFaint}
              selectionColor={colors.accent}
              spellCheck={false}
              style={styles.input}
              underlineColorAndroid="transparent"
              value={input}
            />
            {compareError && <Text style={styles.error} accessibilityLiveRegion="polite">{compareError}</Text>}
            <Button
              label={saving ? 'Saving comparison…' : 'Compare results'}
              icon="people-outline"
              onPress={() => void compare()}
              disabled={saving || input.trim().length === 0}
            />
          </>
        )}
      </Card>
    </>
  );
}

function Comparison({ score, friend }: { score: ChallengeScore; friend: ChallengeScore }) {
  const { fontScale } = useWindowDimensions();
  const difference = friend.timeMs - score.timeMs;
  const headline = difference === 0 ? 'It’s a tie' : difference > 0 ? 'You were faster' : 'Your friend was faster';

  return (
    <View style={styles.comparison}>
      <View style={styles.outcome}>
        <Ionicons name={difference === 0 ? 'timer-outline' : 'trophy-outline'} size={22} color={colors.accent} />
        <View style={styles.outcomeText} accessibilityLiveRegion="polite">
          <Text style={styles.outcomeTitle}>{headline}</Text>
          {difference !== 0 && <Text style={type.dim}>{formatChallengeTime(Math.abs(difference))} apart</Text>}
        </View>
      </View>
      <View style={[styles.players, fontScale >= 1.6 && styles.stackedPlayers]}>
        <Player label="You" score={score} faster={difference > 0} />
        <Player label="Friend" score={friend} faster={difference < 0} />
      </View>
    </View>
  );
}

function Player({ label, score, faster }: { label: string; score: ChallengeScore; faster: boolean }) {
  return (
    <View style={[styles.player, faster && styles.faster]}>
      <Text style={[styles.playerTitle, faster && styles.fasterTitle]}>{label}</Text>
      <Text style={styles.playerTime} accessibilityLabel={`Active time ${formatChallengeTime(score.timeMs)}`}>
        {formatChallengeTime(score.timeMs)}
      </Text>
      <Text style={type.dim}>Mistakes {score.mistakes}</Text>
      <Text style={type.dim}>Hints {score.hints}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.lg, gap: spacing.md },
  codeBox: { gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.bg, padding: spacing.md },
  codeLabel: { ...type.label, color: colors.accent },
  code: {
    color: colors.text,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 13,
    lineHeight: 20,
  },
  input: {
    ...type.body,
    minHeight: TOUCH * 2,
    maxHeight: 180,
    textAlignVertical: 'top',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
  },
  error: { ...type.dim, color: colors.warn },
  comparison: { gap: spacing.sm },
  outcome: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.accentSoft, borderRadius: radius.md },
  outcomeText: { flex: 1 },
  outcomeTitle: { ...type.body, color: colors.accent, fontWeight: '700' },
  players: { flexDirection: 'row', gap: spacing.sm },
  stackedPlayers: { flexDirection: 'column' },
  player: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    backgroundImage: gradients.panel,
  },
  faster: { borderColor: colors.accentEdge },
  playerTitle: { ...type.body, fontWeight: '700' },
  fasterTitle: { color: colors.accent },
  playerTime: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
