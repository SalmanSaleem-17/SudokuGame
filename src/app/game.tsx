import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DIFFICULTY_NAMES } from '../engine/grader';
import { findConflicts } from '../engine/grid';
import { parseDateKey } from '../game/daily';
import { EMPTY_OVERLAY, Overlay } from '../game/overlay';
import {
  SessionSlot,
  digitCounts,
  enterDigit,
  eraseCell,
  incorrectCells,
  isGiven,
  toggleNote,
  undoMove,
} from '../game/session';
import { appStore, clock, completeSession, flushSession, mutateSession } from '../state/app';
import { useStore } from '../state/store';
import { Board } from '../ui/Board';
import { HintPanel } from '../ui/HintPanel';
import { Keypad } from '../ui/Keypad';
import { Motion } from '../ui/Motion';
import { Button, IconButton, IconName, Screen } from '../ui/controls';
import { haptic, useAppActive, useBoardSize, useClockLabel, useScreenFocused } from '../ui/hooks';
import { colors, radius, spacing, type, useReducedMotion } from '../ui/theme';

/** Header, status row, tools, keypad and gaps around the board. */
const CHROME_HEIGHT = 56 + 44 + 62 + 56 + 44;
const HINT_EXTRA_HEIGHT = 130;

export default function GameScreen() {
  const params = useLocalSearchParams<{ slot?: string }>();
  const slot: SessionSlot = params.slot === 'daily' ? 'daily' : 'classic';
  const router = useRouter();
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
  const finishStarted = useRef(false);

  const appActive = useAppActive();
  const focused = useScreenFocused();
  // The hint panel is taller than the keypad, so the board gives up some height on short screens.
  const boardSize = useBoardSize(hintOpen && !paused ? CHROME_HEIGHT + HINT_EXTRA_HEIGHT : CHROME_HEIGHT);

  /* ---- timer: runs only while the puzzle is on screen, unpaused, with no ad in progress ---- */
  const sessionId = session?.id ?? null;
  const loadedId = useRef<string | null>(null);
  const running = !!session && !session.completed && focused && appActive && !paused && adIdle;
  useEffect(() => {
    const current = appStore.getState().sessions[slot];
    if (current && loadedId.current !== current.id) {
      clock.load(slot, current.elapsedMs);
      loadedId.current = current.id;
    }
    if (running) {
      clock.start();
    } else {
      clock.stop();
      flushSession(slot);
    }
  }, [running, slot, sessionId]);
  useEffect(
    () => () => {
      clock.stop();
      flushSession(slot);
      if (clock.slot === slot) clock.unload();
    },
    [slot],
  );

  /* ---- completion: record once, then show results ---- */
  const completed = !!session?.completed;
  useEffect(() => {
    if (!completed || finishStarted.current) return;
    finishStarted.current = true;
    setFinishing(true);
    haptic('success');
    void completeSession(slot).then((id) => {
      if (id) router.replace({ pathname: '/results', params: { id } });
      else router.replace('/');
    });
  }, [completed, slot, router]);

  /* ---- input ---- */
  const place = useCallback(
    (cell: number, digit: number) => {
      const before = appStore.getState().sessions[slot];
      if (!before || isGiven(before, cell)) return;
      const { smartNotes, mistakeFeedback } = appStore.getState().settings;
      const next = mutateSession(slot, (s) =>
        notesMode ? toggleNote(s, cell, digit) : enterDigit(s, cell, digit, { smartNotes }),
      );
      if (!next || next === before) return;
      haptic(mistakeFeedback && next.mistakes > before.mistakes ? 'warn' : 'tap');
    },
    [slot, notesMode],
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

  const closeHint = useCallback(() => {
    setHintOpen(false);
    setOverlay(EMPTY_OVERLAY);
  }, []);

  const applyHint = useCallback(
    (cell: number, digit: number) => {
      const { smartNotes } = appStore.getState().settings;
      mutateSession(slot, (s) => (s.values[cell] === digit ? s : enterDigit(s, cell, digit, { smartNotes })));
      setSelected(cell);
      closeHint();
    },
    [slot, closeHint],
  );

  const openPractice = useCallback(() => {
    closeHint();
    router.push('/practice');
  }, [closeHint, router]);

  useEffect(() => {
    if (!hintOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeHint();
      return true;
    });
    return () => subscription.remove();
  }, [hintOpen, closeHint]);

  /* ---- derived board data ---- */
  const values = session?.values;
  const mistakeFeedback = settings.mistakeFeedback;
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
        {!finishing && (
          <View style={styles.empty}>
            <Text style={type.heading}>No puzzle in progress</Text>
            <Button label="Home" variant="primary" onPress={() => router.replace('/')} />
          </View>
        )}
      </Screen>
    );
  }

  const title =
    slot === 'daily' && session.dateKey
      ? `Daily · ${parseDateKey(session.dateKey).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
      : DIFFICULTY_NAMES[session.difficulty];
  const highlightDigit =
    settings.numberFirst && armedDigit !== 0 ? armedDigit : selected !== null ? session.values[selected] : 0;
  const hintLabel = !session.freeHintUsed ? '1 free' : `${credits} ${credits === 1 ? 'credit' : 'credits'}`;

  return (
    <Screen
      title={title}
      right={
        <IconButton
          icon={paused ? 'play' : 'pause'}
          label={paused ? 'Resume' : 'Pause'}
          onPress={() => setPaused((p) => !p)}
          disabled={hintOpen}
        />
      }>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.statusRow, { width: boardSize }]}>
          <View style={styles.statusItem}>
            <Ionicons name="grid-outline" size={16} color={colors.accent} />
            <Text style={styles.statusText}>{mistakeFeedback ? `Mistakes ${session.mistakes}` : DIFFICULTY_NAMES[session.difficulty]}</Text>
          </View>
          {settings.timer && (
            <View style={styles.statusItem}>
              <Ionicons name="time-outline" size={18} color={colors.textDim} />
              <TimerLabel slot={slot} savedMs={session.elapsedMs} paused={!running} />
            </View>
          )}
        </View>

        {paused ? (
          <Motion reduced={reducedMotion} style={[styles.pausedBoard, { width: boardSize, height: boardSize }]}>
            <Ionicons name="pause-circle-outline" size={56} color={colors.accent} />
            <Text style={type.heading}>Paused</Text>
            <Button label="Resume" variant="primary" icon="play" onPress={() => setPaused(false)} style={styles.resume} />
          </Motion>
        ) : (
          <Board
            size={boardSize}
            values={session.values}
            givens={session.givens}
            notes={shownNotes}
            selected={selected}
            highlightDigit={hintOpen ? 0 : highlightDigit}
            errors={errors}
            marks={overlay.marks}
            onCellPress={onCellPress}
            disabled={hintOpen}
          />
        )}

        <View style={[styles.controls, { width: boardSize }]}>
          {hintOpen && !paused ? (
            <Motion reduced={reducedMotion}>
              <HintPanel session={session} onOverlay={setOverlay} onApply={applyHint} onClose={closeHint} onPractice={openPractice} />
            </Motion>
          ) : (
            <>
              <View style={styles.tools}>
                <Tool icon="arrow-undo" label="Undo" onPress={onUndo} disabled={paused || session.undo.length === 0} />
                <Tool icon="backspace-outline" label="Erase" onPress={onErase} disabled={paused || selected === null} />
                <Tool
                  icon={notesMode ? 'pencil' : 'pencil-outline'}
                  label="Notes"
                  detail={notesMode ? 'On' : 'Off'}
                  active={notesMode}
                  onPress={() => setNotesMode((n) => !n)}
                  disabled={paused}
                />
                <Tool icon="bulb-outline" label="Hint" detail={hintLabel} onPress={() => setHintOpen(true)} disabled={paused} />
              </View>
              <Keypad
                counts={counts}
                activeDigit={settings.numberFirst ? armedDigit : 0}
                notesMode={notesMode}
                onDigit={onDigit}
                disabled={paused}
              />
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function TimerLabel({ slot, savedMs, paused }: { slot: SessionSlot; savedMs: number; paused: boolean }) {
  const label = useClockLabel(slot, savedMs);
  return (
    <Text style={styles.timer} accessibilityLabel={`Time ${label}${paused ? ', paused' : ''}`}>
      {label}
    </Text>
  );
}

interface ToolProps {
  icon: IconName;
  label: string;
  detail?: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function Tool({ icon, label, detail, active, disabled, onPress }: ToolProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={({ pressed }) => [
        styles.tool,
        active && styles.toolActive,
        pressed && (active ? styles.toolActivePressed : styles.toolPressed),
        disabled && styles.toolDisabled,
      ]}>
      <Ionicons name={icon} size={21} color={active ? colors.onAccent : colors.accent} />
      <Text style={[styles.toolLabel, active && { color: colors.onAccent }]} numberOfLines={1}>
        {label}
      </Text>
      {detail && <Text style={[styles.toolDetail, active && { color: colors.onAccent }]} numberOfLines={1}>{detail}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  statusRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  statusText: { ...type.label, flexShrink: 1 },
  timer: { fontSize: 16, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  pausedBoard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.xl,
  },
  resume: { marginTop: spacing.md, alignSelf: 'stretch' },
  controls: { gap: spacing.md },
  tools: { flexDirection: 'row', gap: spacing.sm },
  tool: {
    flex: 1,
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  toolActive: { backgroundColor: colors.accent, borderColor: colors.onAccent },
  toolActivePressed: { backgroundColor: colors.accentPressed },
  toolPressed: { backgroundColor: colors.surfaceHigh },
  toolDisabled: { opacity: 0.4 },
  toolLabel: { fontSize: 12, fontWeight: '700', color: colors.text },
  toolDetail: { fontSize: 10, color: colors.textDim },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
});
