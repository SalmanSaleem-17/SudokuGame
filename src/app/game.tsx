import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type ScrollViewInstance } from 'react-native';

import { DIFFICULTY_NAMES } from '../engine/grader';
import { findConflicts } from '../engine/grid';
import { parseDateKey } from '../game/daily';
import { TECHNIQUE_PACKS } from '../game/learning';
import { EMPTY_OVERLAY, Overlay } from '../game/overlay';
import {
  SessionSlot,
  digitCounts,
  enterDigit,
  eraseCell,
  getSessionFailure,
  getSessionRules,
  getTimeLimitMs,
  incorrectCells,
  isGiven,
  redoMove,
  toggleNote,
  undoMove,
} from '../game/session';
import { appStore, clock, completeSession, flushSession, mutateSession, quitSession } from '../state/app';
import { useStore } from '../state/store';
import { Board } from '../ui/Board';
import { BrandTitle } from '../ui/Brand';
import { HintPanel } from '../ui/HintPanel';
import { Keypad } from '../ui/Keypad';
import { Motion } from '../ui/Motion';
import { TechniqueGuide } from '../ui/TechniqueGuide';
import { confirmQuitGame } from '../ui/confirmQuitGame';
import { Button, IconName, Screen } from '../ui/controls';
import { haptic, useAppActive, useBoardSize, useClockLabel, useScreenFocused } from '../ui/hooks';
import { TOUCH, colors, gameControlSurfaces, gradients, radius, spacing, type, useReducedMotion } from '../ui/theme';

/** Header, status, keypad, tools, frame, and vertical spacing. */
const TOOL_HEIGHT = 58;
const CHROME_HEIGHT = 58 + TOUCH + (TOUCH * 3 + 8) + TOOL_HEIGHT + 42;
const MODE_HUBS = {
  classic: { path: '/', label: 'Home' },
  daily: { path: '/daily', label: 'Daily Puzzle' },
  challenge: { path: '/challenge', label: 'Challenges' },
  weekly: { path: '/weekly', label: 'Weekly challenge' },
  technique: { path: '/practice/packs', label: 'Technique packs' },
} as const satisfies Record<SessionSlot, { path: string; label: string }>;

