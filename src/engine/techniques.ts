/**
 * Human-style solving techniques. Each finder inspects a candidate state and returns a
 * step describing the cells involved, what changes, and a plain-language explanation.
 */
import {
  ALL_DIGITS,
  PEERS,
  UNITS,
  bit,
  boxOf,
  boxUnit,
  cellName,
  colOf,
  colUnit,
  computeCandidates,
  countBits,
  digitsOf,
  joinWords,
  listCells,
  rowOf,
  rowUnit,
  singleDigit,
  unitName,
} from './grid';

export type Technique =
  | 'hiddenSingle'
  | 'nakedSingle'
  | 'lockedCandidates'
  | 'nakedPair'
  | 'hiddenPair'
  | 'nakedTriple'
  | 'xWing'
  | 'hiddenTriple'
  | 'swordfish'
  | 'xyWing';

export const TECHNIQUE_NAMES: Record<Technique, string> = {
  hiddenSingle: 'Hidden single',
  nakedSingle: 'Naked single',
  lockedCandidates: 'Locked candidates',
  nakedPair: 'Naked pair',
  hiddenPair: 'Hidden pair',
  nakedTriple: 'Naked triple',
  xWing: 'X-Wing',
  hiddenTriple: 'Hidden triple',
  swordfish: 'Swordfish',
  xyWing: 'XY-Wing',
};

/** Order the logical solver tries techniques in. Fixed, so solution paths are reproducible. */
export const TECHNIQUE_ORDER: Technique[] = [
  'hiddenSingle',
  'nakedSingle',
  'lockedCandidates',
  'nakedPair',
  'hiddenPair',
  'nakedTriple',
  'xWing',
  'hiddenTriple',
  'swordfish',
  'xyWing',
];

export interface CellDigit {
  cell: number;
  digit: number;
}

export interface Step {
  technique: Technique;
  /** Digit to place, for single techniques. */
  placement?: CellDigit;
  /** Candidates removed, for elimination techniques. */
  eliminations: CellDigit[];
  /** Cells that form the pattern (strong highlight). */
  cells: number[];
  /** Units the reasoning looks at (soft highlight). */
  units: number[];
  /** Candidate facts the step relies on, used to work out which earlier steps it needs. */
  premise: { cells: number[]; digits: number[] }[];
  explanation: string;
}

export interface SolveState {
  values: number[];
  cands: number[];
}

export function createState(values: readonly number[]): SolveState {
  return { values: values.slice(), cands: computeCandidates(values) };
}

export function placeDigit(state: SolveState, cell: number, digit: number): void {
  state.values[cell] = digit;
  state.cands[cell] = 0;
  const mask = ~bit(digit);
  for (const p of PEERS[cell]) state.cands[p] &= mask;
}

export function applyStep(state: SolveState, step: Step): void {
  if (step.placement) placeDigit(state, step.placement.cell, step.placement.digit);
  for (const e of step.eliminations) state.cands[e.cell] &= ~bit(e.digit);
}

const ALL_DIGIT_LIST = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/* ----------------------------- singles ----------------------------- */

export function findHiddenSingles(state: SolveState, firstOnly = false): Step[] {
  const steps: Step[] = [];
  const seen = new Set<number>();
  // Boxes first: they are the easiest place for a person to spot a hidden single.
  const order = [...Array(9).keys()].map(boxUnit).concat([...Array(18).keys()]);
  for (const u of order) {
    const unit = UNITS[u];
    const empties = unit.filter((c) => state.values[c] === 0);
    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      let spot = -1;
      let n = 0;
      for (const c of empties) {
        if (state.cands[c] & b) {
          spot = c;
          if (++n > 1) break;
        }
      }
      if (n !== 1 || seen.has(spot * 10 + d)) continue;
      seen.add(spot * 10 + d);
      const direct = empties.every((c) => c === spot || PEERS[c].some((peer) => state.values[peer] === d));
      const explanation =
        empties.length === 1
          ? `${cellName(spot)} is the last empty cell in ${unitName(u)}, and ${d} is the only digit that ${unitName(u)} is still missing.`
          : `In ${unitName(u)}, the digit ${d} has only one possible cell: ${cellName(spot)}. ${direct
            ? `Every other empty cell in ${unitName(u)} already shares a row, column or box with a ${d}.`
            : `The digits on the board and the earlier eliminations rule out ${d} in every other empty cell in ${unitName(u)}.`}`;
      steps.push({
        technique: 'hiddenSingle',
        placement: { cell: spot, digit: d },
        eliminations: [],
        cells: [spot],
        units: [u],
        premise: [{ cells: unit, digits: [d] }],
        explanation,
      });
      if (firstOnly) return steps;
    }
  }
  return steps;
}

