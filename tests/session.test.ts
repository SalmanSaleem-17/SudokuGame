import { describe, expect, it } from 'vitest';

import puzzles from '../src/data/puzzles.json';
import { PEERS, bit } from '../src/engine/grid';
import type { PuzzleRecord } from '../src/engine/pool';
import { dailyPuzzleFor, dateKeyOf, monthGrid, resolveDaily } from '../src/game/daily';
import {
  clearIncorrect,
  createSession,
  enterDigit,
  eraseCell,
  isValidSession,
  toggleNote,
  undoMove,
} from '../src/game/session';
import { GameClock, formatTime } from '../src/state/clock';

const POOL = puzzles as PuzzleRecord[];
const puzzle = POOL[0];
const fresh = () => createSession(puzzle, 'classic', 's1', 1000);
const SMART = { smartNotes: true };
const PLAIN = { smartNotes: false };

const emptyCells = (s = fresh()) => s.values.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);

describe('entries', () => {
  it('keeps pre-filled digits read-only', () => {
    const s = fresh();
    const given = s.givens.findIndex((v) => v !== 0);
    expect(enterDigit(s, given, 5, SMART)).toBe(s);
    expect(eraseCell(s, given)).toBe(s);
    expect(toggleNote(s, given, 5)).toBe(s);
  });

  it('counts a wrong entry as a mistake and keeps the count after undo', () => {
    const s = fresh();
    const cell = emptyCells(s)[0];
    const wrong = (s.solution[cell] % 9) + 1;
    const after = enterDigit(s, cell, wrong, SMART);
    expect(after.mistakes).toBe(1);
    expect(undoMove(after).mistakes).toBe(1);
    expect(enterDigit(s, cell, s.solution[cell], SMART).mistakes).toBe(0);
  });

  it('completes when the last correct digit is entered', () => {
    let s = fresh();
    for (const cell of emptyCells(s)) {
      expect(s.completed).toBe(false);
      s = enterDigit(s, cell, s.solution[cell], SMART);
    }
    expect(s.completed).toBe(true);
    // A finished board is frozen.
    expect(undoMove(s)).toBe(s);
  });

  it('clears incorrect entries as one undoable action', () => {
    let s = fresh();
    const [a, b, c] = emptyCells(s);
    s = enterDigit(s, a, (s.solution[a] % 9) + 1, PLAIN);
    s = enterDigit(s, b, (s.solution[b] % 9) + 1, PLAIN);
    s = enterDigit(s, c, s.solution[c], PLAIN);
    const cleared = clearIncorrect(s);
    expect([cleared.values[a], cleared.values[b], cleared.values[c]]).toEqual([0, 0, s.solution[c]]);
    expect(undoMove(cleared).values).toEqual(s.values);
  });
});

describe('notes and undo', () => {
  it('toggles notes and undoes them', () => {
    const s = fresh();
    const cell = emptyCells(s)[0];
    const noted = toggleNote(toggleNote(s, cell, 3), cell, 7);
    expect(noted.notes[cell]).toBe(bit(3) | bit(7));
    expect(toggleNote(noted, cell, 3).notes[cell]).toBe(bit(7));
    expect(undoMove(noted).notes[cell]).toBe(bit(3));
  });

  it('smart notes clear the digit from peers, and one undo restores the cell and every note', () => {
    let s = fresh();
    const cell = emptyCells(s)[0];
    const digit = s.solution[cell];
    const emptyPeers = PEERS[cell].filter((p) => s.values[p] === 0).slice(0, 3);
    expect(emptyPeers.length).toBeGreaterThan(0);
    for (const p of emptyPeers) s = toggleNote(toggleNote(s, p, digit), p, digit === 9 ? 1 : 9);
    s = toggleNote(s, cell, 4);
    const before = s;

    const after = enterDigit(s, cell, digit, SMART);
    expect(after.values[cell]).toBe(digit);
    expect(after.notes[cell]).toBe(0);
    for (const p of emptyPeers) expect(after.notes[p] & bit(digit)).toBe(0);
    // Unrelated notes survive.
    for (const p of emptyPeers) expect(after.notes[p]).not.toBe(0);
    expect(after.undo.length).toBe(before.undo.length + 1);

    const undone = undoMove(after);
    expect(undone.values).toEqual(before.values);
    expect(undone.notes).toEqual(before.notes);
    expect(undone.undo.length).toBe(before.undo.length);
  });

  it('leaves peer notes alone when smart notes are off', () => {
    let s = fresh();
    const cell = emptyCells(s)[0];
    const digit = s.solution[cell];
    const peer = PEERS[cell].find((p) => s.values[p] === 0)!;
    s = toggleNote(s, peer, digit);
    expect(enterDigit(s, cell, digit, PLAIN).notes[peer]).toBe(bit(digit));
  });

  it('survives a JSON round trip unchanged, including undo history', () => {
    let s = fresh();
    const [a, b] = emptyCells(s);
    s = toggleNote(s, a, 2);
    s = enterDigit(s, b, s.solution[b], SMART);
    const restored: unknown = JSON.parse(JSON.stringify(s));
    expect(isValidSession(restored)).toBe(true);
    expect(restored).toEqual(s);
    expect(undoMove(restored as typeof s).values[b]).toBe(0);
  });

  it('rejects corrupt saved sessions', () => {
    expect(isValidSession(null)).toBe(false);
    expect(isValidSession({ ...fresh(), values: [1, 2, 3] })).toBe(false);
    expect(isValidSession({ ...fresh(), version: 99 })).toBe(false);
  });
});

