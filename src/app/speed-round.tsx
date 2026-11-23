import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  DEFAULT_SPEED_OPTIONS, EMPTY_SPEED_PROGRESS, SPEED_EXTENSION_MS, SPEED_PROGRESS_KEY, canExtendSpeedRound, createSpeedClock,
  enterSpeedDigit, extendSpeedRound, finishSpeedRound, quitSpeedRound, readSpeedProgress, resumeSpeedRound, speedPuzzleForRound,
  speedRemainingMs, startSpeedRound,
  type SpeedFormat, type SpeedProgress,
} from '../game/eventSpeed';
import { DIFFICULTY_NAMES } from '../engine/grader';
import { appStore, loadModeProgress, saveModeProgress, watchAdForModeProgress } from '../state/app';
import { formatTime } from '../state/clock';
import { useStore } from '../state/store';
import { AdOffer } from '../ui/AdOffer';
import { Board } from '../ui/Board';
import { AlternateBoard } from '../ui/AlternateBoard';
import { confirmQuitGame } from '../ui/confirmQuitGame';
import { Keypad } from '../ui/Keypad';
import { Button, Card, IconButton, Screen } from '../ui/controls';
import { haptic, useAppActive, useBoardSize, useScreenFocused } from '../ui/hooks';
import { SpeedOptionsPicker } from '../ui/SpeedOptionsPicker';
import { colors, gradients, radius, spacing, TOUCH, type } from '../ui/theme';

const EMPTY_NOTES: readonly number[] = new Array(81).fill(0);
const NO_ERRORS: ReadonlySet<number> = new Set<number>();

