import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ScrollViewInstance } from 'react-native';

import { DIFFICULTY_NAMES } from '../engine/grader';
import {
  ALTERNATE_MODES, alternatePuzzleCount, applyAlternateInput, createAlternateProgress, getAlternatePuzzle,
  isAlternateComplete, isAlternateMode, loadAlternateProgress, undoAlternateInput,
} from '../game/alternate';
import type { AlternateProgress } from '../game/alternate';
import { alternateConflicts } from '../game/alternateRules';
import type { AlternateMode } from '../game/alternateRules';
import { enterMiniClassic, miniClassicStatus, miniClassicTimeLimit, miniMistakeLimit, undoMiniClassic, type MiniClassicSession } from '../game/miniClassic';
import { PLAY_BOARD_SIZES, type MiniMode } from '../game/playFormat';
import { appStore, canContinueMiniLevel, completeMiniClassic, flushMiniClassic, loadModeProgress, miniClassicClock, mutateMiniClassic, quitMiniClassic, saveModeProgress, startMiniClassic, startMiniLevel } from '../state/app';
import { formatTime } from '../state/clock';
import { useStore } from '../state/store';
import { AlternateBoard } from '../ui/AlternateBoard';
import { Keypad } from '../ui/Keypad';
import { LevelFailure } from '../ui/LevelFailure';
import { confirmQuitGame } from '../ui/confirmQuitGame';
import { Button, Card, IconButton, Screen } from '../ui/controls';
import type { IconName } from '../ui/controls';
import { haptic, useAppActive, useBoardSize, useScreenFocused } from '../ui/hooks';
import { colors, gameControlSurfaces, radius, spacing, TOUCH, type } from '../ui/theme';

const modeVisuals: Record<AlternateMode, { icon: IconName; tint: string; accent: string }> = {
  'mini-4': { icon: 'grid-outline', tint: colors.good, accent: '#263B33' },
  'mini-6': { icon: 'apps-outline', tint: colors.blue, accent: colors.blueSoft },
  diagonal: { icon: 'close-outline', tint: colors.blue, accent: colors.blueSoft },
  killer: { icon: 'calculator-outline', tint: colors.accent, accent: colors.accentSoft },
  irregular: { icon: 'extension-puzzle-outline', tint: colors.purple, accent: colors.purpleSoft },
};

const MINI: AlternateMode[] = ['mini-4', 'mini-6'];
const VARIANTS: AlternateMode[] = ['diagonal', 'killer', 'irregular'];

export default function AlternateScreen() {
  const params = useLocalSearchParams<{ mode?: string; play?: string; source?: string }>();
  const mode = isAlternateMode(params.mode) ? params.mode : null;
  if (params.play === 'classic' || params.play === 'level') {
    const level = params.play === 'level';
    return mode === 'mini-4' || mode === 'mini-6'
      ? <MiniClassicGame key={`${params.play}:${mode}`} mode={mode} level={level} fromSavedGames={params.source === 'saved-games'} />
      : <MiniClassicMissing level={level} />;
  }
  return mode
    ? <AlternateGame key={mode} mode={mode} fromPicker={params.source === 'picker'} />
    : <AlternatePicker variants={params.mode === 'variants'} />;
}