export function findNakedSingles(state: SolveState, firstOnly = false): Step[] {
  const steps: Step[] = [];
  for (let cell = 0; cell < 81; cell++) {
    if (state.values[cell] !== 0 || countBits(state.cands[cell]) !== 1) continue;
    const d = singleDigit(state.cands[cell]);
    let seen = 0;
    for (const p of PEERS[cell]) if (state.values[p]) seen |= bit(state.values[p]);
    const direct = (ALL_DIGITS & ~seen) === bit(d);
    const others = ALL_DIGIT_LIST.filter((x) => x !== d);
    const explanation = direct
      ? `${cellName(cell)} can only be ${d}. Its row, column and box already contain ${joinWords(others)}, so ${d} is the only digit left for this cell.`
      : `${cellName(cell)} can only be ${d}. Every other digit is either already in its row, column or box, or was ruled out by the earlier steps.`;
    steps.push({
      technique: 'nakedSingle',
      placement: { cell, digit: d },
      eliminations: [],
      cells: [cell],
      units: [rowUnit(rowOf(cell)), colUnit(colOf(cell)), boxUnit(boxOf(cell))],
      premise: [{ cells: [cell], digits: others }],
      explanation,
    });
    if (firstOnly) return steps;
  }
  return steps;
}

/* ------------------------- locked candidates ------------------------ */

export function findLockedCandidates(state: SolveState, firstOnly = false): Step[] {
  const steps: Step[] = [];
  const { cands } = state;

  // Pointing: within a box, a digit is confined to one row or column.
  for (let b = 0; b < 9; b++) {
    const box = UNITS[boxUnit(b)];
    for (let d = 1; d <= 9; d++) {
      const m = bit(d);
      const spots = box.filter((c) => cands[c] & m);
      if (spots.length < 2) continue;
      const sameRow = spots.every((c) => rowOf(c) === rowOf(spots[0]));
      const sameCol = spots.every((c) => colOf(c) === colOf(spots[0]));
      if (!sameRow && !sameCol) continue;
      const lineUnit = sameRow ? rowUnit(rowOf(spots[0])) : colUnit(colOf(spots[0]));
      const targets = UNITS[lineUnit].filter((c) => boxOf(c) !== b && cands[c] & m);
      if (targets.length === 0) continue;
      steps.push({
        technique: 'lockedCandidates',
        eliminations: targets.map((cell) => ({ cell, digit: d })),
        cells: spots,
        units: [boxUnit(b), lineUnit],
        premise: [{ cells: box, digits: [d] }],
        explanation: `In ${unitName(boxUnit(b))}, the digit ${d} can only go in ${listCells(spots)}, which all lie in ${unitName(lineUnit)}. Wherever it ends up, that ${d} will occupy ${unitName(lineUnit)}, so ${d} can be removed from ${listCells(targets)}.`,
      });
      if (firstOnly) return steps;
    }
  }

  // Claiming: within a row or column, a digit is confined to one box.
  for (let u = 0; u < 18; u++) {
    const line = UNITS[u];
    for (let d = 1; d <= 9; d++) {
      const m = bit(d);
      const spots = line.filter((c) => cands[c] & m);
      if (spots.length < 2) continue;
      const b = boxOf(spots[0]);
      if (!spots.every((c) => boxOf(c) === b)) continue;
      const targets = UNITS[boxUnit(b)].filter((c) => !line.includes(c) && cands[c] & m);
      if (targets.length === 0) continue;
      steps.push({
        technique: 'lockedCandidates',
        eliminations: targets.map((cell) => ({ cell, digit: d })),
        cells: spots,
        units: [u, boxUnit(b)],
        premise: [{ cells: line, digits: [d] }],
        explanation: `In ${unitName(u)}, the digit ${d} can only go in ${listCells(spots)}, which all lie in ${unitName(boxUnit(b))}. That ${d} must therefore sit in this part of the box, so ${d} can be removed from ${listCells(targets)}.`,
      });
      if (firstOnly) return steps;
    }
  }
  return steps;
}