export default function SpeedRoundScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [now] = useState(() => createSpeedClock());
  const [progress, setProgress] = useState(EMPTY_SPEED_PROGRESS);
  const [options, setOptions] = useState(DEFAULT_SPEED_OPTIONS);
  const latest = useRef(EMPTY_SPEED_PROGRESS);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveError, setSaveError] = useState(false);
  const saveRevision = useRef(0);
  const [quitting, setQuitting] = useState(false);
  const quitPending = useRef(false);
  const [seconds, setSeconds] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [wrong, setWrong] = useState<number | null>(null);
  const errors = useMemo(() => wrong === null ? NO_ERRORS : new Set([wrong]), [wrong]);
  const [feedback, setFeedback] = useState('Tap an empty square, then a digit');
  const selectedCell = useRef<number | null>(null);
  const boardSize = useBoardSize(342, 16);
  const appActive = useAppActive();
  const focused = useScreenFocused();
  const adIdle = useStore(appStore, (s) => s.reward.phase === 'idle');

  const write = useCallback((snapshot: SpeedProgress) => {
    const revision = ++saveRevision.current;
    void saveModeProgress(SPEED_PROGRESS_KEY, snapshot).then(
      () => { if (revision === saveRevision.current) setSaveError(false); },
      () => { if (revision === saveRevision.current) setSaveError(true); },
    );
  }, []);
  const update = useCallback((next: SpeedProgress) => {
    latest.current = next;
    setProgress(next);
    write(next);
  }, [write]);

  const refreshTime = useCallback(() => {
    if (quitPending.current) return;
    const current = latest.current;
    if (!current.round || current.round.finished) return;
    const time = now();
    const remaining = speedRemainingMs(current.round, time);
    setSeconds(Math.ceil(remaining / 1000));
    if (remaining === 0) update(finishSpeedRound(current, time));
  }, [now, update]);

  useEffect(() => {
    let live = true;
    void loadModeProgress(SPEED_PROGRESS_KEY).then(
      (saved) => {
        if (!live) return;
        const current = readSpeedProgress(saved);
        const next = finishSpeedRound(current, now());
        if (next !== current) write(next);
        latest.current = next;
        setProgress(next);
        if (next.round) {
          setSeconds(Math.ceil(speedRemainingMs(next.round, now()) / 1000));
          if (next.round.format.difficulty !== 'legacy') setOptions(next.round.format);
        }
        setLoadStatus('ready');
      },
      () => { if (live) setLoadStatus('error'); },
    );
    return () => { live = false; };
  }, [loadAttempt, now, write]);

  const round = progress.round;
  const puzzle = round && !round.finished ? speedPuzzleForRound(round) : undefined;
  const running = puzzle !== undefined;
  useEffect(() => {
    if (!running || !focused || !appActive) return;
    refreshTime();
    const timer = setInterval(refreshTime, 125);
    return () => clearInterval(timer);
  }, [appActive, focused, refreshTime, running]);

  const focusCell = useCallback((cell: number | null) => {
    selectedCell.current = cell;
    setSelected(cell);
    setWrong(null);
  }, []);

  /* ---- one optional ad reopens a finished round with extra time, once ---- */
  const extend = useCallback(() => watchAdForModeProgress(SPEED_PROGRESS_KEY, () => extendSpeedRound(latest.current), (next) => {
    // The ad's reward saved this progress itself; drop any older save still in flight.
    saveRevision.current++;
    latest.current = next;
    setProgress(next);
    setSaveError(false);
    focusCell(null);
    setFeedback('Extra time! Tap an empty square, then a digit');
    setSeconds(SPEED_EXTENSION_MS / 1000);
  }), [focusCell]);
  // The extra time starts only once the ad has closed and the board is back on screen.
  const waiting = !!round && !round.finished && round.pausedMs !== undefined;
  useEffect(() => {
    if (!waiting || !adIdle || !focused || !appActive || quitPending.current) return;
    update(resumeSpeedRound(latest.current, now()));
  }, [adIdle, appActive, focused, now, update, waiting]);
  const pressCell = useCallback((cell: number) => {
    if (quitPending.current || latest.current.round?.values[cell] !== 0) return;
    focusCell(cell);
    setFeedback('Choose a digit');
    haptic('tap');
  }, [focusCell]);
  const pressDigit = useCallback((digit: number) => {
    if (quitPending.current) return;
    const current = latest.current;
    const cell = selectedCell.current;
    const time = now();
    const timed = finishSpeedRound(current, time);
    if (timed !== current) {
      setSeconds(0);
      update(timed);
      return;
    }
    if (!current.round || current.round.finished) return;
    if (cell === null) {
      setFeedback('Tap an empty square first');
      return;
    }
    const next = enterSpeedDigit(current, cell, digit, time);
    if (next === current || !next.round) return;
    update(next);
    if (next.round.mistakes > current.round.mistakes) {
      setWrong(cell);
      setFeedback(`${digit} does not fit here`);
      haptic('warn');
      return;
    }
    focusCell(null);
    setFeedback(next.round.puzzleId === current.round.puzzleId ? 'Correct. Pick another square' : 'Board cleared. Keep going!');
    haptic('tap');
  }, [focusCell, now, update]);

  const start = () => {
    if (quitPending.current) return;
    const next = startSpeedRound(latest.current, options, now());
    if (next === latest.current) return;
    focusCell(null);
    setFeedback('Tap an empty square, then a digit');
    setSeconds(options.minutes * 60);
    update(next);
  };

  const openStatistics = () => {
    const format = running && round ? round.format : options;
    router.push({ pathname: '/speed-statistics', params: { difficulty: format.difficulty, minutes: String(format.minutes) } });
  };

  const quit = (startedAt: number) => {
    confirmQuitGame(() => {
      if (quitPending.current || !navigation.isFocused()) return;
      const current = latest.current;
      const next = quitSpeedRound(current, startedAt, now());
      if (next === current) return;
      if (next.round) {
        setSeconds(0);
        update(next);
        return;
      }

      quitPending.current = true;
      setQuitting(true);
      saveRevision.current++;
      void saveModeProgress(SPEED_PROGRESS_KEY, next).then(() => {
        latest.current = next;
        setProgress(next);
        setSaveError(false);
        focusCell(null);
      }).catch(() => {
        if (navigation.isFocused()) Alert.alert('Could not quit game', 'Your round is still open. Try again.');
      }).finally(() => {
        quitPending.current = false;
        setQuitting(false);
      });
    }, latest.current.round?.extended ? 'The round will end now and keep its score.' : 'Your points in this round will be lost.');
  };

  return (
    <Screen title="Speed Round" right={
      <IconButton icon="stats-chart-outline" label="Speed Round Statistics" onPress={openStatistics} disabled={loadStatus !== 'ready' || quitting} />
    }>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loadStatus === 'loading' ? (
          <Text style={type.dim} accessibilityLiveRegion="polite">Loading your best score…</Text>
        ) : loadStatus === 'error' ? (
          <Card style={styles.hero}>
            <Text style={type.heading}>Progress could not be loaded</Text>
            <Button label="Try again" onPress={() => {
              setLoadStatus('loading');
              setLoadAttempt((attempt) => attempt + 1);
            }} />
          </Card>
        ) : puzzle && round ? (
          <View style={[styles.game, { width: boardSize }]}>
            <View style={styles.roundHeader}>
              <Text style={styles.format}>{describeFormat(round.format)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Quit Game" accessibilityState={{ disabled: quitting }}
                disabled={quitting} onPress={() => quit(round.startedAt)}
                style={({ pressed }) => [styles.quitAction, (pressed || quitting) && styles.quitPressed]}>
                <Ionicons name="exit-outline" size={17} color={colors.warn} />
                <Text style={styles.quitLabel}>{quitting ? 'Quitting…' : 'Quit Game'}</Text>
              </Pressable>
            </View>
            <View style={styles.stats}>
              <View style={[styles.stat, styles.timeStat, seconds <= 10 && styles.timeWarning]}>
                <Text style={type.label}>Time left</Text>
                <Text style={[styles.number, seconds <= 10 && styles.warning]}>{formatTime(seconds * 1000)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={type.label}>Correct</Text>
                <Text style={styles.number}>{round.score}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={type.label}>Best</Text>
                <Text style={styles.number}>{Math.max(round.bestBefore, round.score)}</Text>
              </View>
            </View>
            {puzzle.alternate ? (
              <AlternateBoard puzzle={puzzle.alternate} edge={boardSize} values={round.values} notes={EMPTY_NOTES}
                selected={selected} highlightDigit={0} errors={errors} onSelect={pressCell} disabled={quitting} />
            ) : (
              <Board size={boardSize} values={round.values} givens={puzzle.givens} notes={EMPTY_NOTES}
                selected={selected} highlightDigit={0} errors={errors} onCellPress={pressCell} disabled={quitting} />
            )}
            <Text style={[styles.feedback, wrong !== null && styles.warning]} accessibilityLiveRegion="polite">{feedback}</Text>
            <Keypad digitCount={puzzle.size} grid keyHeight={48} onDigit={pressDigit} disabled={quitting} />
          </View>
        ) : (
          <>
            <Card style={styles.hero}>
              <View style={styles.heroHeading}>
                <View style={styles.heroCopy}>
                  <Text style={type.title} accessibilityRole="header">
                    {round ? (round.score > round.bestBefore ? 'New personal best!' : 'Time’s up') : 'Beat the clock'}
                  </Text>
                  {round && <Text style={type.dim}>{describeFormat(round.format)}</Text>}
                </View>
                <View style={styles.emblem} accessible={false}>
                  <Ionicons name={round ? 'trophy-outline' : 'flash-outline'} size={32} color={colors.accent} />
                </View>
              </View>
              {round ? (
                <View style={styles.stats}>
                  <View style={styles.stat}><Text style={type.label}>Correct</Text><Text style={styles.number}>{round.score}</Text></View>
                  <View style={styles.stat}><Text style={type.label}>Mistakes</Text><Text style={styles.number}>{round.mistakes}</Text></View>
                  <View style={styles.stat}><Text style={type.label}>Best</Text><Text style={styles.number}>{Math.max(round.bestBefore, round.score)}</Text></View>
                </View>
              ) : (
                <>
                  <Text style={type.body}>Fill as many empty squares as you can. Each correct digit adds one point.</Text>
                  <Text style={type.dim}>The clock keeps running if you leave the screen.</Text>
                </>
              )}
              {canExtendSpeedRound(round) && (
                <AdOffer
                  label={`Watch ad: +${SPEED_EXTENSION_MS / 1000} seconds`}
                  detail="Keep this round going · once per round"
                  lost="no time was added"
                  onWatch={extend}
                />
              )}
            </Card>
            <SpeedOptionsPicker options={options} onChange={setOptions} />
            <Button label="Start round" icon="play" variant="primary" onPress={start} />
            <Button label="Statistics" icon="stats-chart-outline" onPress={openStatistics} />
          </>
        )}
        {saveError ? (
          <View style={styles.saveError}>
            <Text style={styles.warning} accessibilityLiveRegion="polite">Speed Round progress could not be saved.</Text>
            <Button label="Retry save" disabled={quitting} onPress={() => write(latest.current)} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function describeFormat(format: SpeedFormat): string {
  const difficulty = format.difficulty === 'legacy' ? 'Original 9×9' : DIFFICULTY_NAMES[format.difficulty];
  return `${difficulty} · ${format.minutes} ${format.minutes === 1 ? 'minute' : 'minutes'}`;
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 592, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  game: { alignSelf: 'center', gap: spacing.sm },
  hero: { padding: spacing.lg, gap: spacing.lg, borderColor: colors.accentEdge, backgroundImage: gradients.panel },
  heroHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroCopy: { flex: 1, gap: spacing.xs },
  roundHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  format: { ...type.label, flex: 1, color: colors.accent },
  quitAction: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  quitLabel: { ...type.dim, color: colors.warn, fontWeight: '700' },
  quitPressed: { opacity: 0.6 },
  emblem: {
    width: 60, height: 60, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accentSoft, borderColor: colors.accentEdge, borderWidth: 1,
  },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1, minHeight: 54, gap: spacing.xs, alignItems: 'center', justifyContent: 'center', padding: spacing.xs,
    borderRadius: radius.sm, borderColor: colors.line, borderWidth: 1, backgroundColor: colors.surface,
  },
  timeStat: { borderColor: colors.accentEdge },
  timeWarning: { borderColor: colors.warn, backgroundColor: colors.warnSoft },
  number: { ...type.heading, fontSize: 19, fontVariant: ['tabular-nums'] },
  feedback: { ...type.dim, textAlign: 'center' },
  warning: { color: colors.warn },
  saveError: { gap: spacing.sm },
});
