import type { Href } from 'expo-router';

import { DIFFICULTY_NAMES } from '../engine/grader';
import { formatTime } from '../state/clock';
import { miniClassicStatus, miniClassicTimeLimit, type MiniClassicSession } from './miniClassic';
import { PLAY_BOARD_SIZES } from './playFormat';
import { getSessionFailure, getTimeLimitMs, type Session } from './session';

export interface SavedGame {
  id: string;
  kind: 'classic' | 'mini';
  title: string;
  detail: string;
  href: Href;
  startedAt: number;
  solved: boolean;
}

function savedTime(elapsedMs: number, limitMs: number | null): string {
  return limitMs === null
    ? `${formatTime(elapsedMs)} played`
    : `${formatTime(Math.ceil(Math.max(0, limitMs - elapsedMs) / 1000) * 1000)} left`;
}

export function listPlayNowSaves(classic: Session | null, mini: MiniClassicSession | null): SavedGame[] {
  const games: SavedGame[] = [];
  if (classic && !getSessionFailure(classic)) {
    games.push({
      id: classic.id,
      kind: 'classic',
      title: `${DIFFICULTY_NAMES[classic.difficulty]} 9×9`,
      detail: classic.completed ? 'Ready to save result' : savedTime(classic.elapsedMs, getTimeLimitMs(classic)),
      href: { pathname: '/game', params: { slot: 'classic', source: 'saved-games' } },
      startedAt: classic.startedAt,
      solved: classic.completed,
    });
  }
  if (mini) {
    const status = miniClassicStatus(mini);
    if (status === 'playing' || status === 'solved') {
      const size = PLAY_BOARD_SIZES[mini.difficulty];
      games.push({
        id: mini.id,
        kind: 'mini',
        title: `${DIFFICULTY_NAMES[mini.difficulty]} ${size}×${size}`,
        detail: status === 'solved' ? 'Ready to save result' : savedTime(mini.elapsedMs, miniClassicTimeLimit(mini)),
        href: { pathname: '/alternate', params: { mode: mini.mode, play: 'classic', source: 'saved-games' } },
        startedAt: mini.startedAt,
        solved: status === 'solved',
      });
    }
  }
  return games.sort((a, b) => b.startedAt - a.startedAt);
}