/* ------------------------------ subsets ----------------------------- */

function findNakedSubset(state: SolveState, size: 2 | 3): Step | null {
  const { cands, values } = state;
  for (let u = 0; u < 27; u++) {
    const pool = UNITS[u].filter((c) => values[c] === 0 && countBits(cands[c]) <= size);
    if (pool.length < size) continue;
    const combos: number[][] = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (size === 2) combos.push([pool[i], pool[j]]);
        else for (let k = j + 1; k < pool.length; k++) combos.push([pool[i], pool[j], pool[k]]);
      }
    }
    for (const combo of combos) {
      let union = 0;
      for (const c of combo) union |= cands[c];
      if (countBits(union) !== size) continue;
      const eliminations: CellDigit[] = [];
      for (const c of UNITS[u]) {
        if (combo.includes(c) || values[c] !== 0) continue;
        for (const d of digitsOf(cands[c] & union)) eliminations.push({ cell: c, digit: d });
      }
      if (eliminations.length === 0) continue;
      const digits = digitsOf(union);
      const targetCells = [...new Set(eliminations.map((e) => e.cell))];
      return {
        technique: size === 2 ? 'nakedPair' : 'nakedTriple',
        eliminations,
        cells: combo,
        units: [u],
        premise: [{ cells: combo, digits: ALL_DIGIT_LIST }],
        explanation: `In ${unitName(u)}, the cells ${listCells(combo)} can only hold ${joinWords(digits)} between them. Those ${size} digits must fill those ${size} cells, so ${joinWords(digits)} can be removed from ${listCells(targetCells)}.`,
      };
    }
  }
  return null;
}

function findHiddenPair(state: SolveState): Step | null {
  const { cands, values } = state;
  for (let u = 0; u < 27; u++) {
    const empties = UNITS[u].filter((c) => values[c] === 0);
    if (empties.length < 3) continue;
    for (let a = 1; a <= 8; a++) {
      for (let b = a + 1; b <= 9; b++) {
        const pair = bit(a) | bit(b);
        const spots = empties.filter((c) => cands[c] & pair);
        if (spots.length !== 2) continue;
        if (!spots.every((c) => (cands[c] & pair) === pair)) continue;
        const eliminations: CellDigit[] = [];
        for (const c of spots) {
          for (const d of digitsOf(cands[c] & ~pair)) eliminations.push({ cell: c, digit: d });
        }
        if (eliminations.length === 0) continue;
        return {
          technique: 'hiddenPair',
          eliminations,
          cells: spots,
          units: [u],
          premise: [{ cells: UNITS[u], digits: [a, b] }],
          explanation: `In ${unitName(u)}, the digits ${a} and ${b} can only go in ${listCells(spots)}. Those two cells must hold ${a} and ${b}, so every other candidate can be removed from them.`,
        };
      }
    }
  }
  return null;
}

/* ------------------------------- X-Wing ----------------------------- */

