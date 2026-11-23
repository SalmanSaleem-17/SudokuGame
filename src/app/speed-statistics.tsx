import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { DIFFICULTIES, DIFFICULTY_NAMES } from '../engine/grader';
import {
  DEFAULT_SPEED_OPTIONS, SPEED_MINUTES, SPEED_PROGRESS_KEY, finishSpeedRound, legacySpeedRecord,
  readSpeedProgress, speedBoardSize, speedRecord, type SpeedProgress,
} from '../game/eventSpeed';
import { loadModeProgress } from '../state/app';
import { Button, Card, Screen } from '../ui/controls';
import { SpeedOptionsPicker } from '../ui/SpeedOptionsPicker';
import { colors, gradients, radius, spacing, type } from '../ui/theme';

export default function SpeedStatisticsScreen() {
  const params = useLocalSearchParams<{ difficulty?: string; minutes?: string }>();
  const requestedDifficulty = DIFFICULTIES.find((difficulty) => difficulty === params.difficulty);
  const requestedMinutes = SPEED_MINUTES.find((minute) => String(minute) === params.minutes);
  const [options, setOptions] = useState(DEFAULT_SPEED_OPTIONS);
  const [progress, setProgress] = useState<SpeedProgress | null | undefined>();
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void loadModeProgress(SPEED_PROGRESS_KEY).then(
      (saved) => {
        if (!live) return;
        const current = finishSpeedRound(readSpeedProgress(saved), Date.now());
        const last = current.round?.format;
        const fallback = last && last.difficulty !== 'legacy' ? last : DEFAULT_SPEED_OPTIONS;
        setOptions({
          difficulty: requestedDifficulty ?? fallback.difficulty,
          minutes: requestedMinutes ?? fallback.minutes,
        });
        setProgress(current);
      },
      () => { if (live) setProgress(null); },
    );
    return () => { live = false; };
  }, [loadAttempt, requestedDifficulty, requestedMinutes]);

  const summary = progress ? speedRecord(progress, options) : null;
  const legacy = progress ? legacySpeedRecord(progress) : undefined;
  const size = speedBoardSize(options.difficulty);
  const attempts = summary ? summary.correct + summary.mistakes : 0;

  return (
    <Screen title="Speed Statistics">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {progress === undefined ? (
          <Text style={type.dim} accessibilityLiveRegion="polite">Loading your scores…</Text>
        ) : progress === null ? (
          <Card style={styles.panel}>
            <Text style={type.heading}>Scores could not be loaded</Text>
            <Button label="Try again" onPress={() => {
              setProgress(undefined);
              setLoadAttempt((attempt) => attempt + 1);
            }} />
          </Card>
        ) : summary && (
          <>
            <Card style={styles.summary}>
              <Text style={type.heading} accessibilityRole="header">
                {DIFFICULTY_NAMES[options.difficulty]} · {size}×{size} · {options.minutes} min
              </Text>
              <View style={styles.stats}>
                <Stat label="Best score" value={String(summary.best)} />
                <Stat label="Rounds" value={String(summary.rounds)} />
                <Stat label="Accuracy" value={attempts > 0 ? `${Math.round(100 * summary.correct / attempts)}%` : '—'} />
              </View>
              {summary.rounds === 0 && <Text style={type.dim}>Finish a round with this setup to record your results.</Text>}
            </Card>
            <SpeedOptionsPicker options={options} onChange={setOptions} />
            {summary.recent.length > 0 && (
              <Card style={styles.panel}>
                <Text style={type.heading} accessibilityRole="header">Recent rounds</Text>
                {summary.recent.map((round, index) => (
                  <View style={[styles.historyRow, index > 0 && styles.separator]} key={`${round.startedAt}-${index}`}>
                    <Text style={type.dim}>{new Date(round.startedAt).toLocaleDateString()}</Text>
                    <Text style={styles.score}>{round.score} correct · {round.mistakes} {round.mistakes === 1 ? 'mistake' : 'mistakes'}</Text>
                  </View>
                ))}
              </Card>
            )}
            {legacy && (legacy.best > 0 || legacy.rounds > 0) && (
              <Card style={styles.panel}>
                <Text style={type.heading} accessibilityRole="header">Original 1-minute 9×9</Text>
                <Text style={type.body}>Personal best · {legacy.best} correct</Text>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.value}>{value}</Text>
      <Text style={[type.dim, styles.center]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 592, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  panel: { padding: spacing.md, gap: spacing.sm },
  summary: { padding: spacing.md, gap: spacing.md, borderColor: colors.accentEdge, backgroundImage: gradients.panel },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    minHeight: 68, minWidth: 76, flex: 1, justifyContent: 'center', alignItems: 'center',
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: spacing.xs,
  },
  center: { textAlign: 'center' },
  value: { ...type.heading, color: colors.accent, fontVariant: ['tabular-nums'] },
  historyRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs, gap: spacing.sm },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  score: { ...type.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
