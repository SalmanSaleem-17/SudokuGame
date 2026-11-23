import { getPuzzle } from '../data/pool';
import type { PuzzleRecord } from '../engine/pool';
import type { SessionRules } from './session';

export interface Challenge {
  code: string;
  puzzle: PuzzleRecord;
  rules: SessionRules;
}

export interface ChallengeScore {
  challengeCode: string;
  sessionId: string;
  timeMs: number;
  mistakes: number;
  hints: number;
}

const INVITE = 'SDC1';
const RESULT = 'SDR1';
const TIMERS = [0, 5, 10, 15] as const;
const MISTAKES = ['off', 3, 5, 'unlimited'] as const;
const DIFFICULTY_KEYS = [['E', 'easy'], ['M', 'medium'], ['H', 'hard'], ['X', 'expert']] as const;
const MAX_PASTE_LENGTH = 4096;
const NONCE_WIDTH = 10;
const CHECK_WIDTH = 4;
const MAX_SESSION_ID_LENGTH = 64;

function base36(value: number, width = 0): string {
  return value.toString(36).toUpperCase().padStart(width, '0');
}

/** FNV-1a fingerprint for version 1 codes, also used to catch copy errors. */
function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

function puzzleFingerprint(puzzle: PuzzleRecord): string {
  return base36(hash32(`${puzzle.difficulty}:${puzzle.givens}`), 7);
}

function checkedCode(prefix: string, parts: string[]): string {
  const body = `${prefix}-${parts.join('-')}`;
  return `${body}-${base36(hash32(body) % 36 ** CHECK_WIDTH, CHECK_WIDTH)}`;
}

function readCode(text: string, prefix: typeof INVITE | typeof RESULT): string[] {
  const name = prefix === INVITE ? 'challenge' : 'result';
  const pasted = text.trim();
  if (pasted.length > MAX_PASTE_LENGTH) throw new Error(`Paste one ${name} code or its share message.`);
  const normalized = pasted.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u200B-\u200D\uFEFF]/g, '').toUpperCase();
  const tokens = normalized.match(/\bSD[CR][0-9]+-[A-Z0-9_-]+/g) ?? [];
  const expectedKind = prefix.slice(0, -1);
  const codes = [...new Set(tokens.filter((token) => token.startsWith(expectedKind)))];
  if (codes.length === 0) {
    if (tokens.length > 0) {
      throw new Error(prefix === INVITE ? 'Paste the challenge invitation here. That code is a result.' : 'Paste your friend’s result code here. That code is an invitation.');
    }
    throw new Error(`Paste the ${name} code your friend shared.`);
  }
  if (codes.length > 1) throw new Error(`Paste one ${name} code at a time.`);

  const code = codes[0];
  const [version, ...tail] = code.split('-');
  if (version !== prefix) throw new Error(`Update Sudoku Studio to use this version of the ${name} code.`);
  const parts = tail.slice(0, -1);
  if (checkedCode(prefix, parts) !== code) throw new Error(`Check the ${name} code and paste it again.`);
  return parts;
}

function packRules(rules: SessionRules): string {
  const timer = TIMERS.indexOf(rules.timerMinutes);
  const mistakes = MISTAKES.indexOf(rules.mistakes);
  if (timer < 0 || mistakes < 0) throw new Error('Choose valid timer and mistake options for the challenge.');
  return `${timer}${mistakes}`;
}

/** The v1 puzzle key identifies a catalog ID, independently of catalog order. */
function puzzleKey(puzzle: PuzzleRecord): string {
  const key = DIFFICULTY_KEYS.find(([, difficulty]) => difficulty === puzzle.difficulty)?.[0];
  const match = /-([0-9]{3})$/.exec(puzzle.id);
  if (!key || !match || Number(match[1]) === 0 || puzzle.id !== `${puzzle.difficulty}-${match[1]}`) {
    throw new Error('Choose a puzzle from the bundled Sudoku Studio catalog.');
  }
  return `${key}${base36(Number(match[1]), 2)}`;
}