export default function GameScreen() {
  const params = useLocalSearchParams<{ slot?: string; source?: string }>();
  const slot: SessionSlot = params.slot === 'daily' || params.slot === 'challenge' || params.slot === 'technique' || params.slot === 'weekly'
    ? params.slot : 'classic';
  const { path: modeHome, label: modeLabel } = slot === 'classic' && params.source === 'saved-games'
    ? { path: '/saved-games' as const, label: 'Saved Games' }
    : MODE_HUBS[slot];
  const router = useRouter();
  const navigation = useNavigation();
  const session = useStore(appStore, (s) => s.sessions[slot]);
  const settings = useStore(appStore, (s) => s.settings);
  const reducedMotion = useReducedMotion();
  const credits = useStore(appStore, (s) => s.credits);
  const adIdle = useStore(appStore, (s) => s.reward.phase === 'idle');

  const [selected, setSelected] = useState<number | null>(null);
  const [armedDigit, setArmedDigit] = useState(0);
  const [notesMode, setNotesMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [quitState, setQuitState] = useState<'idle' | 'pending' | 'error'>('idle');
  const quitPending = useRef(false);
  const finishStarted = useRef<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const scrollPosition = useRef({ height: 0, offset: 0, beforeHint: 0 });
  const pendingScroll = useRef<'hint' | 'play' | null>(null);

  const appActive = useAppActive();
  const focused = useScreenFocused();
  const failure = session ? getSessionFailure(session) : null;
  const timeLimitMs = session ? getTimeLimitMs(session) : null;
  const mistakeRule = session ? getSessionRules(session).mistakes : 'off';
  const mistakeLimit = typeof mistakeRule === 'number' ? mistakeRule : null;
  const mistakeFeedback = mistakeLimit !== null || (mistakeRule !== 'off' && settings.mistakeFeedback);
  const showHint = hintOpen && !paused && !failure;
  const boardSize = useBoardSize(CHROME_HEIGHT, 12);

  /* ---- timer: runs only while the puzzle is on screen, unpaused, with no ad in progress ---- */
  const sessionId = session?.id ?? null;
  const running = !!session && !session.completed && !failure && focused && appActive && !paused && adIdle;
  useEffect(() => {
    const current = appStore.getState().sessions[slot];
    if (!current || current.id !== sessionId) return;
    if (running) {
      if (!clock.matches(slot, current.id)) clock.load(slot, current.elapsedMs, current.id);
      clock.start();
    } else if (clock.matches(slot, current.id)) {
      clock.stop();
      flushSession(slot);
    }
  }, [running, slot, sessionId]);
  useEffect(() => {
    if (!running || !sessionId || timeLimitMs === null || !clock.matches(slot, sessionId)) return;
    let timeout: ReturnType<typeof setTimeout>;
    const checkDeadline = () => {
      if (!clock.matches(slot, sessionId) || !clock.running) return;
      const remaining = timeLimitMs - clock.read();
      if (remaining <= 0) flushSession(slot);
      else timeout = setTimeout(checkDeadline, remaining);
    };
    timeout = setTimeout(checkDeadline, Math.max(0, timeLimitMs - clock.read()));
    return () => clearTimeout(timeout);
  }, [running, sessionId, slot, timeLimitMs]);
  useEffect(
    () => () => {
      if (!sessionId || !clock.matches(slot, sessionId)) return;
      clock.stop();
      flushSession(slot);
      clock.unload();
    },
    [slot, sessionId],
  );

  /* ---- completion: record once, then show results ---- */
  const completed = !!session?.completed;
  const quitting = quitState === 'pending';
  const finish = useCallback(() => {
    setFinishError(false);
    setFinishing(true);
    void completeSession(slot).then((id) => {
      if (id) router.replace({ pathname: '/results', params: { id } });
      else {
        setFinishing(false);
        setFinishError(true);
      }
    });
  }, [slot, router]);
  useEffect(() => {
    if (!completed || !sessionId || finishStarted.current === sessionId) return;
    finishStarted.current = sessionId;
    haptic('success');
    finish();
  }, [completed, sessionId, finish]);

  function requestQuit() {
    if (!sessionId || completed || quitPending.current || !adIdle) return;
    confirmQuitGame(() => {
      if (quitPending.current || !navigation.isFocused() || appStore.getState().reward.phase !== 'idle') return;
      quitPending.current = true;
      setQuitState('pending');
      void quitSession(slot, sessionId).then((removed) => {
        if (removed && navigation.isFocused()) router.dismissTo(modeHome);
        else setQuitState('idle');
      }, () => setQuitState('error')).finally(() => { quitPending.current = false; });
    });
  }

  /* ---- input ---- */
  const place = useCallback(
    (cell: number, digit: number) => {
      const before = appStore.getState().sessions[slot];
      if (!before || isGiven(before, cell)) return;
      const { smartNotes } = appStore.getState().settings;
      const next = mutateSession(slot, (s) =>
        notesMode ? toggleNote(s, cell, digit) : enterDigit(s, cell, digit, { smartNotes }),
      );
      if (!next || (next.values === before.values && next.notes === before.notes)) return;
      haptic(mistakeFeedback && next.mistakes > before.mistakes ? 'warn' : 'tap');
    },
    [slot, notesMode, mistakeFeedback],
  );

  const onCellPress = useCallback(
    (cell: number) => {
      setSelected(cell);
      if (appStore.getState().settings.numberFirst && armedDigit !== 0) place(cell, armedDigit);
    },
    [armedDigit, place],
  );

  const onDigit = useCallback(
    (digit: number) => {
      if (appStore.getState().settings.numberFirst) {
        setArmedDigit((current) => (current === digit ? 0 : digit));
      } else if (selected !== null) {
        place(selected, digit);
      }
    },
    [selected, place],
  );

  const onErase = useCallback(() => {
    if (selected !== null) mutateSession(slot, (s) => eraseCell(s, selected));
  }, [selected, slot]);

  const onUndo = useCallback(() => {
    mutateSession(slot, undoMove);
  }, [slot]);

  const onRedo = useCallback(() => {
    mutateSession(slot, redoMove);
  }, [slot]);

  const onToggleNotes = useCallback(() => setNotesMode((n) => !n), []);

  const openHint = useCallback(() => {
    scrollPosition.current.beforeHint = scrollPosition.current.offset;
    pendingScroll.current = 'hint';
    setHintOpen(true);
  }, []);

  const closeHint = useCallback(() => {
    pendingScroll.current = 'play';
    setHintOpen(false);
    setOverlay(EMPTY_OVERLAY);
  }, []);

  const positionControls = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    const mode = showHint ? 'hint' : 'play';
    if (pendingScroll.current !== mode) return;

    requestAnimationFrame(() => {
      if (pendingScroll.current !== mode) return;
      pendingScroll.current = null;
      const { height, offset, beforeHint } = scrollPosition.current;
      // Keep as much of the board visible as possible while revealing the hint controls.
      const panelTop = Math.max(0, layout.y - spacing.sm);
      const panelBottom = layout.y + layout.height + spacing.sm;
      const minOffset = Math.min(panelTop, Math.max(0, panelBottom - height));
      const nextOffset = showHint ? Math.max(minOffset, Math.min(offset, panelTop)) : beforeHint;
      if (Math.abs(nextOffset - offset) > 1) {
        scroll.current?.scrollTo({ y: nextOffset, animated: !reducedMotion });
      }
    });
  }, [reducedMotion, showHint]);

  const applyHint = useCallback(
    (cell: number, digit: number) => {
      const { smartNotes } = appStore.getState().settings;
      mutateSession(slot, (s) => {
        if (s.values[cell] === digit) return s;
        const next = enterDigit(s, cell, digit, { smartNotes });
        return slot === 'technique' && next !== s ? { ...next, hintsUsed: next.hintsUsed + 1 } : next;
      });
      setSelected(cell);
      closeHint();
    },
    [slot, closeHint],
  );

  const openPractice = useCallback(() => {
    closeHint();
    router.push('/practice');
  }, [closeHint, router]);

  function openTechniqueExample() {
    if (!session?.techniquePack) return;
    closeHint();
    router.push({ pathname: '/practice/packs', params: { pack: session.techniquePack, example: session.puzzleId } });
  }

  useEffect(() => {
    if (!showHint) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeHint();
      return true;
    });
    return () => subscription.remove();
  }, [showHint, closeHint]);

  /* ---- derived board data ---- */
  const values = session?.values;
  const errors = useMemo(() => {
    if (!session || !values) return new Set<number>();
    const set = findConflicts(values);
    if (mistakeFeedback) for (const cell of incorrectCells(session)) set.add(cell);
    return set;
    // `values` identity changes exactly when the board changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, mistakeFeedback]);
  const counts = useMemo(() => (values ? digitCounts(values) : undefined), [values]);
  const shownNotes = useMemo(() => {
    if (!session) return [];
    if (overlay.candidates.size === 0) return session.notes;
    const merged = session.notes.slice();
    overlay.candidates.forEach((mask, cell) => (merged[cell] = mask));
    return merged;
  }, [session, overlay]);

  if (!session) {
    return (
      <Screen title="">
        {!finishing && !quitting && (
          <View style={styles.empty}>
            <Text style={type.heading}>No puzzle in progress</Text>
            <Button
              label={modeLabel}
              variant="primary"
              onPress={() => router.dismissTo(modeHome)}
            />
          </View>
        )}
      </Screen>
    );
  }

  if (finishError && completed) {
    return (
      <Screen title="Puzzle complete">
        <View style={styles.empty}>
          <Text style={styles.overlayHeading}>Result could not be saved</Text>
          <Button label="Retry saving" variant="primary" onPress={finish} />
        </View>
      </Screen>
    );
  }

  const title =
    slot === 'daily' && session.dateKey
      ? `Daily · ${parseDateKey(session.dateKey).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
      : slot === 'challenge' ? 'Challenge'
        : slot === 'weekly' ? 'Weekly Challenge'
          : session.techniquePack ? TECHNIQUE_PACKS[session.techniquePack].title : 'Sudoku';
  const highlightDigit =
    settings.numberFirst && armedDigit !== 0 ? armedDigit : selected !== null ? session.values[selected] : 0;
  const hintsRemaining = credits + Number(!session.freeHintUsed);
  const showTimer = slot === 'challenge' || settings.timer || timeLimitMs !== null;
  const showMistakes = mistakeRule !== 'off' && (slot === 'challenge' || mistakeLimit !== null || settings.mistakeFeedback);
  const mistakesLabel = mistakeLimit === null ? `${session.mistakes}` : `${session.mistakes}/${mistakeLimit}`;
  const clearable = selected !== null && !isGiven(session, selected) && (session.values[selected] !== 0 || session.notes[selected] !== 0);
  const difficulty = DIFFICULTY_NAMES[session.difficulty];

  return (
    <Screen
      title={title}
      titleContent={slot === 'classic' ? <BrandTitle compact /> : undefined}
      onBack={showHint ? closeHint : undefined}
      right={
        !failure && !completed && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Resume' : 'Pause'}
            accessibilityState={{ disabled: showHint || quitting }}
            onPress={() => setPaused((p) => !p)}
            disabled={showHint || quitting}
            style={({ pressed }) => [
              gameControlSurfaces.toolWarm,
              paused && gameControlSurfaces.active,
              pressed && (paused ? styles.activePressed : gameControlSurfaces.toolPressed),
              (showHint || quitting) && gameControlSurfaces.toolQuiet,
              styles.pauseButton,
            ]}>
            <Ionicons name={paused ? 'play' : 'pause'} size={23}
              color={showHint || quitting ? colors.textFaint : paused ? colors.onAccent : colors.accent} />
          </Pressable>
        )
      }>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={showHint}
        scrollEventThrottle={32}
        onLayout={(event) => { scrollPosition.current.height = event.nativeEvent.layout.height; }}
        onScroll={(event) => { scrollPosition.current.offset = Math.max(0, event.nativeEvent.contentOffset.y); }}>
        <View style={[styles.statusRow, { width: boardSize }]}>
          <StatusItem>
            <Text style={styles.statusValue} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={`Difficulty ${difficulty}`}>
              {difficulty}
            </Text>
          </StatusItem>
          {showTimer && (
            <StatusItem icon="timer-outline">
              <TimerLabel
                sessionId={session.id}
                slot={slot}
                savedMs={session.elapsedMs}
                paused={paused}
                timeLimitMs={timeLimitMs}
                ticking={running}
              />
            </StatusItem>
          )}
          {showMistakes && (
            <StatusItem>
              <Text
                style={[styles.statusValue, failure === 'mistakes' && styles.warning]}
                numberOfLines={1}
                adjustsFontSizeToFit
                accessibilityLabel={mistakeLimit === null ? `Mistakes ${session.mistakes}` : `Mistakes ${session.mistakes} of ${mistakeLimit}`}>
                <Text style={styles.statusLabel}>Mistakes </Text>{mistakesLabel}
              </Text>
            </StatusItem>
          )}
        </View>

        {failure ? (
          <Motion reduced={reducedMotion} style={[styles.pausedBoard, { width: boardSize, minHeight: boardSize }]}>
            <Ionicons name={failure === 'time' ? 'hourglass-outline' : 'alert-circle-outline'} size={44} color={colors.accent} />
            <Text style={styles.overlayHeading} accessibilityRole="header">
              {failure === 'time' ? 'Time’s up' : 'Mistake limit reached'}
            </Text>
            <Button
              label={slot === 'classic' || slot === 'daily' ? 'New Game' : modeLabel}
              variant="primary"
              icon={slot === 'challenge' ? 'arrow-back' : 'play'}
              onPress={() => {
                if (slot === 'challenge') router.dismissTo({ pathname: '/challenge', params: { code: session.challengeCode } });
                else if (slot === 'classic' || slot === 'daily') router.replace('/new-game');
                else router.dismissTo(modeHome);
              }}
              style={styles.resume}
            />
            {!!session.mistakeReview?.length && (
              <Button
                label="Review mistakes"
                icon="search-outline"
                onPress={() => router.push({ pathname: '/mistake-review', params: { slot, attempt: session.id } })}
                style={styles.resume}
              />
            )}
            <Button label="Home" variant="ghost" onPress={() => router.replace('/')} style={styles.resume} />
          </Motion>
        ) : (
          <View style={styles.boardFrame}>
            {paused ? (
              <Motion reduced={reducedMotion} style={[styles.pausedBoard, { width: boardSize, minHeight: boardSize }]}>
                <Ionicons name="pause-circle-outline" size={48} color={colors.accent} />
                <Text style={styles.overlayHeading} accessibilityRole="header">Paused</Text>
                <Button label="Resume" variant="primary" icon="play" onPress={() => setPaused(false)} disabled={quitting} style={styles.resume} />
                <Button label={quitting ? 'Quitting…' : 'Quit Game'} variant="ghost" icon="exit-outline"
                  onPress={requestQuit} disabled={completed || quitting || !adIdle} style={styles.resume} />
                {quitState === 'error' && <Text accessibilityLiveRegion="polite" style={styles.quitError}>Could not quit the game. Try again.</Text>}
              </Motion>
            ) : (
              <Board
                size={boardSize}
                values={session.values}
                givens={session.givens}
                notes={shownNotes}
                selected={selected}
                highlightDigit={showHint ? 0 : highlightDigit}
                errors={errors}
                marks={overlay.marks}
                onCellPress={onCellPress}
                disabled={showHint}
              />
            )}
          </View>
        )}

        {!failure && (
          <View
            key={showHint ? 'hint' : 'play'}
            style={[styles.controls, { width: boardSize }]}
            onLayout={positionControls}>
            {showHint ? (
              <Motion reduced={reducedMotion}>
                {slot === 'technique' ? (
                  <TechniqueGuide
                    session={session}
                    onOverlay={setOverlay}
                    onApply={applyHint}
                    onClose={closeHint}
                    onExample={openTechniqueExample}
                  />
                ) : (
                  <HintPanel
                    session={session}
                    width={boardSize}
                    onOverlay={setOverlay}
                    onApply={applyHint}
                    onClose={closeHint}
                    onPractice={openPractice}
                  />
                )}
              </Motion>
            ) : (
              <>
                <View style={styles.tools}>
                  <Tool icon="arrow-undo-outline" label="Undo" onPress={onUndo} disabled={paused || session.undo.length === 0} />
                  <Tool icon="arrow-redo-outline" label="Redo" onPress={onRedo} disabled={paused || !session.redo?.length} />
                  <Tool icon="backspace-outline" label="Erase" onPress={onErase} disabled={paused || !clearable} />
                  <Tool
                    icon={notesMode ? 'pencil' : 'pencil-outline'}
                    label="Notes"
                    badge={notesMode ? 'On' : undefined}
                    checked={notesMode}
                    warm
                    onPress={onToggleNotes}
                    disabled={paused}
                  />
                  <Tool
                    icon="bulb-outline"
                    label={slot === 'technique' ? 'Guide' : 'Hint'}
                    cornerCount={slot === 'technique' ? undefined : hintsRemaining}
                    warm
                    onPress={openHint}
                    disabled={paused}
                  />
                </View>
                <Keypad
                  grid
                  counts={counts}
                  activeDigit={settings.numberFirst ? armedDigit : highlightDigit}
                  notesMode={notesMode}
                  keyHeight={TOUCH}
                  onDigit={onDigit}
                  disabled={paused}
                />
              </>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function StatusItem({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <View style={styles.statusItem}>
      {icon && <Ionicons name={icon} size={17} color={colors.accent} accessible={false} />}
      {children}
    </View>
  );
}

function TimerLabel({ slot, sessionId, savedMs, paused, timeLimitMs, ticking }: {
  slot: SessionSlot;
  sessionId: string;
  savedMs: number;
  paused: boolean;
  timeLimitMs: number | null;
  ticking: boolean;
}) {
  const label = useClockLabel(slot, sessionId, savedMs, timeLimitMs, ticking);
  return (
    <Text
      style={styles.statusValue}
      maxFontSizeMultiplier={1.4}
      numberOfLines={1}
      adjustsFontSizeToFit
      accessibilityLabel={`${timeLimitMs === null ? 'Time' : 'Time remaining'} ${label}${paused ? ', paused' : ''}`}>
      {label}
    </Text>
  );
}

interface ToolProps {
  icon: IconName;
  label: string;
  badge?: string;
  cornerCount?: number;
  checked?: boolean;
  warm?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function Tool({ icon, label, badge, cornerCount, checked, warm, disabled, onPress }: ToolProps) {
  const labelColor = disabled ? colors.textFaint : checked ? colors.onAccent : colors.text;
  const iconColor = disabled || checked ? labelColor : warm ? colors.accent : colors.textDim;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={checked === undefined ? 'button' : 'switch'}
      accessibilityLabel={cornerCount === undefined ? label : `${label}, ${cornerCount} ${cornerCount === 1 ? 'hint' : 'hints'} remaining`}
      accessibilityState={{ disabled: !!disabled, checked }}
      style={({ pressed }) => [
        styles.tool,
        warm && gameControlSurfaces.toolWarm,
        checked && gameControlSurfaces.active,
        pressed && (checked ? styles.activePressed : gameControlSurfaces.toolPressed),
        disabled && gameControlSurfaces.toolQuiet,
      ]}>
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={[styles.toolLabel, { color: labelColor }]} maxFontSizeMultiplier={1.5} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
      {badge && (
        <View style={[styles.toolBadge, checked && styles.toolBadgeActive, disabled && styles.toolBadgeQuiet]}>
          <Text style={[styles.toolBadgeText, { color: iconColor }]} maxFontSizeMultiplier={1.4} numberOfLines={1} adjustsFontSizeToFit>
            {badge}
          </Text>
        </View>
      )}
      {cornerCount !== undefined && (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.counterBadge, (cornerCount === 0 || disabled) && styles.counterBadgeQuiet]}>
          <Text allowFontScaling={false} style={[styles.counterBadgeText, (cornerCount === 0 || disabled) && styles.counterBadgeTextQuiet]}>
            {cornerCount > 99 ? '99+' : cornerCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  statusRow: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusItem: {
    flex: 1,
    flexDirection: 'row',
    minHeight: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: 5,
    backgroundColor: colors.surface,
    backgroundImage: gradients.panel,
    borderWidth: 1,
    borderColor: '#AD8542',
    borderRadius: 24,
  },
  statusLabel: { fontSize: 11, fontWeight: '700' },
  statusValue: { flexShrink: 1, fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  warning: { color: colors.warn },
  boardFrame: {
    backgroundColor: colors.surface,
    borderColor: colors.lineStrong,
    borderWidth: 1,
    borderRadius: 6,
  },
  pausedBoard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    backgroundImage: gradients.panel,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.xl,
  },
  overlayHeading: { ...type.heading, fontSize: 24, textAlign: 'center' },
  resume: { alignSelf: 'stretch' },
  quitError: { ...type.dim, color: colors.warn, textAlign: 'center' },
  controls: { gap: spacing.sm },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'stretch' },
  tool: {
    ...gameControlSurfaces.tool,
    flexGrow: 1,
    flexBasis: 0,
    minWidth: TOUCH,
    minHeight: TOOL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 3,
    paddingVertical: spacing.xs,
    borderRadius: 11,
    borderWidth: 1,
    borderBottomWidth: 2,
  },
  pauseButton: {
    width: TOUCH,
    height: TOUCH,
    borderWidth: 1.5,
    borderRadius: TOUCH / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePressed: { opacity: 0.85 },
  toolLabel: { fontSize: 11, fontWeight: '800', textAlign: 'center', includeFontPadding: false },
  toolBadge: { maxWidth: '100%', paddingHorizontal: spacing.xs, paddingVertical: 1, borderRadius: 6, backgroundColor: '#231A10' },
  toolBadgeActive: { backgroundColor: 'rgba(32, 20, 5, 0.15)' },
  toolBadgeQuiet: { backgroundColor: colors.bg },
  toolBadgeText: { fontSize: 9, fontWeight: '700', textAlign: 'center', includeFontPadding: false, fontVariant: ['tabular-nums'] },
  counterBadge: {
    position: 'absolute', top: -5, end: -2, height: 20, minWidth: 20, paddingHorizontal: 3,
    alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1.5, borderColor: colors.bg,
    backgroundColor: colors.accent,
  },
  counterBadgeQuiet: { backgroundColor: colors.surfaceHigh, borderColor: colors.lineStrong },
  counterBadgeText: { fontSize: 10, lineHeight: 12, fontWeight: '900', color: colors.onAccent, includeFontPadding: false, fontVariant: ['tabular-nums'] },
  counterBadgeTextQuiet: { color: colors.textDim },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
});
