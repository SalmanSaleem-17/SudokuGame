export type AlternateMode = 'mini-4' | 'mini-6' | 'diagonal' | 'killer' | 'irregular';
export type AlternateSize = 4 | 6 | 9;

export interface Cage {
  cells: readonly number[];
  sum: number;
  combinations: readonly number[];
}

export interface AlternatePuzzle {
  id: string;
  mode: AlternateMode;
  size: AlternateSize;
  givens: readonly number[];
  solution: readonly number[];
  regions: readonly number[];
  units: readonly (readonly number[])[];
  peers: readonly (readonly number[])[];
  cages: readonly Cage[];
  cageOf: readonly number[];
}

export interface AlternatePuzzleDefinition {
  givens: string;
  solution: string;
  regions?: string;
  cages?: string;
}

export const digitBit = (digit: number): number => 1 << (digit - 1);

export function regularRegions(size: AlternateSize): number[] {
  const height = size === 9 ? 3 : 2;
  const width = size / height;
  return Array.from({ length: size * size }, (_, cell) => {
    const row = Math.floor(cell / size);
    const col = cell % size;
    return Math.floor(row / height) * (size / width) + Math.floor(col / width);
  });
}

export function alternateCellUnits(mode: AlternateMode, size: AlternateSize, regions: readonly number[]): number[][] {
  const rows = Array.from({ length: size }, () => [] as number[]);
  const cols = Array.from({ length: size }, () => [] as number[]);
  const groups = Array.from({ length: size }, () => [] as number[]);
  for (let cell = 0; cell < size * size; cell++) {
    rows[Math.floor(cell / size)].push(cell);
    cols[cell % size].push(cell);
    groups[regions[cell]].push(cell);
  }
  const units = [...rows, ...cols, ...groups];
  if (mode === 'diagonal') {
    units.push(
      rows.map((row, index) => row[index]),
      rows.map((row, index) => row[size - 1 - index]),
    );
  }
  return units;
}

export function cageCombinations(size: AlternateSize, count: number, total: number): number[] {
  const combinations: number[] = [];
  function visit(next: number, remaining: number, sum: number, mask: number): void {
    if (remaining === 0) {
      if (sum === 0) combinations.push(mask);
      return;
    }
    for (let digit = next; digit <= size - remaining + 1 && digit <= sum; digit++) {
      visit(digit + 1, remaining - 1, sum - digit, mask | digitBit(digit));
    }
  }
  visit(1, count, total, 0);
  return combinations;
}

export function compileAlternatePuzzle(mode: AlternateMode, id: string, data: AlternatePuzzleDefinition): AlternatePuzzle {
  const size = mode === 'mini-4' ? 4 : mode === 'mini-6' ? 6 : 9;
  const givens = Array.from(data.givens, Number);
  const solution = Array.from(data.solution, Number);
  const regions = data.regions ? Array.from(data.regions, Number) : regularRegions(size);
  const units = alternateCellUnits(mode, size, regions);
  const peerSets = Array.from({ length: size * size }, () => new Set<number>());
  const cageOf = Array<number>(size * size).fill(-1);
  const cages: Cage[] = [];
  for (const unit of units) {
    for (const cell of unit) {
      for (const other of unit) {
        if (cell !== other) peerSets[cell].add(other);
      }
    }
  }
  if (data.cages) {
    const groups = new Map<string, number[]>();
    Array.from(data.cages).forEach((label, cell) => {
      let cells = groups.get(label);
      if (!cells) {
        cells = [];
        groups.set(label, cells);
      }
      cells.push(cell);
    });
    for (const cells of groups.values()) {
      const sum = cells.reduce((total, cell) => total + solution[cell], 0);
      for (const cell of cells) {
        cageOf[cell] = cages.length;
        for (const other of cells) {
          if (cell !== other) peerSets[cell].add(other);
        }
      }
      cages.push({ cells, sum, combinations: cageCombinations(size, cells.length, sum) });
    }
  }
  const peers = peerSets.map((set) => [...set]);
  return { id, mode, size, givens, solution, regions, units, peers, cages, cageOf };
}

export function alternateConflicts(puzzle: AlternatePuzzle, values: readonly number[], showWrong: boolean): Set<number> {
  const errors = new Set<number>();
  for (let cell = 0; cell < values.length; cell++) {
    const digit = values[cell];
    if (digit && (showWrong && digit !== puzzle.solution[cell] || puzzle.peers[cell].some((peer) => values[peer] === digit))) {
      errors.add(cell);
    }
  }
  for (const cage of puzzle.cages) {
    let used = 0;
    for (const cell of cage.cells) {
      if (values[cell]) used |= digitBit(values[cell]);
    }
    if (cage.combinations.every((mask) => (mask & used) !== used)) {
      for (const cell of cage.cells) {
        if (values[cell]) errors.add(cell);
      }
    }
  }
  return errors;
}

/** Count up to a small limit. Used to verify every bundled puzzle before release. */
export function countAlternateSolutions(puzzle: AlternatePuzzle, limit = 2): number {
  if (alternateConflicts(puzzle, puzzle.givens, false).size) return 0;
  const values = [...puzzle.givens];
  const completeMask = (1 << puzzle.size) - 1;
  let solutions = 0;

  function candidates(cell: number): number {
    let excluded = 0;
    for (const peer of puzzle.peers[cell]) {
      if (values[peer]) excluded |= digitBit(values[peer]);
    }
    const cage = puzzle.cages[puzzle.cageOf[cell]];
    if (!cage) return completeMask & ~excluded;
    let used = 0;
    for (const member of cage.cells) {
      if (values[member]) used |= digitBit(values[member]);
    }
    let allowed = 0;
    for (const combination of cage.combinations) {
      if ((combination & used) === used) allowed |= combination;
    }
    return allowed & ~excluded;
  }

  function visit(): void {
    let target = -1;
    let choices = 0;
    let minCount = puzzle.size + 1;
    for (let cell = 0; cell < values.length; cell++) {
      if (values[cell]) continue;
      const available = candidates(cell);
      if (!available) return;
      let count = 0;
      for (let remaining = available; remaining; remaining &= remaining - 1) count++;
      if (count < minCount) {
        minCount = count;
        target = cell;
        choices = available;
        if (count === 1) break;
      }
    }
    if (target === -1) {
      solutions++;
      return;
    }
    while (choices && solutions < limit) {
      const bit = choices & -choices;
      choices ^= bit;
      values[target] = 32 - Math.clz32(bit);
      visit();
    }
    values[target] = 0;
  }

  visit();
  return solutions;
}
