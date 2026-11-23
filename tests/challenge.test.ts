import { afterEach, describe, expect, it, vi } from 'vitest';

import { PUZZLES, puzzlesOf } from '../src/data/pool';
import {
  createChallenge,
  decodeChallenge,
  decodeChallengeScore,
  describeChallengeRules,
  encodeChallengeScore,
  type ChallengeScore,
} from '../src/game/challenge';
import { STORE_URL } from '../src/game/links';
import type { SessionRules } from '../src/game/session';

const puzzle = PUZZLES[0];
const untimed: SessionRules = { timerMinutes: 0, mistakes: 'unlimited' };
const limited: SessionRules = { timerMinutes: 5, mistakes: 3 };
const sample: ChallengeScore = {
  challengeCode: 'SDC1-E01-110SVBVQF-9000000000-LSWW',
  sessionId: 'sample-q2',
  timeMs: 125005,
  mistakes: 2,
  hints: 1,
};
const sampleResult = 'SDR1-E01-110SVBVQF-9000000000-SAMPLE-Q2-2OGD-2-1-PS8I';

afterEach(() => vi.restoreAllMocks());

describe('challenge invitations', () => {
  it('keeps the version-one wire format stable without putting the puzzle or solution in the code', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const challenge = createChallenge(puzzle, limited);
    expect(challenge.code).toBe(sample.challengeCode);
    expect(challenge.code).not.toContain(puzzle.givens);
    expect(challenge.code).not.toContain(puzzle.solution);
    expect(decodeChallenge(sample.challengeCode)).toEqual(challenge);
  });

  it('round-trips every rule combination and difficulty, including catalog IDs beyond 35', () => {
    const puzzles = [puzzle, puzzlesOf('medium').at(-1)!, puzzlesOf('hard').at(-1)!, puzzlesOf('expert').at(-1)!];
    for (const local of puzzles) {
      for (const timerMinutes of [0, 5, 10, 15] as const) {
        for (const mistakes of ['off', 3, 5, 'unlimited'] as const) {
          const rules = { timerMinutes, mistakes };
          const challenge = createChallenge(local, rules);
          expect(decodeChallenge(challenge.code)).toEqual({ code: challenge.code, puzzle: local, rules });
        }
      }
    }
    expect(describeChallengeRules(limited)).toBe('5-minute timer · 3-mistake limit');
    expect(describeChallengeRules(untimed)).toBe('No time limit · Unlimited mistakes');
  });

  it('accepts the share message and normalizes case, spacing and copied hyphens', () => {
    const text = `\nTry my Sudoku Studio puzzle!\nCode: \`${sample.challengeCode.toLowerCase().replaceAll('-', '\u2011')}\`\n`;
    expect(decodeChallenge(text).code).toBe(sample.challengeCode);
    expect(decodeChallenge(` ${sample.challengeCode} `).code).toBe(sample.challengeCode);
  });

  it('still reads a code from a share message that ends with the Google Play link', () => {
    const link = `Get Sudoku Studio: ${STORE_URL}`;
    expect(STORE_URL).toBe('https://play.google.com/store/apps/details?id=com.sudoku.studio');
    expect(decodeChallenge(`Try my Sudoku Studio challenge\n\n${sample.challengeCode}\n\nOpen Challenge a Friend in Sudoku Studio and paste this message.\n\n${link}`).code)
      .toBe(sample.challengeCode);
    const result = encodeChallengeScore(sample);
    expect(decodeChallengeScore(`Sudoku Studio challenge result\n\n${result}\n\nPaste this result code into Sudoku Studio to compare times.\n\n${link}`))
      .toEqual(decodeChallengeScore(result));
  });

  it('rejects a different puzzle under the same catalog ID', () => {
    const original = puzzle.givens;
    try {
      puzzle.givens = PUZZLES[1].givens;
      expect(() => decodeChallenge(sample.challengeCode)).toThrow(/different version of that puzzle/);
    } finally {
      puzzle.givens = original;
    }
    expect(() => createChallenge({ ...puzzle, id: 'easy-999' }, limited)).toThrow(/bundled Sudoku Studio catalog/);
  });

  it('rejects malformed, mistyped, ambiguous and unsupported invitations', () => {
    expect(() => decodeChallenge('random text')).toThrow(/challenge code/);
    expect(() => decodeChallenge(`${sample.challengeCode.slice(0, -1)}A`)).toThrow(/Check the challenge code/);
    expect(() => decodeChallenge(sample.challengeCode.replace('SDC1', 'SDC2'))).toThrow(/Update Sudoku Studio/);
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const anotherRound = createChallenge(puzzle, limited);
    expect(() => decodeChallenge(`${sample.challengeCode}\n${anotherRound.code}`)).toThrow(/one challenge code at a time/);
    expect(() => decodeChallenge(sampleResult)).toThrow(/That code is a result/);
  });
});

describe('challenge results', () => {
  it('round-trips the full score without losing milliseconds and accepts shared text', () => {
    expect(encodeChallengeScore(sample)).toBe(sampleResult);
    expect(decodeChallengeScore(sampleResult)).toEqual(sample);
    expect(decodeChallengeScore(`My Sudoku result: ${sampleResult.toLowerCase()}\nCan you beat it?`)).toEqual(sample);
  });

  it('keeps results tied to the exact round when playing the same puzzle and rules', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const anotherRound = createChallenge(puzzle, limited);
    const foreignResult = decodeChallengeScore(encodeChallengeScore({ ...sample, challengeCode: anotherRound.code }));
    expect(foreignResult.challengeCode).toBe(anotherRound.code);
    expect(foreignResult.challengeCode).not.toBe(sample.challengeCode);
  });

  it('allows rounding to the timer limit and supports safe integer values for an untimed game', () => {
    expect(decodeChallengeScore(encodeChallengeScore({ ...sample, timeMs: 300000 })).timeMs).toBe(300000);
    const challenge = createChallenge(puzzle, untimed);
    const score: ChallengeScore = {
      challengeCode: challenge.code,
      sessionId: 's'.repeat(64),
      timeMs: Number.MAX_SAFE_INTEGER,
      mistakes: Number.MAX_SAFE_INTEGER,
      hints: Number.MAX_SAFE_INTEGER,
    };
    expect(decodeChallengeScore(encodeChallengeScore(score))).toEqual(score);
  });

  it('rejects impossible scores, invalid IDs and bad result strings', () => {
    expect(() => encodeChallengeScore({ ...sample, timeMs: 300001 })).toThrow(/exceeds the limits/);
    expect(() => encodeChallengeScore({ ...sample, mistakes: 3 })).toThrow(/exceeds the limits/);
    const withoutMistakes = createChallenge(puzzle, { ...untimed, mistakes: 'off' });
    expect(() => encodeChallengeScore({ ...sample, challengeCode: withoutMistakes.code })).toThrow(/exceeds the limits/);
    expect(() => encodeChallengeScore({ ...sample, timeMs: -1 })).toThrow(/valid time/);
    expect(() => encodeChallengeScore({ ...sample, mistakes: 0.5 })).toThrow(/valid time/);
    expect(() => encodeChallengeScore({ ...sample, hints: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/valid time/);
    expect(() => encodeChallengeScore({ ...sample, sessionId: 's'.repeat(65) })).toThrow(/invalid session ID/);
    expect(() => decodeChallengeScore(`${sampleResult.slice(0, -1)}A`)).toThrow(/Check the result code/);
    expect(() => decodeChallengeScore(sample.challengeCode)).toThrow(/That code is an invitation/);
  });
});
