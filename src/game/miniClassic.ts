import { applyAlternateInput, createAlternateProgress, getAlternatePuzzle, isAlternateComplete, loadAlternateProgress, undoAlternateInput, type AlternateProgress } from './alternate';
import type { MiniMode } from './playFormat';
import { DEFAULT_SESSION_RULES, isSessionLevel, isSessionRules, type SessionLevel, type SessionRules } from './session';

export const MINI_CLASSIC_KEY = 'classic-mini';
/** Easy and Medium level attempts are saved apart from the Play Now mini game. */
export const MINI_LEVEL_KEY = 'level-mini';

export interface MiniClassicSession {
  version: 1;
  id: string;
  mode: MiniMode;
  difficulty: 'easy' | 'medium';
  index: number;
  progress: AlternateProgress;
  rules: SessionRules;
  /** Extra mistakes earned from optional ads in a Play Now game with a mistake limit. */
  extraMistakes?: number;
  /** Present only for an Easy or Medium level attempt. */
  level?: SessionLevel;
  elapsedMs: number;
  mistakes: number;
  startedAt: number;
}

export function createMiniClassic(mode: MiniMode, index: number, rules: SessionRules, id: string, startedAt: number): MiniClassicSession {
  return {
    version: 1, id, mode, difficulty: mode === 'mini-4' ? 'easy' : 'medium', index,
    progress: createAlternateProgress(getAlternatePuzzle(mode, index)),
    rules: { ...rules }, elapsedMs: 0, mistakes: 0, startedAt,
  };
}

/** Starts an Easy (4×4) or Medium (6×6) level attempt on the given puzzle. */
export function createMiniLevel(mode: MiniMode, index: number, level: Omit<SessionLevel, 'extraMistakes'>, id: string, startedAt: number): MiniClassicSession {
  return { ...createMiniClassic(mode, index, DEFAULT_SESSION_RULES, id, startedAt), level: { ...level, extraMistakes: 0 } };
}

export function miniClassicTimeLimit(session: MiniClassicSession): number | null {
  if (session.level) {
    const { timeLimitSec, extraTimeSec = 0 } = session.level;
    return timeLimitSec > 0 ? (timeLimitSec + extraTimeSec) * 1000 : null;
  }
  return session.rules.timerMinutes > 0 ? session.rules.timerMinutes * 60_000 : null;
}

/** The number of mistakes that ends the game, or null when mistakes never end it. */
export function miniMistakeLimit(session: MiniClassicSession): number | null {
  if (session.level) return session.level.mistakeLimit + session.level.extraMistakes;
  return typeof session.rules.mistakes === 'number' ? session.rules.mistakes + (session.extraMistakes ?? 0) : null;
}

export function miniClassicStatus(session: MiniClassicSession): 'playing' | 'solved' | 'mistakes' | 'time' {
  if (isAlternateComplete(getAlternatePuzzle(session.mode, session.index), session.progress)) return 'solved';
  const mistakeLimit = miniMistakeLimit(session);
  if (mistakeLimit !== null && session.mistakes >= mistakeLimit) return 'mistakes';
  const limit = miniClassicTimeLimit(session);
  return limit !== null && session.elapsedMs >= limit ? 'time' : 'playing';
}

export function enterMiniClassic(session: MiniClassicSession, cell: number, digit: number, notesMode: boolean, smartNotes: boolean): MiniClassicSession {
  if (miniClassicStatus(session) !== 'playing') return session;
  const puzzle = getAlternatePuzzle(session.mode, session.index);
  const progress = applyAlternateInput(puzzle, session.progress, cell, digit, notesMode, smartNotes);
  if (progress === session.progress) return session;
  const mistake = session.rules.mistakes !== 'off' && !notesMode && digit !== 0 && digit !== puzzle.solution[cell];
  return { ...session, progress, mistakes: session.mistakes + Number(mistake) };
}

export function undoMiniClassic(session: MiniClassicSession): MiniClassicSession {
  if (miniClassicStatus(session) !== 'playing') return session;
  const progress = undoAlternateInput(session.progress);
  return progress === session.progress ? session : { ...session, progress };
}

export function readMiniClassic(value: unknown): MiniClassicSession | null {
  const saved = value as MiniClassicSession | null;
  if (!saved || saved.version !== 1 || typeof saved.id !== 'string' || !saved.id
      || (saved.mode !== 'mini-4' && saved.mode !== 'mini-6') || !isSessionRules(saved.rules)
      || (saved.level !== undefined && !isSessionLevel(saved.level))
      || (saved.extraMistakes !== undefined && (!Number.isSafeInteger(saved.extraMistakes) || saved.extraMistakes < 0))
      || !Number.isFinite(saved.elapsedMs) || saved.elapsedMs < 0
      || !Number.isSafeInteger(saved.mistakes) || saved.mistakes < 0
      || !Number.isSafeInteger(saved.startedAt) || saved.startedAt < 0) return null;
  const { index, progress } = loadAlternateProgress(saved.mode, saved.progress);
  if (index !== saved.index || progress.puzzleId !== saved.progress?.puzzleId) return null;
  const difficulty = saved.mode === 'mini-4' ? 'easy' : 'medium';
  return { ...saved, difficulty, index, progress };
}
