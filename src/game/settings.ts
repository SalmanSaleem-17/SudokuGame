export const BOARD_THEMES = [
  'charcoal', 'light', 'contrast',
  'midnight', 'forest', 'ocean',
  'lavender', 'rose', 'sunset',
  'slate', 'sand', 'mint',
] as const;
export type BoardTheme = (typeof BOARD_THEMES)[number];

/** Always available, including the light and high-contrast boards. The others unlock with one ad each. */
export const FREE_BOARD_THEMES: readonly BoardTheme[] = ['charcoal', 'light', 'contrast'];

/** A theme can be used when it is free, already unlocked, or the one currently selected. */
export function isThemeAvailable(theme: BoardTheme, unlocked: readonly string[], current: BoardTheme): boolean {
  return FREE_BOARD_THEMES.includes(theme) || unlocked.includes(theme) || theme === current;
}

export function isBoardTheme(value: unknown): value is BoardTheme {
  return BOARD_THEMES.some((theme) => theme === value);
}

/** Hours of the day the Daily Puzzle reminder can be set to. */
export const REMINDER_HOURS = [8, 12, 18, 21] as const;

export function isReminderHour(value: unknown): value is (typeof REMINDER_HOURS)[number] {
  return REMINDER_HOURS.some((hour) => hour === value);
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
  /** A local notification each day when the Daily Puzzle is ready. Off until the player opts in. */
  reminder: boolean;
  reminderHour: (typeof REMINDER_HOURS)[number];
}

export const DEFAULT_SETTINGS: Settings = {
  timer: true,
  mistakeFeedback: true,
  smartNotes: true,
  numberFirst: false,
  haptics: true,
  reducedMotion: false,
  boardTheme: 'charcoal',
  reminder: false,
  reminderHour: 18,
};
