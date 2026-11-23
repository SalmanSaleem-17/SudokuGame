export const BOARD_THEMES = ['charcoal', 'light', 'contrast'] as const;
export type BoardTheme = (typeof BOARD_THEMES)[number];

export function isBoardTheme(value: unknown): value is BoardTheme {
  return BOARD_THEMES.some((theme) => theme === value);
}

export interface Settings {
  /** Show the timer on the game screen. Time is still recorded when hidden. */
  timer: boolean;
  /** Mark entries that do not match the solution. Rule conflicts are always marked. */
  mistakeFeedback: boolean;
  /** Placing a digit removes it from notes in the same row, column and box. */
  smartNotes: boolean;
  /** Pick a digit first, then tap cells to place it. */
  numberFirst: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  boardTheme: BoardTheme;
}

export const DEFAULT_SETTINGS: Settings = {
  timer: true,
  mistakeFeedback: true,
  smartNotes: true,
  numberFirst: false,
  haptics: true,
  reducedMotion: false,
  boardTheme: 'charcoal',
};
