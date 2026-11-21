/**
 * Core grid geometry and bitmask helpers. Pure TypeScript, no React Native imports.
 *
 * A grid is 81 numbers in row-major order, 0 = empty, 1-9 = digit.
 * Candidate sets and notes are 9-bit masks: bit (d - 1) set means digit d is present.
 */

export type Grid = number[];

export const ALL_DIGITS = 0x1ff;
export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const rowOf = (cell: number) => Math.floor(cell / 9);
export const colOf = (cell: number) => cell % 9;
export const boxOf = (cell: number) => Math.floor(cell / 27) * 3 + Math.floor((cell % 9) / 3);

/** Units 0-8 are rows, 9-17 columns, 18-26 boxes. */
export const UNITS: number[][] = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = Math.floor(b / 3) * 3;
  const c0 = (b % 3) * 3;
  UNITS.push(Array.from({ length: 9 }, (_, k) => (r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3)));
}

export const rowUnit = (r: number) => r;
export const colUnit = (c: number) => 9 + c;
export const boxUnit = (b: number) => 18 + b;

/** The 20 cells sharing a row, column or box with each cell. */
export const PEERS: number[][] = Array.from({ length: 81 }, (_, cell) => {
  const set = new Set<number>();
  for (const u of [rowUnit(rowOf(cell)), colUnit(colOf(cell)), boxUnit(boxOf(cell))]) {
    for (const other of UNITS[u]) if (other !== cell) set.add(other);
  }
  return [...set].sort((a, b) => a - b);
});

export const bit = (digit: number) => 1 << (digit - 1);
export const hasDigit = (mask: number, digit: number) => (mask & bit(digit)) !== 0;

const POPCOUNT = new Uint8Array(512);
for (let i = 1; i < 512; i++) POPCOUNT[i] = POPCOUNT[i >> 1] + (i & 1);
export const countBits = (mask: number) => POPCOUNT[mask & ALL_DIGITS];

export function digitsOf(mask: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d);
  return out;
}

/** For a mask with exactly one bit set, the digit it represents. */
export function singleDigit(mask: number): number {
  return 32 - Math.clz32(mask);
}

export function parseGrid(text: string): Grid {
  if (text.length !== 81) throw new Error(`Grid must have 81 characters, got ${text.length}`);
  const grid: Grid = new Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = text.charCodeAt(i);
    if (ch >= 49 && ch <= 57) grid[i] = ch - 48;
    else if (ch === 48 || ch === 46) grid[i] = 0;
    else throw new Error(`Invalid grid character "${text[i]}" at ${i}`);
  }
  return grid;
}

export const serializeGrid = (grid: readonly number[]) => grid.join('');

export const cellName = (cell: number) => `R${rowOf(cell) + 1}C${colOf(cell) + 1}`;

export function unitName(unit: number): string {
  if (unit < 9) return `row ${unit + 1}`;
  if (unit < 18) return `column ${unit - 8}`;
  return `box ${unit - 17}`;
}

export function listCells(cells: readonly number[]): string {
  return joinWords(cells.map(cellName));
}

export function joinWords(words: readonly (string | number)[]): string {
  if (words.length <= 1) return words.join('');
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Candidates for every empty cell derived only from placed digits. Filled cells get 0. */
export function computeCandidates(values: readonly number[]): number[] {
  const cands = new Array<number>(81);
  for (let cell = 0; cell < 81; cell++) {
    if (values[cell] !== 0) {
      cands[cell] = 0;
      continue;
    }
    let seen = 0;
    for (const p of PEERS[cell]) if (values[p] !== 0) seen |= bit(values[p]);
    cands[cell] = ALL_DIGITS & ~seen;
  }
  return cands;
}

/** Cells whose digit duplicates another cell in the same row, column or box. */
export function findConflicts(values: readonly number[]): Set<number> {
  const conflicts = new Set<number>();
  for (const unit of UNITS) {
    const firstAt = new Array<number>(10).fill(-1);
    for (const cell of unit) {
      const v = values[cell];
      if (v === 0) continue;
      if (firstAt[v] >= 0) {
        conflicts.add(cell);
        conflicts.add(firstAt[v]);
      } else {
        firstAt[v] = cell;
      }
    }
  }
  return conflicts;
}

export const hasValidGivens = (values: readonly number[]) =>
  values.length === 81 &&
  values.every((v) => Number.isInteger(v) && v >= 0 && v <= 9) &&
  findConflicts(values).size === 0;