describe('daily puzzle', () => {
  const pool = POOL.filter((p) => p.difficulty !== 'expert');

  it('uses the local calendar date', () => {
    expect(dateKeyOf(new Date(2026, 10, 21, 23, 59, 59))).toBe('2026-11-21');
    expect(dateKeyOf(new Date(2026, 10, 22, 0, 0, 0))).toBe('2026-11-22');
  });

  it('is deterministic per date and changes at rollover', () => {
    expect(dailyPuzzleFor('2026-11-21', pool).id).toBe(dailyPuzzleFor('2026-11-21', pool).id);
    expect(dailyPuzzleFor('2026-11-22', pool).id).not.toBe(dailyPuzzleFor('2026-11-21', pool).id);
  });

  it('does not repeat a puzzle until the pool is exhausted', () => {
    const ids = new Set<string>();
    const start = new Date(2026, 0, 1);
    for (let i = 0; i < pool.length; i++) {
      ids.add(dailyPuzzleFor(dateKeyOf(new Date(2026, 0, 1 + i)), pool).id);
    }
    expect(start.getFullYear()).toBe(2026);
    expect(ids.size).toBe(pool.length);
  });

  it('keeps a puzzle started before midnight attached to its original date', () => {
    const started = { dateKey: '2026-11-21', completed: false };
    expect(resolveDaily('2026-11-21', started, new Set())).toEqual({ kind: 'resume', dateKey: '2026-11-21' });
    // After midnight the new day is offered, and the old session is still there under its own date.
    expect(resolveDaily('2026-11-22', started, new Set())).toEqual({
      kind: 'fresh',
      dateKey: '2026-11-22',
      carried: '2026-11-21',
    });
  });

  it('reports completed days and offers nothing to carry once finished', () => {
    expect(resolveDaily('2026-11-22', null, new Set(['2026-11-22']))).toEqual({ kind: 'completed', dateKey: '2026-11-22' });
    expect(resolveDaily('2026-11-22', null, new Set(['2026-11-21']))).toEqual({
      kind: 'fresh',
      dateKey: '2026-11-22',
      carried: null,
    });
  });

  it('lays out a month Monday first', () => {
    const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday.
    expect(weeks[0].map((d) => d?.day ?? null)).toEqual([null, null, null, null, null, null, 1]);
    expect(weeks.flat().filter(Boolean).length).toBe(30);
  });
});

describe('clock', () => {
  it('counts only active time', () => {
    let now = 0;
    const clock = new GameClock(() => now);
    clock.load('classic', 5000);
    now = 1000;
    expect(clock.read()).toBe(5000);
    clock.start();
    now = 4000;
    expect(clock.read()).toBe(8000);
    clock.stop(); // backgrounded, paused or ad showing
    now = 60000;
    expect(clock.read()).toBe(8000);
    clock.start();
    now = 61000;
    clock.stop();
    expect(clock.read()).toBe(9000);
  });

  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65000)).toBe('1:05');
    expect(formatTime(3725000)).toBe('1:02:05');
  });
});
