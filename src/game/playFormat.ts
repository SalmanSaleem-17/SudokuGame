import type { Difficulty } from '../engine/grader';

export const PLAY_BOARD_SIZES = { easy: 4, medium: 6, hard: 9, expert: 9 } as const satisfies Record<Difficulty, 4 | 6 | 9>;

export type MiniMode = 'mini-4' | 'mini-6';

export function miniModeForDifficulty(difficulty: Difficulty): MiniMode | null {
  if (difficulty === 'easy') return 'mini-4';
  return difficulty === 'medium' ? 'mini-6' : null;
}
