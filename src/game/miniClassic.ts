import { applyAlternateInput, createAlternateProgress, getAlternatePuzzle, isAlternateComplete, loadAlternateProgress, undoAlternateInput, type AlternateProgress } from './alternate';
import type { MiniMode } from './playFormat';
import { isSessionRules, type SessionRules } from './session';

export const MINI_CLASSIC_KEY = 'classic-mini';

export interface MiniClassicSession {
  version: 1;
  id: string;
  mode: MiniMode;
  difficulty: 'easy' | 'medium';
  index: number;
  progress: AlternateProgress;
  rules: SessionRules;
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

export function miniClassicTimeLimit(session: MiniClassicSession): number | null {
  return session.rules.timerMinutes > 0 ? session.rules.timerMinutes * 60_000 : null;
}

export function miniClassicStatus(session: MiniClassicSession): 'playing' | 'solved' | 'mistakes' | 'time' {
  if (isAlternateComplete(getAlternatePuzzle(session.mode, session.index), session.progress)) return 'solved';
  if (typeof session.rules.mistakes === 'number' && session.mistakes >= session.rules.mistakes) return 'mistakes';
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
      || !Number.isFinite(saved.elapsedMs) || saved.elapsedMs < 0
      || !Number.isSafeInteger(saved.mistakes) || saved.mistakes < 0
      || !Number.isSafeInteger(saved.startedAt) || saved.startedAt < 0) return null;
  const { index, progress } = loadAlternateProgress(saved.mode, saved.progress);
  if (index !== saved.index || progress.puzzleId !== saved.progress?.puzzleId) return null;
  const difficulty = saved.mode === 'mini-4' ? 'easy' : 'medium';
  return { ...saved, difficulty, index, progress };
}
