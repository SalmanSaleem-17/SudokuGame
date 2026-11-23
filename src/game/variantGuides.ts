/**
 * How-to-play guides for the three Sudoku variants. Each card can select a cell on a real
 * puzzle of that variant, so the board highlights exactly the cells the rule is about.
 */
import { ALTERNATE_MODES, getAlternatePuzzle } from './alternate';
import type { AlternatePuzzle } from './alternateRules';

export const VARIANT_MODES = ['diagonal', 'killer', 'irregular'] as const;
export type VariantMode = (typeof VARIANT_MODES)[number];

export function isVariantMode(value: unknown): value is VariantMode {
  return VARIANT_MODES.some((mode) => mode === value);
}

export interface GuideCard {
  title: string;
  body: string;
  caption: string;
  /** Cell to select on the example board, or null to show the board plainly. */
  selected: number | null;
}

export interface VariantGuide {
  mode: VariantMode;
  name: string;
  puzzle: AlternatePuzzle;
  cards: GuideCard[];
}

const digitsIn = (mask: number): number[] => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((digit) => mask & (1 << (digit - 1)));

function joinDigits(digits: readonly number[]): string {
  return digits.length <= 1 ? digits.join('') : `${digits.slice(0, -1).join(', ')} and ${digits[digits.length - 1]}`;
}

/** The first empty cell matching the test, or any matching cell when none is empty. */
function pick(puzzle: AlternatePuzzle, test: (cell: number) => boolean): number {
  const cells = puzzle.givens.map((_, cell) => cell).filter(test);
  return cells.find((cell) => puzzle.givens[cell] === 0) ?? cells[0] ?? 0;
}

function diagonalCards(puzzle: AlternatePuzzle): GuideCard[] {
  const { size } = puzzle;
  const centre = Math.floor((size * size) / 2);
  const onMain = (cell: number) => Math.floor(cell / size) === cell % size && cell !== centre;
  return [
    {
      title: 'Classic rules, plus two diagonals',
      body: 'Fill every row, column and 3 × 3 box with 1–9, exactly as in classic Sudoku. The two long diagonals, marked with dots, must also hold 1–9 once each.',
      caption: 'Dotted cells are on a diagonal.',
      selected: null,
    },
    {
      title: 'A diagonal is one more line',
      body: 'The selected cell sits on a diagonal. The highlighted cells are everything it must differ from: its row, its column, its box and the whole diagonal.',
      caption: 'In a game, tap any cell to see what it must differ from.',
      selected: pick(puzzle, onMain),
    },
    {
      title: 'The centre belongs to both',
      body: 'The centre cell is on both diagonals, so it is checked against more cells than any other. Cells near the centre are often the easiest place to start.',
      caption: 'Both diagonals cross here.',
      selected: centre,
    },
    {
      title: 'Solving tips',
      body: 'When a digit is already on a diagonal, cross it off for every other cell on that diagonal. Check the diagonals whenever a row, column and box are not enough to settle a cell.',
      caption: 'Notes help: jot down what still fits.',
      selected: null,
    },
  ];
}

function killerCards(puzzle: AlternatePuzzle): GuideCard[] {
  const bySize = [...puzzle.cages].filter((cage) => cage.cells.length >= 2).sort((a, b) => a.cells.length - b.cells.length);
  const small = bySize[0];
  // A cage whose total can be made only one way is the natural starting point.
  const tight = bySize.find((cage) => cage.combinations.length === 1);
  return [
    {
      title: 'Cages and totals',
      body: 'Dashed outlines are cages. The small number in a cage is the total its digits must add up to. Rows, columns and boxes still use 1–9 once each.',
      caption: 'Each total sits in the first cell of its cage.',
      selected: null,
    },
    {
      title: 'No repeats inside a cage',
      body: 'Digits in a cage must all be different, even when the cage crosses two boxes. The highlighted cells show the selected cell’s cage along with its row, column and box.',
      caption: 'A cage is one more group that cannot repeat a digit.',
      selected: small ? small.cells[0] : null,
    },
    tight
      ? {
        title: 'Start with cages that have one answer',
        body: `This cage has ${tight.cells.length} cells and totals ${tight.sum}. Only ${joinDigits(digitsIn(tight.combinations[0]))} add up to that, so those digits go here in some order.`,
        caption: 'Very small and very large totals have the fewest options.',
        selected: tight.cells[0],
      }
      : {
        title: 'Start with cages that have one answer',
        body: 'Some totals can be made only one way. Two cells totalling 3 must be 1 and 2; two cells totalling 17 must be 8 and 9. Fill those cages in your notes first.',
        caption: 'Very small and very large totals have the fewest options.',
        selected: null,
      },
    {
      title: 'Solving tips',
      body: 'Every row, column and box adds up to 45. If the cages inside a box cover all but one cell, subtract their totals from 45 to find that cell. Use notes to track which digits a cage can still take.',
      caption: 'Killer puzzles may start with few or no digits.',
      selected: null,
    },
  ];
}

function irregularCards(puzzle: AlternatePuzzle): GuideCard[] {
  const { size, regions } = puzzle;
  // The region that reaches across the most rows shows the idea best.
  const rowsOf = (region: number) => new Set(regions.flatMap((r, cell) => (r === region ? [Math.floor(cell / size)] : []))).size;
  const widest = [...new Set(regions)].sort((a, b) => rowsOf(b) - rowsOf(a))[0];
  const first = pick(puzzle, (cell) => regions[cell] !== widest);
  return [
    {
      title: 'Nine shapes instead of nine boxes',
      body: 'Rows and columns work as in classic Sudoku. Instead of 3 × 3 boxes, the board is cut into nine outlined regions of different shapes, and each region holds 1–9 once.',
      caption: 'Thick lines mark the regions.',
      selected: null,
    },
    {
      title: 'Follow the outline',
      body: 'The highlighted cells are the selected cell’s row, column and region. A region is not a square, so trace its outline rather than counting three across and three down.',
      caption: 'In a game, tap any cell to see its region.',
      selected: first,
    },
    {
      title: 'Long regions reach far',
      body: 'A region that winds across the board rules a digit out in many rows and columns at once. Look for a digit that can fit only one cell of a region.',
      caption: 'This region crosses several rows.',
      selected: pick(puzzle, (cell) => regions[cell] === widest),
    },
    {
      title: 'Solving tips',
      body: 'Start where a row or column crosses a region in just one or two empty cells. After placing a digit, re-check the three groups it belongs to: its row, its column and its region.',
      caption: 'Notes help: jot down what still fits.',
      selected: null,
    },
  ];
}

export function variantGuide(mode: VariantMode): VariantGuide {
  const puzzle = getAlternatePuzzle(mode, 0);
  const cards = mode === 'diagonal' ? diagonalCards(puzzle) : mode === 'killer' ? killerCards(puzzle) : irregularCards(puzzle);
  return { mode, name: ALTERNATE_MODES[mode].name, puzzle, cards };
}