function decodeRound(parts: string[]) {
  const [key, detail, nonce] = parts;
  if (parts.length !== 3 || !/^[EMHX][0-9A-Z]{2}$/.test(key) || !/^[0-3]{2}[0-9A-Z]{7}$/.test(detail) || !/^[0-9A-Z]{10}$/.test(nonce)) {
    throw new Error('Check the challenge code and paste it again.');
  }
  const difficulty = DIFFICULTY_KEYS.find(([letter]) => letter === key[0])?.[1];
  const number = Number.parseInt(key.slice(1), 36);
  if (!difficulty || number === 0 || number > 999) throw new Error('The challenge code has an invalid puzzle ID.');
  const rules: SessionRules = { timerMinutes: TIMERS[Number(detail[0])], mistakes: MISTAKES[Number(detail[1])] };
  return {
    code: checkedCode(INVITE, parts),
    puzzleId: `${difficulty}-${String(number).padStart(3, '0')}`,
    fingerprint: detail.slice(2),
    rules,
  };
}

export function createChallenge(puzzle: PuzzleRecord, rules: SessionRules): Challenge {
  const localPuzzle = getPuzzle(puzzle.id);
  if (!localPuzzle || localPuzzle.givens !== puzzle.givens || localPuzzle.difficulty !== puzzle.difficulty) {
    throw new Error('Choose a puzzle from the bundled Sudoku Studio catalog.');
  }
  const nonce = base36(Math.floor(Math.random() * 36 ** NONCE_WIDTH), NONCE_WIDTH);
  const parts = [puzzleKey(localPuzzle), `${packRules(rules)}${puzzleFingerprint(localPuzzle)}`, nonce];
  return { code: checkedCode(INVITE, parts), puzzle: localPuzzle, rules: { ...rules } };
}

export function decodeChallenge(text: string): Challenge {
  const round = decodeRound(readCode(text, INVITE));
  const puzzle = getPuzzle(round.puzzleId);
  if (!puzzle || puzzleFingerprint(puzzle) !== round.fingerprint) {
    throw new Error('This app has a different version of that puzzle. Update Sudoku Studio or ask your friend for a new challenge.');
  }
  return { code: round.code, puzzle, rules: round.rules };
}

export function decodeChallengeRules(text: string): SessionRules {
  return decodeRound(readCode(text, INVITE)).rules;
}

function validateScore(score: ChallengeScore, rules: SessionRules) {
  if (score.sessionId.length > MAX_SESSION_ID_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(score.sessionId)) {
    throw new Error('The result code has an invalid session ID.');
  }
  const stats = [score.timeMs, score.mistakes, score.hints];
  if (stats.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('The result must include a valid time, mistake count and hint count.');
  }
  if (
    (rules.timerMinutes > 0 && score.timeMs > rules.timerMinutes * 60_000) ||
    (typeof rules.mistakes === 'number' && score.mistakes >= rules.mistakes) ||
    (rules.mistakes === 'off' && score.mistakes !== 0)
  ) {
    throw new Error('The result exceeds the limits for this challenge.');
  }
}

function readScoreNumber(value: string): number {
  if (!/^(?:0|[1-9A-Z][0-9A-Z]{0,10})$/.test(value)) throw new Error('Check the result code and paste it again.');
  return Number.parseInt(value, 36);
}

export function encodeChallengeScore(score: ChallengeScore): string {
  const parts = readCode(score.challengeCode, INVITE);
  const round = decodeRound(parts);
  validateScore(score, round.rules);
  return checkedCode(RESULT, [
    ...parts,
    score.sessionId.toUpperCase(),
    base36(score.timeMs),
    base36(score.mistakes),
    base36(score.hints),
  ]);
}

export function decodeChallengeScore(text: string): ChallengeScore {
  const parts = readCode(text, RESULT);
  if (parts.length < 7) throw new Error('Check the result code and paste it again.');
  const round = decodeRound(parts.slice(0, 3));
  const [time, mistakes, hints] = parts.slice(-3);
  const score: ChallengeScore = {
    challengeCode: round.code,
    sessionId: parts.slice(3, -3).join('-').toLowerCase(),
    timeMs: readScoreNumber(time),
    mistakes: readScoreNumber(mistakes),
    hints: readScoreNumber(hints),
  };
  validateScore(score, round.rules);
  return score;
}

export function describeChallengeRules(rules: SessionRules): string {
  const timer = rules.timerMinutes === 0 ? 'No time limit' : `${rules.timerMinutes}-minute timer`;
  const mistakes = rules.mistakes === 'off' ? 'Mistake counter off'
    : rules.mistakes === 'unlimited' ? 'Unlimited mistakes' : `${rules.mistakes}-mistake limit`;
  return `${timer} · ${mistakes}`;
}
