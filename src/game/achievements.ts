/**
 * Badges, all computed from finished games. Each pays a one-time hint-credit reward
 * the moment it is first earned.
 */
import { ENABLED_DIFFICULTIES } from '../data/pool';
import { DIFFICULTIES, type Difficulty } from '../engine/grader';
import { weeklyBadgeWeeks } from './events';
import { LEVEL_COUNT, levelProgress, totalStars } from './levels';
import { isMiniResult } from './playFormat';
import { longestStreak } from './streak';

export interface AchievementResult {
  slot: string;
  difficulty: Difficulty;
  dateKey: string | null;
  mistakes: number;
  hints: number;
  level?: number;
  stars?: number;
}

export interface Achievement {
  key: string;
  title: string;
  description: string;
  /** An Ionicons glyph name. */
  icon: string;
  progress: number;
  goal: number;
  /** Hint credits paid once, when the badge is first earned. */
  credits: number;
}

export function achievementsFor(completions: readonly AchievementResult[], streakDays: readonly string[]): Achievement[] {
  const solvedDifficulties = new Set<Difficulty>();
  const dailyDates = new Set<string>();
  let withoutHints = 0;
  let flawless = 0;
  let expert = 0;
  for (const completion of completions) {
    solvedDifficulties.add(completion.difficulty);
    if (completion.slot === 'daily' && completion.dateKey) dailyDates.add(completion.dateKey);
    // Small boards have no hints or 9×9 rules, so they do not count for these three.
    if (isMiniResult(completion)) continue;
    if (completion.hints === 0) withoutHints++;
    if (completion.mistakes === 0) flawless++;
    if (completion.difficulty === 'expert') expert++;
  }
  const levels = levelProgress(completions);
  const tracks = DIFFICULTIES.map((difficulty) => levels[difficulty]);
  const cleared = tracks.reduce((sum, stars) => sum + stars.filter((earned) => earned > 0).length, 0);
  const stars = tracks.reduce((sum, track) => sum + totalStars(track), 0);
  const perfect = tracks.reduce((sum, track) => sum + track.filter((earned) => earned === 3).length, 0);
  const bestTrack = Math.max(...tracks.map((track) => track.filter((earned) => earned > 0).length));
  const streak = longestStreak(streakDays);
  const solved = completions.length;

  return [
    { key: 'first-solve', title: 'First solve', description: 'Solve your first puzzle.', icon: 'trophy-outline', progress: solved, goal: 1, credits: 1 },
    { key: 'ten-solves', title: 'Ten solves', description: 'Solve 10 puzzles.', icon: 'medal-outline', progress: solved, goal: 10, credits: 2 },
    { key: 'fifty-solves', title: 'Fifty solves', description: 'Solve 50 puzzles.', icon: 'medal-outline', progress: solved, goal: 50, credits: 3 },
    { key: 'hundred-solves', title: 'Century', description: 'Solve 100 puzzles.', icon: 'medal', progress: solved, goal: 100, credits: 5 },
    {
      key: 'every-difficulty', title: 'Every difficulty', description: 'Solve a puzzle at each available difficulty.', icon: 'layers-outline',
      progress: ENABLED_DIFFICULTIES.filter((difficulty) => solvedDifficulties.has(difficulty)).length,
      goal: ENABLED_DIFFICULTIES.length, credits: 2,
    },
    { key: 'no-hints', title: 'No hints', description: 'Solve a 9×9 puzzle without using hints.', icon: 'star-outline', progress: withoutHints, goal: 1, credits: 1 },
    { key: 'flawless', title: 'Flawless', description: 'Solve a 9×9 puzzle without a single mistake.', icon: 'sparkles-outline', progress: flawless, goal: 1, credits: 2 },
    { key: 'expert-solve', title: 'Expert', description: 'Solve an Expert puzzle.', icon: 'ribbon-outline', progress: expert, goal: 1, credits: 3 },
    { key: 'first-daily', title: 'First daily', description: 'Finish a Daily Puzzle.', icon: 'calendar-outline', progress: dailyDates.size, goal: 1, credits: 1 },
    { key: 'daily-30', title: 'Daily regular', description: 'Finish 30 Daily Puzzles.', icon: 'calendar', progress: dailyDates.size, goal: 30, credits: 3 },
    { key: 'streak-3', title: 'Three-day streak', description: 'Finish Daily Puzzles on 3 consecutive days.', icon: 'flame-outline', progress: streak, goal: 3, credits: 1 },
    { key: 'streak-7', title: 'Week streak', description: 'Finish Daily Puzzles on 7 consecutive days.', icon: 'flame-outline', progress: streak, goal: 7, credits: 2 },
    { key: 'streak-30', title: 'Month streak', description: 'Finish Daily Puzzles on 30 consecutive days.', icon: 'flame', progress: streak, goal: 30, credits: 5 },
    { key: 'weekly-champion', title: 'Weekly Champion', description: 'Solve all three stages of a Weekly Challenge.', icon: 'ribbon-outline', progress: weeklyBadgeWeeks(completions).length, goal: 1, credits: 2 },
    { key: 'levels-10', title: 'Climber', description: 'Clear 10 levels.', icon: 'trending-up-outline', progress: cleared, goal: 10, credits: 2 },
    { key: 'track-complete', title: 'Track complete', description: `Clear all ${LEVEL_COUNT} levels of one difficulty.`, icon: 'flag-outline', progress: bestTrack, goal: LEVEL_COUNT, credits: 5 },
    { key: 'stars-30', title: 'Star collector', description: 'Earn 30 stars in Levels.', icon: 'star-half-outline', progress: stars, goal: 30, credits: 2 },
    { key: 'perfect-10', title: 'Perfectionist', description: 'Earn 3 stars on 10 levels.', icon: 'star', progress: perfect, goal: 10, credits: 3 },
  ];
}

export const isEarned = ({ progress, goal }: Pick<Achievement, 'progress' | 'goal'>) => progress >= goal;