function findXWing(state: SolveState): Step | null {
  const { cands } = state;
  for (const byRow of [true, false]) {
    for (let d = 1; d <= 9; d++) {
      const m = bit(d);
      // For each base line, the cross positions where d is still possible.
      const lines: { line: number; spots: number[] }[] = [];
      for (let line = 0; line < 9; line++) {
        const spots: number[] = [];
        for (let k = 0; k < 9; k++) {
          const cell = byRow ? line * 9 + k : k * 9 + line;
          if (cands[cell] & m) spots.push(k);
        }
        if (spots.length === 2) lines.push({ line, spots });
      }
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const A = lines[i];
          const B = lines[j];
          if (A.spots[0] !== B.spots[0] || A.spots[1] !== B.spots[1]) continue;
          const corner = (line: number, k: number) => (byRow ? line * 9 + k : k * 9 + line);
          const cells = [
            corner(A.line, A.spots[0]),
            corner(A.line, A.spots[1]),
            corner(B.line, B.spots[0]),
            corner(B.line, B.spots[1]),
          ];
          const eliminations: CellDigit[] = [];
          for (const k of A.spots) {
            for (let line = 0; line < 9; line++) {
              if (line === A.line || line === B.line) continue;
              const cell = corner(line, k);
              if (cands[cell] & m) eliminations.push({ cell, digit: d });
            }
          }
          if (eliminations.length === 0) continue;
          const baseUnits = byRow ? [rowUnit(A.line), rowUnit(B.line)] : [colUnit(A.line), colUnit(B.line)];
          const coverUnits = byRow
            ? [colUnit(A.spots[0]), colUnit(A.spots[1])]
            : [rowUnit(A.spots[0]), rowUnit(A.spots[1])];
          return {
            technique: 'xWing',
            eliminations,
            cells,
            units: [...baseUnits, ...coverUnits],
            premise: [{ cells: [...UNITS[baseUnits[0]], ...UNITS[baseUnits[1]]], digits: [d] }],
            explanation: `In ${unitName(baseUnits[0])} and ${unitName(baseUnits[1])}, the digit ${d} can only go in the same two positions, forming a rectangle at ${listCells(cells)}. The two ${d}s must sit on opposite corners, so they fill ${unitName(coverUnits[0])} and ${unitName(coverUnits[1])}; ${d} can be removed from ${listCells(eliminations.map((e) => e.cell))}.`,
          };
        }
      }
    }
  }
  return null;
}

/* ---------------------------- hidden triple ------------------------- */

function findHiddenTriple(state: SolveState): Step | null {
  const { cands, values } = state;
  for (let u = 0; u < 27; u++) {
    const empties = UNITS[u].filter((c) => values[c] === 0);
    if (empties.length < 5) continue;
    for (let a = 1; a <= 7; a++) {
      for (let b = a + 1; b <= 8; b++) {
        for (let c = b + 1; c <= 9; c++) {
          const triple = bit(a) | bit(b) | bit(c);
          // Each digit must still be open in this unit, or it is a smaller pattern.
          if (![a, b, c].every((d) => empties.some((cell) => cands[cell] & bit(d)))) continue;
          const spots = empties.filter((cell) => cands[cell] & triple);
          if (spots.length !== 3) continue;
          const eliminations: CellDigit[] = [];
          for (const cell of spots) {
            for (const d of digitsOf(cands[cell] & ~triple)) eliminations.push({ cell, digit: d });
          }
          if (eliminations.length === 0) continue;
          return {
            technique: 'hiddenTriple',
            eliminations,
            cells: spots,
            units: [u],
            premise: [{ cells: UNITS[u], digits: [a, b, c] }],
            explanation: `In ${unitName(u)}, the digits ${a}, ${b} and ${c} can only go in ${listCells(spots)}. Those three cells must hold those three digits, so every other candidate can be removed from them.`,
          };
        }
      }
    }
  }
  return null;
}

/* ------------------------------ Swordfish --------------------------- */

function findSwordfish(state: SolveState): Step | null {
  const { cands } = state;
  for (const byRow of [true, false]) {
    for (let d = 1; d <= 9; d++) {
      const m = bit(d);
      const lines: { line: number; spots: number[] }[] = [];
      for (let line = 0; line < 9; line++) {
        const spots: number[] = [];
        for (let k = 0; k < 9; k++) {
          if (cands[byRow ? line * 9 + k : k * 9 + line] & m) spots.push(k);
        }
        if (spots.length === 2 || spots.length === 3) lines.push({ line, spots });
      }
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          for (let k = j + 1; k < lines.length; k++) {
            const base = [lines[i], lines[j], lines[k]];
            const cover = [...new Set(base.flatMap((l) => l.spots))].sort((x, y) => x - y);
            if (cover.length !== 3) continue;
            const baseLines = base.map((l) => l.line);
            const at = (line: number, pos: number) => (byRow ? line * 9 + pos : pos * 9 + line);
            const eliminations: CellDigit[] = [];
            for (const pos of cover) {
              for (let line = 0; line < 9; line++) {
                if (baseLines.includes(line)) continue;
                const cell = at(line, pos);
                if (cands[cell] & m) eliminations.push({ cell, digit: d });
              }
            }
            if (eliminations.length === 0) continue;
            const cells = base.flatMap((l) => l.spots.map((pos) => at(l.line, pos)));
            const baseUnits = baseLines.map((line) => (byRow ? rowUnit(line) : colUnit(line)));
            const coverUnits = cover.map((pos) => (byRow ? colUnit(pos) : rowUnit(pos)));
            return {
              technique: 'swordfish',
              eliminations,
              cells,
              units: [...baseUnits, ...coverUnits],
              premise: [{ cells: baseUnits.flatMap((unit) => UNITS[unit]), digits: [d] }],
              explanation: `In ${joinWords(baseUnits.map(unitName))}, the digit ${d} can only go in ${joinWords(coverUnits.map(unitName))}. Those three lines need three ${d}s, one in each, so they use up ${joinWords(coverUnits.map(unitName))}; ${d} can be removed from ${listCells(eliminations.map((e) => e.cell))}.`,
            };
          }
        }
      }
    }
  }
  return null;
}

