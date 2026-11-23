/**
 * Rewards earned by playing: experience points, player levels and hint credits.
 * Pure rules only. Every credit reward has a stable id, and storage grants each id at
 * most once, so replaying, restoring or resetting can never pay the same reward twice.
 */
import type { Difficulty } from '../engine/grader';
import { achievementsFor, isEarned, type AchievementResult } from './achievements';
import { weeklyProgress } from './events';
import { LEVEL_REWARD_INTERVAL } from './levels';
import { isMiniResult } from './playFormat';
import { currentStreak, isOnTime, streakDays, type DailyResult } from './streak';
import { parseDateKey } from './daily';

export interface RewardResult extends AchievementResult, DailyResult {
  sessionId: string;
}

/** Hint credits from the daily gift: one optional ad per local day. */
export const DAILY_GIFT_CREDITS = 3;

export interface RewardGrant {
  id: string;
  credits: number;
  label: string;
}

const BOARD_XP: Record<Difficulty, number> = { easy: 30, medium: 45, hard: 70, expert: 100 };
const MINI_XP: Record<Difficulty, number> = { easy: 10, medium: 20, hard: 20, expert: 20 };

export function completionXp(completion: Pick<RewardResult, 'slot' | 'difficulty' | 'stars'>): number {
  const stars = completion.slot === 'level' ? 5 * (completion.stars ?? 1) : 0;
  if (isMiniResult(completion)) return MINI_XP[completion.difficulty] + stars;
  const bonus = completion.slot === 'daily' ? 10 : completion.slot === 'weekly' ? 15 : stars;
  return BOARD_XP[completion.difficulty] + bonus;
}

export const totalXp = (completions: readonly Pick<RewardResult, 'slot' | 'difficulty' | 'stars'>[]) =>
  completions.reduce((sum, completion) => sum + completionXp(completion), 0);

/** Experience needed to reach a player level; level 1 starts at 0. */
export const xpForLevel = (level: number) => 50 * (level - 1) * level;

export function playerLevel(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, floor, next, progress: (xp - floor) / (next - floor) };
}

/** Days in a row that pay the streak bonus. */
export const STREAK_REWARD_INTERVAL = 7;

/**
 * The credit rewards a newly finished game has earned. `before` is every earlier
 * completion; `repaired` is the list of repaired streak days.
 */
export function rewardsForCompletion(
  before: readonly RewardResult[],
  completion: RewardResult,
  repaired: readonly string[],
): RewardGrant[] {
  const after = [...before, completion];
  const grants: RewardGrant[] = [];
  const { slot, dateKey, difficulty, level } = completion;

  if (slot === 'daily' && dateKey && isOnTime(dateKey, completion.completedAt)) {
    grants.push({ id: `daily:${dateKey}`, credits: 1, label: 'Daily Puzzle' });
    const streak = currentStreak(streakDays(after, repaired), parseDateKey(dateKey));
    if (streak > 0 && streak % STREAK_REWARD_INTERVAL === 0) {
      grants.push({ id: `streak:${dateKey}`, credits: 3, label: `${streak}-day streak` });
    }
  }

  if (slot === 'level' && level !== undefined && level % LEVEL_REWARD_INTERVAL === 0 &&
    !before.some((earlier) => earlier.slot === 'level' && earlier.difficulty === difficulty && earlier.level === level)) {
    grants.push({ id: `level:${difficulty}:${level}`, credits: 2, label: `Level ${level} cleared` });
  }

  if (slot === 'weekly' && dateKey && weeklyProgress(dateKey, after).earned && !weeklyProgress(dateKey, before).earned) {
    grants.push({ id: `weekly:${dateKey}`, credits: 3, label: 'Weekly Champion' });
  }

  const earnedBefore = new Set(achievementsFor(before, streakDays(before, repaired)).filter(isEarned).map(({ key }) => key));
  for (const achievement of achievementsFor(after, streakDays(after, repaired))) {
    if (isEarned(achievement) && !earnedBefore.has(achievement.key)) {
      grants.push({ id: `achievement:${achievement.key}`, credits: achievement.credits, label: achievement.title });
    }
  }

  const levelBefore = playerLevel(totalXp(before)).level;
  const levelAfter = playerLevel(totalXp(after)).level;
  for (let reached = levelBefore + 1; reached <= levelAfter; reached++) {
    grants.push({ id: `player-level:${reached}`, credits: 1, label: `Player level ${reached}` });
  }

  return grants;
}
