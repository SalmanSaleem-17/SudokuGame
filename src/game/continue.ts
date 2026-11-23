/**
 * Continuing a game that just ended, with one optional ad: one more mistake after the
 * mistake limit, or more time after a level's clock ran out. Pure rules; the ad and the
 * save live in the app state.
 */
import type { Difficulty } from '../engine/grader';
import { MAX_EXTRA_MISTAKES } from './levels';
import { miniClassicStatus, type MiniClassicSession } from './miniClassic';
import { getSessionFailure, type Session, type SessionLevel } from './session';

/** Seconds one ad adds to a level whose time ran out. */
export const LEVEL_EXTRA_TIME_SEC: Record<Difficulty, number> = { easy: 30, medium: 30, hard: 60, expert: 60 };
/** How many times a single level attempt can be given more time: as often as it can be given a mistake. */
export const MAX_EXTRA_TIME = MAX_EXTRA_MISTAKES;

export type ContinueOffer =
  | { kind: 'mistake'; left: number; max: number }
  | { kind: 'time'; left: number; max: number; seconds: number };

function levelOffer(level: SessionLevel, difficulty: Difficulty, failure: 'mistakes' | 'time'): ContinueOffer | null {
  if (failure === 'mistakes') {
    const left = MAX_EXTRA_MISTAKES - level.extraMistakes;
    return left > 0 ? { kind: 'mistake', left, max: MAX_EXTRA_MISTAKES } : null;
  }
  const seconds = LEVEL_EXTRA_TIME_SEC[difficulty];
  const left = MAX_EXTRA_TIME - Math.round((level.extraTimeSec ?? 0) / seconds);
  return left > 0 ? { kind: 'time', left, max: MAX_EXTRA_TIME, seconds } : null;
}

function playNowOffer(extraMistakes: number | undefined): ContinueOffer | null {
  const left = MAX_EXTRA_MISTAKES - (extraMistakes ?? 0);
  return left > 0 ? { kind: 'mistake', left, max: MAX_EXTRA_MISTAKES } : null;
}

function withLevelExtra(level: SessionLevel, offer: ContinueOffer): SessionLevel {
  return offer.kind === 'mistake'
    ? { ...level, extraMistakes: level.extraMistakes + 1 }
    : { ...level, extraTimeSec: (level.extraTimeSec ?? 0) + offer.seconds };
}

/**
 * What an ad can add to a 9×9 game that has ended: levels can continue after mistakes or
 * time; a Play Now game can continue after its mistake limit. Challenges, daily and weekly
 * puzzles are never continued, so results stay comparable.
 */
export function boardContinueOffer(session: Session): ContinueOffer | null {
  const failure = session.completed ? null : getSessionFailure(session);
  if (!failure) return null;
  if (session.slot === 'level' && session.level) return levelOffer(session.level, session.difficulty, failure);
  return session.slot === 'classic' && failure === 'mistakes' ? playNowOffer(session.extraMistakes) : null;
}

export function applyBoardContinue(session: Session): Session | null {
  const offer = boardContinueOffer(session);
  if (!offer) return null;
  if (session.slot === 'level' && session.level) return { ...session, level: withLevelExtra(session.level, offer) };
  return { ...session, extraMistakes: (session.extraMistakes ?? 0) + 1 };
}

/** The same rules for a game on a 4×4 or 6×6 board. */
export function miniContinueOffer(session: MiniClassicSession): ContinueOffer | null {
  const status = miniClassicStatus(session);
  if (status !== 'mistakes' && status !== 'time') return null;
  if (session.level) return levelOffer(session.level, session.difficulty, status);
  return status === 'mistakes' ? playNowOffer(session.extraMistakes) : null;
}

export function applyMiniContinue(session: MiniClassicSession): MiniClassicSession | null {
  const offer = miniContinueOffer(session);
  if (!offer) return null;
  if (session.level) return { ...session, level: withLevelExtra(session.level, offer) };
  return { ...session, extraMistakes: (session.extraMistakes ?? 0) + 1 };
}

/** "30 seconds" or "1 minute", for buttons. */
export function formatExtraTime(seconds: number): string {
  if (seconds % 60 === 0) return seconds === 60 ? '1 minute' : `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}
