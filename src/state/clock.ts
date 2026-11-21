import type { SessionSlot } from '../game/session';

/**
 * Tracks active play time for the session on screen. It lives outside React state so a
 * ticking timer never re-renders the board; only the timer label reads it.
 */
export class GameClock {
  slot: SessionSlot | null = null;
  private baseMs = 0;
  private startedAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Points the clock at a session, stopped, with its saved elapsed time. */
  load(slot: SessionSlot, elapsedMs: number) {
    this.slot = slot;
    this.baseMs = elapsedMs;
    this.startedAt = null;
  }

  unload() {
    this.slot = null;
    this.baseMs = 0;
    this.startedAt = null;
  }

  get running() {
    return this.startedAt !== null;
  }

  start() {
    if (this.slot && this.startedAt === null) this.startedAt = this.now();
  }

  stop() {
    if (this.startedAt !== null) {
      this.baseMs += Math.max(0, this.now() - this.startedAt);
      this.startedAt = null;
    }
  }

  read(): number {
    return this.baseMs + (this.startedAt !== null ? Math.max(0, this.now() - this.startedAt) : 0);
  }
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