/* ------------------------------- XY-Wing ---------------------------- */

function findXYWing(state: SolveState): Step | null {
  const { cands, values } = state;
  const pairs: number[] = [];
  for (let cell = 0; cell < 81; cell++) if (values[cell] === 0 && countBits(cands[cell]) === 2) pairs.push(cell);
  for (const pivot of pairs) {
    const wings = pairs.filter((cell) => cell !== pivot && PEERS[pivot].includes(cell) && countBits(cands[cell] & cands[pivot]) === 1);
    for (let i = 0; i < wings.length; i++) {
      for (let j = i + 1; j < wings.length; j++) {
        const a = wings[i];
        const b = wings[j];
        // The wings share one digit that the pivot does not have, and together cover the pivot.
        const shared = cands[a] & cands[b] & ~cands[pivot];
        if (countBits(shared) !== 1 || ((cands[a] | cands[b]) & cands[pivot]) !== cands[pivot]) continue;
        const z = singleDigit(shared);
        const eliminations: CellDigit[] = [];
        for (const cell of PEERS[a]) {
          if (cell !== pivot && cell !== b && PEERS[b].includes(cell) && cands[cell] & shared) eliminations.push({ cell, digit: z });
        }
        if (eliminations.length === 0) continue;
        const [x, y] = digitsOf(cands[pivot]);
        return {
          technique: 'xyWing',
          eliminations,
          cells: [pivot, a, b],
          units: [],
          premise: [{ cells: [pivot, a, b], digits: [1, 2, 3, 4, 5, 6, 7, 8, 9] }],
          explanation: `${cellName(pivot)} can only be ${x} or ${y}. Whichever it is, one of ${cellName(a)} and ${cellName(b)} is forced to be ${z}, because each of them shares one digit with ${cellName(pivot)} and has ${z} as its other option. Any cell that sees both of them cannot be ${z}, so ${z} can be removed from ${listCells(eliminations.map((e) => e.cell))}.`,
        };
      }
    }
  }
  return null;
}

export function findStep(state: SolveState, technique: Technique): Step | null {
  switch (technique) {
    case 'hiddenSingle':
      return findHiddenSingles(state, true)[0] ?? null;
    case 'nakedSingle':
      return findNakedSingles(state, true)[0] ?? null;
    case 'lockedCandidates':
      return findLockedCandidates(state, true)[0] ?? null;
    case 'nakedPair':
      return findNakedSubset(state, 2);
    case 'hiddenPair':
      return findHiddenPair(state);
    case 'nakedTriple':
      return findNakedSubset(state, 3);
    case 'xWing':
      return findXWing(state);
    case 'hiddenTriple':
      return findHiddenTriple(state);
    case 'swordfish':
      return findSwordfish(state);
    case 'xyWing':
      return findXYWing(state);
  }
}

/** The easiest available step, following the fixed technique order. */
export function findNextStep(state: SolveState): Step | null {
  for (const technique of TECHNIQUE_ORDER) {
    const step = findStep(state, technique);
    if (step) return step;
  }
  return null;
}

export const isSolved = (values: readonly number[]) => values.every((v) => v !== 0);
