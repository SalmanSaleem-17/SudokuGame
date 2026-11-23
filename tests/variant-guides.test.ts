import { describe, expect, it } from 'vitest';

import { VARIANT_MODES, isVariantMode, variantGuide } from '../src/game/variantGuides';

describe('variant how-to-play guides', () => {
  it('has a guide for each of the three variants and for nothing else', () => {
    expect(VARIANT_MODES).toEqual(['diagonal', 'killer', 'irregular']);
    expect(isVariantMode('killer')).toBe(true);
    expect(isVariantMode('mini-4')).toBe(false);
    expect(isVariantMode(undefined)).toBe(false);
  });

  it.each(VARIANT_MODES)('gives %s four readable cards that point at real cells', (mode) => {
    const guide = variantGuide(mode);
    expect(guide.puzzle.mode).toBe(mode);
    expect(guide.cards).toHaveLength(4);
    expect(new Set(guide.cards.map((card) => card.title)).size).toBe(4);
    for (const card of guide.cards) {
      expect(card.title.length).toBeGreaterThan(5);
      expect(card.body.length).toBeGreaterThan(60);
      expect(card.caption.length).toBeGreaterThan(10);
      if (card.selected !== null) {
        expect(Number.isInteger(card.selected)).toBe(true);
        expect(card.selected).toBeGreaterThanOrEqual(0);
        expect(card.selected).toBeLessThan(guide.puzzle.givens.length);
      }
    }
    // The first card shows the plain board; at least one later card highlights a cell.
    expect(guide.cards[0].selected).toBeNull();
    expect(guide.cards.some((card) => card.selected !== null)).toBe(true);
  });

  it('points the diagonal guide at a diagonal cell and then the centre', () => {
    const { cards } = variantGuide('diagonal');
    const onDiagonal = cards[1].selected!;
    expect(Math.floor(onDiagonal / 9)).toBe(onDiagonal % 9);
    expect(cards[2].selected).toBe(40);
  });

  it('describes a killer cage whose total really has only one combination', () => {
    const { puzzle, cards } = variantGuide('killer');
    const small = puzzle.cages[puzzle.cageOf[cards[1].selected!]];
    expect(small.cells.length).toBeGreaterThanOrEqual(2);

    const tight = puzzle.cages[puzzle.cageOf[cards[2].selected!]];
    expect(tight.combinations).toHaveLength(1);
    // The digits the card names are the cage's actual solution digits and add up to its total.
    const digits = tight.cells.map((cell) => puzzle.solution[cell]).sort((a, b) => a - b);
    expect(digits.reduce((sum, digit) => sum + digit, 0)).toBe(tight.sum);
    expect(cards[2].body).toContain(`has ${tight.cells.length} cells and totals ${tight.sum}`);
    for (const digit of digits) expect(cards[2].body).toMatch(new RegExp(`\\b${digit}\\b`));
  });

  it('points the irregular guide at two different regions', () => {
    const { puzzle, cards } = variantGuide('irregular');
    const first = puzzle.regions[cards[1].selected!];
    const widest = puzzle.regions[cards[2].selected!];
    expect(first).not.toBe(widest);
    const rows = (region: number) => new Set(puzzle.regions.flatMap((r, cell) => (r === region ? [Math.floor(cell / 9)] : []))).size;
    expect(rows(widest)).toBeGreaterThanOrEqual(rows(first));
  });
});