function AlternatePicker({ variants }: { variants: boolean }) {
  const title = variants ? 'Sudoku Variants' : 'Mini Sudoku';
  return (
    <Screen title={title}>
      <ScrollView contentContainerStyle={styles.picker}>
        <View style={styles.pickerIntro}>
          <Text accessibilityRole="header" style={type.title}>{variants ? 'Pick a new rule' : 'Pick a board size'}</Text>
          <Text style={type.dim}>{variants ? 'Each variant has its own set of puzzles.' : 'Smaller boards are a good place to begin.'}</Text>
        </View>
        {(variants ? VARIANTS : MINI).map((mode) => {
          const detail = ALTERNATE_MODES[mode];
          const visual = modeVisuals[mode];
          return (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityLabel={detail.name}
              accessibilityHint={detail.description}
              onPress={() => router.push({ pathname: '/alternate', params: { mode, source: 'picker' } })}
              style={({ pressed }) => [styles.choice, { borderColor: visual.accent }, pressed && styles.pressed]}>
              <View style={[styles.choiceIcon, { backgroundColor: visual.accent }]}>
                <Ionicons name={visual.icon} size={26} color={visual.tint} />
              </View>
              <View style={styles.choiceText}>
                <Text style={styles.choiceTitle}>{detail.name}</Text>
                <Text style={type.dim}>{detail.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={visual.tint} />
            </Pressable>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

interface Round {
  index: number;
  progress: AlternateProgress;
}

function AlternateGame({ mode, fromPicker }: { mode: AlternateMode; fromPicker: boolean }) {
  const navigation = useNavigation();
  const [round, setRound] = useState<Round | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const quitPending = useRef(false);
  const latestRound = useRef<Round | null>(null);
  const saving = useRef({ generation: 0 });
  const key = `alternate:${mode}`;
  const count = alternatePuzzleCount(mode);

  useEffect(() => {
    let mounted = true;
    const saveState = saving.current;
    void loadModeProgress(key).then(
      (raw) => {
        if (!mounted) return;
        const next = loadAlternateProgress(mode, raw);
        latestRound.current = next;
        setRound(next);
      },
      () => {
        if (mounted) setLoadFailed(true);
      },
    );
    return () => {
      mounted = false;
      saveState.generation++;
    };
  }, [key, mode, loadAttempt]);

  const save = useCallback((updated: AlternateProgress) => {
    const saveState = saving.current;
    const generation = ++saveState.generation;
    void saveModeProgress(key, updated).then(
      () => {
        if (generation === saveState.generation) setSaveFailed(false);
      },
      () => {
        if (generation === saveState.generation) setSaveFailed(true);
      },
    );
  }, [key]);

  const commit = useCallback((updated: Round) => {
    if (quitPending.current) return;
    latestRound.current = updated;
    setRound(updated);
    save(updated.progress);
  }, [save]);

  const enter = useCallback((cell: number, digit: number, notesMode: boolean) => {
    const current = latestRound.current;
    if (!current || quitPending.current) return;
    const settings = appStore.getState().settings;
    const currentPuzzle = getAlternatePuzzle(mode, current.index);
    const updated = applyAlternateInput(currentPuzzle, current.progress, cell, digit, notesMode, settings.smartNotes);
    if (updated === current.progress) return;
    commit({ ...current, progress: updated });
    haptic(isAlternateComplete(currentPuzzle, updated) ? 'success'
      : digit && !notesMode && settings.mistakeFeedback && digit !== currentPuzzle.solution[cell] ? 'warn' : 'tap');
  }, [commit, mode]);

  const undo = () => {
    const current = latestRound.current;
    if (!current || current.progress.undo.length === 0) return;
    commit({ ...current, progress: undoAlternateInput(current.progress) });
  };

  const start = (index: number) => {
    commit({ index, progress: createAlternateProgress(getAlternatePuzzle(mode, index)) });
  };

  const quit = () => {
    const attempt = latestRound.current;
    if (!attempt || quitPending.current) return;
    confirmQuitGame(() => {
      if (quitPending.current || !navigation.isFocused() || latestRound.current !== attempt) return;
      const puzzle = getAlternatePuzzle(mode, attempt.index);
      if (isAlternateComplete(puzzle, attempt.progress)) return;
      const progress = createAlternateProgress(puzzle);
      quitPending.current = true;
      setQuitting(true);
      void saveModeProgress(key, progress).then(() => {
        const next = { index: attempt.index, progress };
        latestRound.current = next;
        setRound(next);
        setSaveFailed(false);
        if (!navigation.isFocused()) return;
        if (fromPicker && router.canGoBack()) router.back();
        else router.replace({ pathname: '/alternate', params: { mode: MINI.includes(mode) ? 'mini' : 'variants' } });
      }).catch(() => {
        if (navigation.isFocused()) Alert.alert('Could not quit game', 'Your puzzle is still open. Try again.');
      }).finally(() => {
        quitPending.current = false;
        setQuitting(false);
      });
    });
  };

  if (!round) {
    return (
      <Screen title={ALTERNATE_MODES[mode].name}>
        <View style={styles.loading}>
          {loadFailed ? (
            <Button label="Retry loading puzzle" onPress={() => {
              setLoadFailed(false);
              setLoadAttempt((attempt) => attempt + 1);
            }} />
          ) : <ActivityIndicator color={modeVisuals[mode].tint} accessibilityLabel="Loading puzzle" />}
        </View>
      </Screen>
    );
  }

  return (
    <AlternatePlay
      mode={mode}
      round={round}
      onEnter={enter}
      onUndo={undo}
      onRestart={() => start(round.index)}
      onNext={() => start((round.index + 1) % count)}
      onQuit={quit}
      quitting={quitting}
      onRetrySave={saveFailed ? () => save(round.progress) : undefined}
    />
  );
}

function miniClassicTitle(session: MiniClassicSession): string {
  if (session.level) return `Level ${session.level.number} · ${DIFFICULTY_NAMES[session.difficulty]}`;
  const edge = PLAY_BOARD_SIZES[session.difficulty];
  return `${DIFFICULTY_NAMES[session.difficulty]} · ${edge}×${edge}`;
}

function MiniClassicMissing({ level = false }: { level?: boolean }) {
  return (
    <Screen title={level ? 'Levels' : 'Game Setup'}>
      <View style={styles.missing}>
        <Text style={type.dim}>{level ? 'Choose a level to play.' : 'Choose a difficulty to start a puzzle.'}</Text>
        {level
          ? <Button label="Levels" variant="primary" onPress={() => router.replace('/levels')} />
          : <Button label="New Game" variant="primary" onPress={() => router.replace('/new-game')} />}
      </View>
    </Screen>
  );
}

/** The small-board game in play: the Play Now mini, or an Easy or Medium level attempt. */
const readMini = (level: boolean) => (level ? appStore.getState().miniLevel : appStore.getState().miniClassic);

function MiniClassicGame({ mode, level, fromSavedGames }: { mode: MiniMode; level: boolean; fromSavedGames: boolean }) {
  const navigation = useNavigation();
  const session = useStore(appStore, (state) => {
    const saved = level ? state.miniLevel : state.miniClassic;
    return saved?.mode === mode ? saved : null;
  });
  const focused = useScreenFocused();
  const appActive = useAppActive();
  const [pausedId, setPausedId] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const [resultId, setResultId] = useState<string | null>(null);
  const [quitting, setQuitting] = useState(false);
  const attemptedSave = useRef<string | null>(null);
  const saving = useRef<string | null>(null);
  const restartPending = useRef(false);
  const quitPending = useRef(false);

  const id = session?.id;
  const phase = session ? miniClassicStatus(session) : null;
  const paused = !!id && pausedId === id;
  const ticking = !!id && phase === 'playing' && focused && appActive && !paused && !restarting && !quitting;
  const timeLimit = session ? miniClassicTimeLimit(session) : null;

  useEffect(() => {
    const current = readMini(level);
    if (!ticking || !id || current?.id !== id) return;
    miniClassicClock.load('mini', current.elapsedMs, id);
    miniClassicClock.start();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const checkDeadline = () => {
      if (timeLimit === null || !miniClassicClock.matches('mini', id) || !miniClassicClock.running) return;
      const remaining = timeLimit - miniClassicClock.read();
      if (remaining > 0) deadline = setTimeout(checkDeadline, Math.ceil(remaining));
      else flushMiniClassic(id);
    };
    checkDeadline();
    return () => {
      if (deadline) clearTimeout(deadline);
      if (!miniClassicClock.matches('mini', id)) return;
      miniClassicClock.stop();
      flushMiniClassic(id);
    };
  }, [id, level, ticking, timeLimit]);

  const finish = useCallback((sessionId: string) => {
    if (saving.current) return;
    saving.current = sessionId;
    setSaveState('saving');
    void completeMiniClassic(sessionId).then((savedId) => {
      saving.current = null;
      if (savedId) setResultId(savedId);
      else setSaveState('failed');
    });
  }, []);

  useEffect(() => {
    if (!focused || !id || phase !== 'solved' || attemptedSave.current === id) return;
    attemptedSave.current = id;
    finish(id);
  }, [finish, focused, id, phase]);

  useEffect(() => {
    if (focused && resultId) router.replace({ pathname: '/results', params: { id: resultId } });
  }, [focused, resultId]);

  const enter = useCallback((cell: number, digit: number, notesMode: boolean) => {
    if (!id || !ticking || quitPending.current) return;
    const { settings } = appStore.getState();
    const current = readMini(level);
    const next = mutateMiniClassic(id, (game) => enterMiniClassic(game, cell, digit, notesMode, settings.smartNotes));
    if (!next || next.progress === current?.progress) return;
    const wrong = digit > 0 && !notesMode && digit !== getAlternatePuzzle(next.mode, next.index).solution[cell];
    haptic(miniClassicStatus(next) === 'solved' ? 'success' : wrong && settings.mistakeFeedback ? 'warn' : 'tap');
  }, [id, level, ticking]);

  if (!session || !phase) {
    if (quitting) {
      return (
        <Screen title="Closing game">
          <View style={styles.loading}><ActivityIndicator color={colors.accent} accessibilityLabel="Closing game" /></View>
        </Screen>
      );
    }
    return resultId || saveState === 'saving' ? (
      <Screen title="Puzzle solved">
        <View style={styles.loading}><ActivityIndicator color={colors.accent} accessibilityLabel="Opening result" /></View>
      </Screen>
    ) : <MiniClassicMissing level={level} />;
  }

  const restart = () => {
    if (restartPending.current || quitPending.current) return;
    restartPending.current = true;
    setRestarting(true);
    setRestartFailed(false);
    const fresh = session.level
      ? startMiniLevel(session.difficulty, session.level.number, true)
      : startMiniClassic(session.mode, session.rules, { replayIndex: session.index });
    void fresh.catch(() => {
      setRestartFailed(true);
    }).finally(() => {
      restartPending.current = false;
      setRestarting(false);
    });
  };

  const togglePause = () => {
    if (quitPending.current) return;
    if (!paused && miniClassicClock.matches('mini', session.id)) {
      miniClassicClock.stop();
      flushMiniClassic(session.id);
    }
    setPausedId(paused ? null : session.id);
  };

  const quit = () => {
    confirmQuitGame(() => {
      if (quitPending.current || restartPending.current || !navigation.isFocused()) return;
      quitPending.current = true;
      setQuitting(true);
      void quitMiniClassic(session.id).then((quit) => {
        if (quit && navigation.isFocused()) {
          router.dismissTo(level ? { pathname: '/levels', params: { difficulty: session.difficulty } } : fromSavedGames ? '/saved-games' : '/');
        }
      }).catch(() => {
        if (navigation.isFocused()) Alert.alert('Could not quit game', 'Your puzzle is still open. Try again.');
      }).finally(() => {
        quitPending.current = false;
        setQuitting(false);
      });
    });
  };

  return (
    <AlternatePlay
      key={session.id}
      mode={mode}
      round={session}
      onEnter={enter}
      onUndo={() => { if (ticking && !quitPending.current) mutateMiniClassic(session.id, undoMiniClassic); }}
      onRestart={restart}
      onQuit={quit}
      quitting={quitting}
      onRetrySave={saveState === 'failed' ? () => finish(session.id) : undefined}
      classic={{ session, phase, paused, ticking, restarting, restartFailed, onPause: togglePause }}
    />
  );
}

function MiniClassicTimer({ session, ticking }: { session: MiniClassicSession; ticking: boolean }) {
  const { id, elapsedMs } = session;
  const timeLimit = miniClassicTimeLimit(session);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const elapsed = ticking ? Math.max(elapsedMs, liveElapsed) : elapsedMs;
  const seconds = timeLimit === null ? Math.floor(elapsed / 1000) : Math.ceil(Math.max(0, timeLimit - elapsed) / 1000);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => {
      if (miniClassicClock.matches('mini', id)) setLiveElapsed(miniClassicClock.read());
    }, 250);
    return () => clearInterval(timer);
  }, [id, ticking]);

  return (
    <View style={styles.roundMetric}>
      <Text style={type.label}>{timeLimit === null ? 'Time' : 'Time left'}</Text>
      <Text style={[styles.metricValue, timeLimit !== null && seconds <= 10 && styles.warning]}>
        {formatTime(seconds * 1000)}
      </Text>
    </View>
  );
}

interface ClassicControls {
  session: MiniClassicSession;
  phase: ReturnType<typeof miniClassicStatus>;
  ticking: boolean;
  paused: boolean;
  restarting: boolean;
  restartFailed: boolean;
  onPause: () => void;
}

interface AlternatePlayProps {
  mode: AlternateMode;
  round: Round;
  onEnter: (cell: number, digit: number, notesMode: boolean) => void;
  onUndo: () => void;
  onRestart: () => void;
  onQuit: () => void;
  quitting: boolean;
  onNext?: () => void;
  onRetrySave?: () => void;
  classic?: ClassicControls;
}

function AlternatePlay({ mode, round, onEnter, onUndo, onRestart, onQuit, quitting, onNext, onRetrySave, classic }: AlternatePlayProps) {
  const { mistakeFeedback, numberFirst, timer } = useStore(appStore, (state) => state.settings);
  const [selected, setSelected] = useState<number | null>(null);
  const [activeDigit, setActiveDigit] = useState(0);
  const [notesMode, setNotesMode] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const showTimer = classic && (timer || miniClassicTimeLimit(classic.session) !== null);
  const showMistakes = classic && classic.session.rules.mistakes !== 'off';
  const mistakeLimit = classic ? miniMistakeLimit(classic.session) : null;
  const boardEdge = useBoardSize((mode === 'mini-4' ? 245 : 300) + (showTimer || showMistakes ? 52 : 0), spacing.lg);
  const puzzle = getAlternatePuzzle(mode, round.index);
  const progress = round.progress;
  const visual = modeVisuals[mode];
  const detail = ALTERNATE_MODES[mode];
  const count = alternatePuzzleCount(mode);
  const errors = useMemo(() => alternateConflicts(puzzle, progress.values, mistakeFeedback),
    [puzzle, progress.values, mistakeFeedback]);
  const finished = isAlternateComplete(puzzle, progress);
  const failed = classic?.phase === 'time' || classic?.phase === 'mistakes';
  const locked = finished || failed || restartOpen || quitting || (classic !== undefined && !classic.ticking);
  const title = classic ? miniClassicTitle(classic.session) : detail.name;

  const select = useCallback((cell: number) => {
    setSelected(cell);
    if (numberFirst && activeDigit) onEnter(cell, activeDigit, notesMode);
  }, [activeDigit, notesMode, numberFirst, onEnter]);

  const resetControls = (action: () => void) => {
    setSelected(null);
    setActiveDigit(0);
    setNotesMode(false);
    setRestartOpen(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
    action();
  };

  const open = progress.values.filter((value) => value === 0).length;
  const blanks = puzzle.givens.filter((value) => value === 0).length;
  const filled = blanks - open;
  const eligible = selected !== null && puzzle.givens[selected] === 0;
  const highlightDigit = numberFirst && activeDigit ? activeDigit
    : selected === null ? 0 : progress.values[selected];
  const selectDigit = (digit: number) => {
    if (numberFirst) setActiveDigit((active) => active === digit ? 0 : digit);
    else if (selected !== null) onEnter(selected, digit, notesMode);
  };
  const showRestart = () => {
    setRestartOpen(true);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const togglePause = () => {
    setRestartOpen(false);
    classic?.onPause();
  };

  return (
    <Screen
      title={title}
      right={classic ? (
        <IconButton icon={classic.paused ? 'play-outline' : 'pause-outline'} label={classic.paused ? 'Resume' : 'Pause'}
          color={colors.accent} disabled={finished || failed || classic.restarting || quitting} onPress={togglePause} />
      ) : (
        <IconButton icon="refresh-outline" label="Restart puzzle" disabled={finished || !progress.undo.length || quitting} onPress={showRestart} />
      )}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.game, { maxWidth: boardEdge + spacing.lg * 2 }]}
        showsVerticalScrollIndicator={false}>
        {classic && (showTimer || showMistakes) && (
          <View style={styles.roundMetrics}>
            {showTimer && <MiniClassicTimer session={classic.session} ticking={classic.ticking} />}
            {showMistakes && (
              <View style={styles.roundMetric}>
                <Text style={type.label}>Mistakes</Text>
                <Text style={[styles.metricValue, classic.phase === 'mistakes' && styles.warning]}>
                  {classic.session.mistakes}{mistakeLimit !== null ? `/${mistakeLimit}` : ''}
                </Text>
              </View>
            )}
          </View>
        )}
        <View style={styles.topRow}>
          <Text style={styles.counter}>{classic ? `${open} open` : `Puzzle ${round.index + 1} of ${count} · ${open} open`}</Text>
          <Pressable
            onPress={() => setRulesOpen(!rulesOpen)}
            accessibilityRole="button"
            accessibilityState={{ expanded: rulesOpen }}
            style={({ pressed }) => [styles.rulesButton, pressed && styles.pressed]}>
            <Ionicons name="information-circle-outline" size={18} color={visual.tint} />
            <Text style={[styles.rulesLabel, { color: visual.tint }]}>Rules</Text>
          </Pressable>
          {!classic && !finished && (
            <Pressable onPress={onQuit} disabled={quitting} accessibilityRole="button" accessibilityLabel="Quit Game"
              accessibilityState={{ disabled: quitting }} style={({ pressed }) => [styles.rulesButton, (pressed || quitting) && styles.pressed]}>
              <Ionicons name="exit-outline" size={17} color={colors.warn} />
              <Text style={[styles.rulesLabel, styles.warning]}>{quitting ? 'Quitting…' : 'Quit Game'}</Text>
            </Pressable>
          )}
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Cells filled"
          accessibilityValue={{ min: 0, max: blanks, now: filled }}
          style={styles.meter}>
          <View style={[styles.meterFill, { width: `${100 * filled / blanks}%`, backgroundColor: visual.tint }]} />
        </View>
        {rulesOpen && (
          <Card style={[styles.notice, { backgroundColor: visual.accent }]}>
            <Text style={type.body}>{detail.rules}</Text>
          </Card>
        )}
        {restartOpen && !finished && !failed && (
          <Card style={styles.notice}>
            <Text style={type.heading}>Restart this puzzle?</Text>
            <Text style={type.dim}>{classic ? 'This starts a fresh attempt with the same rules.' : 'Your entries and notes for this board will be cleared.'}</Text>
            <Button variant="primary" label="Restart" disabled={quitting} onPress={() => resetControls(onRestart)} />
            <Button variant="ghost" label="Cancel" onPress={() => setRestartOpen(false)} />
          </Card>
        )}
        {classic?.paused && !failed && !finished ? (
          <Card style={[styles.notice, styles.pausedCard]}>
            <Ionicons name="pause-circle-outline" size={42} color={colors.accent} />
            <Text style={type.heading} accessibilityRole="header">Game paused</Text>
            <Button variant="primary" label="Resume" icon="play" disabled={classic.restarting || quitting} onPress={togglePause} />
            {!restartOpen && (
              <Button label="Restart puzzle" icon="refresh-outline" disabled={classic.restarting || quitting} onPress={showRestart} />
            )}
            <Button label={quitting ? 'Quitting…' : 'Quit Game'} icon="exit-outline" variant="ghost"
              disabled={classic.restarting || quitting} onPress={onQuit} />
          </Card>
        ) : (
          <AlternateBoard
            puzzle={puzzle}
            edge={boardEdge}
            values={progress.values}
            notes={progress.notes}
            selected={locked ? null : selected}
            highlightDigit={locked ? 0 : highlightDigit}
            errors={errors}
            onSelect={select}
            disabled={locked}
          />
        )}
        {failed && classic ? (
          <Card style={[styles.notice, styles.failureCard]}>
            <Text style={type.heading} accessibilityRole="header">{classic.phase === 'time' ? 'Time’s up' : 'Mistake limit reached'}</Text>
            {classic.session.level ? (
              <LevelFailure
                sessionId={classic.session.id}
                byMistakes={classic.phase === 'mistakes'}
                extraMistakes={classic.session.level.extraMistakes}
                canContinue={canContinueMiniLevel(classic.session)}
                disabled={classic.restarting}
                onRetry={() => resetControls(onRestart)}
                onLevels={() => router.dismissTo({ pathname: '/levels', params: { difficulty: classic.session.difficulty } })}
              />
            ) : (
              <>
                <Text style={type.dim}>Try this puzzle again with the same rules or choose a new game.</Text>
                <Button variant="primary" label="Try again" icon="refresh-outline" disabled={classic.restarting} onPress={() => resetControls(onRestart)} />
                <Button variant="ghost" label="Game Setup" disabled={classic.restarting} onPress={() => router.replace('/new-game')} />
              </>
            )}
          </Card>
        ) : finished && classic ? (
          <Card style={[styles.notice, { borderColor: visual.tint }]}>
            <Text style={type.heading} accessibilityRole="header">Puzzle solved</Text>
            {!onRetrySave && <Text style={type.dim} accessibilityLiveRegion="polite">Saving result…</Text>}
          </Card>
        ) : finished && onNext ? (
          <Card style={[styles.notice, { borderColor: visual.tint }]}>
            <View style={styles.finished}>
              <Ionicons name="checkmark-circle" size={24} color={visual.tint} />
              <Text accessibilityRole="header" style={type.heading}>
                {round.index === count - 1 ? 'Puzzle set complete' : 'Puzzle solved'}
              </Text>
            </View>
            <Button
              variant="primary"
              label={round.index === count - 1 ? 'Play set again' : 'Next puzzle'}
              trailingIcon="arrow-forward"
              onPress={() => resetControls(onNext)}
            />
          </Card>
        ) : !classic?.paused && !classic?.restarting && (
          <>
            <View style={styles.toolbar}>
              <ToolButton icon="arrow-undo-outline" text="Undo" disabled={locked || !progress.undo.length} onPress={onUndo} />
              <ToolButton icon="backspace-outline" text="Erase" disabled={locked || !eligible} onPress={() => selected !== null && onEnter(selected, 0, notesMode)} />
              <ToolButton icon="pencil-outline" text="Notes" onPress={() => setNotesMode(!notesMode)} active={notesMode} disabled={locked} />
            </View>
            <Keypad digitCount={puzzle.size} grid keyHeight={TOUCH} notesMode={notesMode}
              activeDigit={numberFirst ? activeDigit : 0} disabled={locked || (!eligible && !numberFirst)} onDigit={selectDigit} />
          </>
        )}
        {onRetrySave && (
          <Card style={styles.notice}>
            <Text style={[type.dim, styles.warning]} accessibilityLiveRegion="polite">
              {classic ? 'Your result could not be saved.' : 'Progress could not be saved.'}
            </Text>
            <Button label="Retry saving" disabled={quitting} onPress={onRetrySave} />
          </Card>
        )}
        {classic?.restartFailed && <Text style={[type.dim, styles.warning]} accessibilityLiveRegion="polite">Could not restart this puzzle. Try again.</Text>}
      </ScrollView>
    </Screen>
  );
}

function ToolButton({ icon, text, onPress, active, disabled }: {
  icon: IconName;
  text: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const iconColor = disabled ? colors.textFaint : active ? colors.onAccent : active === false ? colors.accent : colors.blue;
  const labelColor = disabled ? colors.textFaint : active ? colors.onAccent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={active === undefined ? 'button' : 'switch'}
      accessibilityLabel={text}
      accessibilityState={{ disabled: !!disabled, checked: active }}
      style={({ pressed }) => [
        styles.tool, active === false && styles.toolWarm, pressed && styles.toolPressed,
        active && styles.toolActive, pressed && active && styles.pressed, disabled && styles.toolDisabled,
      ]}>
      <Ionicons name={icon} size={19} color={iconColor} />
      <Text style={[styles.toolLabel, { color: labelColor }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  picker: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: spacing.lg, gap: spacing.md },
  pickerIntro: { gap: spacing.xs, paddingVertical: spacing.md },
  choice: {
    padding: spacing.md, minHeight: 84, gap: spacing.md, flexDirection: 'row',
    alignItems: 'center', borderRadius: radius.lg, borderWidth: 1.5, backgroundColor: colors.surface,
  },
  choiceIcon: { width: 52, height: 52, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  choiceText: { flex: 1, gap: spacing.xs },
  choiceTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  pressed: { opacity: 0.78 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  missing: { flex: 1, justifyContent: 'center', alignSelf: 'center', width: '100%', maxWidth: 400, padding: spacing.lg, gap: spacing.md },
  game: { width: '100%', alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  roundMetrics: { flexDirection: 'row', gap: spacing.sm },
  roundMetric: {
    flex: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: spacing.xs, alignItems: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
  },
  metricValue: { ...type.heading, fontVariant: ['tabular-nums'] },
  warning: { color: colors.warn },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  counter: { ...type.dim, fontWeight: '700', flex: 1 },
  rulesButton: { minHeight: TOUCH, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rulesLabel: { fontSize: 13, fontWeight: '800' },
  meter: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.surfaceHigh, marginTop: -spacing.xs },
  meterFill: { height: '100%', borderRadius: 2 },
  notice: { padding: spacing.md, gap: spacing.sm },
  failureCard: { borderColor: colors.warn },
  pausedCard: { minHeight: 204, alignItems: 'center', justifyContent: 'center' },
  finished: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.xs },
  toolbar: { flexDirection: 'row', gap: spacing.xs },
  tool: {
    flex: 1, minHeight: TOUCH, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center',
    justifyContent: 'center', padding: spacing.xs, borderRadius: 12, borderWidth: 1, borderBottomWidth: 2,
    ...gameControlSurfaces.tool,
  },
  toolWarm: gameControlSurfaces.toolWarm,
  toolPressed: gameControlSurfaces.toolPressed,
  toolActive: gameControlSurfaces.active,
  toolDisabled: gameControlSurfaces.toolQuiet,
  toolLabel: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
