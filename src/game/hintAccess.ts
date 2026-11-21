/**
 * Decides what a hint request costs. Pure logic; the debit itself happens in the
 * repository transaction that also stores the explanation.
 */
import { HintResult, computeHint } from '../engine/hints';
import { Session, StoredHint, boardKey } from './session';

export type HintOffer =
  /** Already revealed for this exact board: free to reopen. */
  | { kind: 'owned'; hint: StoredHint }
  /** A hint exists and can be revealed for this cost. */
  | { kind: 'available'; cost: 'free' | 'credit'; hint: StoredHint }
  /** A hint exists but the free hint is used and there are no credits. */
  | { kind: 'needCredits' }
  | Extract<HintResult, { kind: 'blocked' | 'none' | 'complete' }>;

export function evaluateHint(session: Session, credits: number): HintOffer {
  const key = boardKey(session.values);
  if (session.hint && session.hint.boardKey === key) return { kind: 'owned', hint: session.hint };
  const result = computeHint(session.values, session.solution);
  if (result.kind !== 'steps') return result;
  if (!session.freeHintUsed) return { kind: 'available', cost: 'free', hint: { boardKey: key, result } };
  if (credits > 0) return { kind: 'available', cost: 'credit', hint: { boardKey: key, result } };
  return { kind: 'needCredits' };
}

/** The session after a hint is revealed. The free allowance is consumed only here. */
export function withHintRevealed(session: Session, hint: StoredHint, cost: 'free' | 'credit'): Session {
  return {
    ...session,
    hint,
    hintsUsed: session.hintsUsed + 1,
    freeHintUsed: cost === 'free' ? true : session.freeHintUsed,
  };
}
