/**
 * Application state and actions. Screens read from `appStore` and call these functions;
 * storage writes are queued here so they never sit on the tap-feedback path.
 */
import { createAdProvider, isSimulatedAds } from '../ads';
import { RewardController, RewardOutcome, RewardState } from '../ads/rewardController';
import { AdProviderState, RewardedAdProvider, UNAVAILABLE_STATE } from '../ads/types';
import { DAILY_POOL, puzzlesOf } from '../data/pool';
import type { Difficulty } from '../engine/grader';
import type { PuzzleRecord } from '../engine/pool';
import { alternatePuzzleCount, getAlternatePuzzle } from '../game/alternate';
import { createChallenge, type Challenge, type ChallengeScore } from '../game/challenge';
import { dailyPuzzleFor } from '../game/daily';
import { isWeeklyWeekKey, weeklyProgress, weeklyPuzzleFor, type WeeklyDifficulty } from '../game/events';
import { HintOffer, evaluateHint, withHintRevealed } from '../game/hintAccess';
import type { TechniquePackId } from '../game/learning';
import { MINI_CLASSIC_KEY, createMiniClassic, miniClassicStatus, miniClassicTimeLimit, readMiniClassic, type MiniClassicSession } from '../game/miniClassic';
import type { MiniMode } from '../game/playFormat';
import { SESSION_SLOTS, Session, SessionRules, SessionSlot, boardKey, createChallengeSession, createSession, createTechniqueSession, getSessionFailure, getTimeLimitMs } from '../game/session';
import { DEFAULT_SETTINGS, Settings } from '../game/settings';
import { openExpoDriver } from '../storage/expoDriver';
import { Completion, InsufficientCreditsError, Repository } from '../storage/repository';
import { GameClock } from './clock';
import { createStore } from './store';

export interface AppState {
  ready: boolean;
  loadError: string | null;
  settings: Settings;
  credits: number;
  sessions: Record<SessionSlot, Session | null>;
  miniClassic: MiniClassicSession | null;
  /** Date keys of finished daily puzzles. */
  dailyCompleted: string[];
  weeklyCompleted: Completion[];
  completedPuzzleIds: string[];
  ads: AdProviderState;
  adsSimulated: boolean;
  reward: RewardState;
}

export const appStore = createStore<AppState>({
  ready: false,
  loadError: null,
  settings: DEFAULT_SETTINGS,
  credits: 0,
  sessions: { classic: null, daily: null, challenge: null, technique: null, weekly: null },
  miniClassic: null,
  dailyCompleted: [],
  weeklyCompleted: [],
  completedPuzzleIds: [],
  ads: UNAVAILABLE_STATE,
  adsSimulated: false,
  reward: { phase: 'idle', lastOutcome: null },
});

export const clock = new GameClock();
export const miniClassicClock = new GameClock<'mini'>();

let repo: Repository | null = null;
let adProvider: RewardedAdProvider | null = null;
let rewards: RewardController | null = null;
let initPromise: Promise<void> | null = null;
const quittingAttempts = new Set<string>();

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;

const report = (label: string) => (error: unknown) => {
  if (__DEV__) console.warn(`[storage] ${label}`, error);
};

/* --------------------------------- startup -------------------------------- */

export function initApp(): Promise<void> {
  initPromise ??= (async () => {
    try {
      repo = await Repository.open(await openExpoDriver());
      const sessions = await repo.loadSessions();
      // If the app was killed between solving the last cell and recording the result,
      // finish the job now so the completion is never lost or replayed.
      for (const slot of SESSION_SLOTS) {
        const saved = sessions[slot];
        if (saved?.completed) {
          await repo.recordCompletion(saved, Date.now());
          sessions[slot] = null;
        }
      }
      let miniClassic = readMiniClassic(await repo.loadModeProgress(MINI_CLASSIC_KEY));
      if (miniClassic && miniClassicStatus(miniClassic) === 'solved') {
        await repo.recordMiniCompletion(miniClassic, Date.now());
        miniClassic = null;
      }
      const [settings, credits, completions] = await Promise.all([
        repo.loadSettings(),
        repo.getCredits(),
        repo.listCompletions(),
      ]);
      appStore.setState({
        ready: true,
        settings,
        sessions,
        miniClassic,
        credits,
        dailyCompleted: completions.flatMap((c) => c.slot === 'daily' && c.dateKey ? [c.dateKey] : []),
        weeklyCompleted: completions.filter((c) => c.slot === 'weekly'),
        completedPuzzleIds: completions.map((c) => c.puzzleId),
      });
    } catch (error) {
      appStore.setState({ ready: true, loadError: error instanceof Error ? error.message : String(error) });
    }
    startAds();
  })();
  return initPromise;
}

/** Consent and ad SDK setup run in the background and never hold up the game. */
function startAds() {
  try {
    adProvider = createAdProvider();
  } catch {
    return;
  }
  const provider = adProvider;
  rewards = new RewardController({
    provider,
    newAttemptId: newId,
    ledger: {
      grant: (grantId, credits) => {
        if (!repo) return Promise.reject(new Error('Storage unavailable'));
        return repo.grantReward(grantId, credits, Date.now());
      },
    },
    onBalance: (credits) => appStore.setState({ credits }),
  });
  const controller = rewards;
  provider.subscribe(() => appStore.setState({ ads: provider.getState() }));
  controller.subscribe(() => appStore.setState({ reward: controller.getState() }));
  appStore.setState({ ads: provider.getState(), adsSimulated: isSimulatedAds(provider) });
  void provider.start().then(() => appStore.setState({ ads: provider.getState() }));
}

/* -------------------------------- settings -------------------------------- */

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...appStore.getState().settings, ...patch };
  appStore.setState({ settings });
  repo?.saveSettings(settings).catch(report('saveSettings'));
}

export function loadModeProgress(key: string): Promise<unknown> {
  return repo ? repo.loadModeProgress(key) : Promise.reject(new Error('Saved data is unavailable.'));
}

export async function saveModeProgress(key: string, progress: unknown): Promise<void> {
  if (!repo) throw new Error('Saved data is unavailable.');
  await repo.saveModeProgress(key, progress);
}

/* ------------------------------ mini sessions ----------------------------- */

export async function startMiniClassic(mode: MiniMode, rules: SessionRules, options?: { replayIndex?: number }): Promise<MiniClassicSession> {
  const { miniClassic, completedPuzzleIds } = appStore.getState();
  if (miniClassic && miniClassicStatus(miniClassic) === 'solved') throw new Error('Save your finished puzzle first.');
  const count = alternatePuzzleCount(mode);
  const previousIndex = miniClassic?.mode === mode ? miniClassic.index : undefined;
  const completed = new Set(completedPuzzleIds);
  const indices = Array.from({ length: count }, (_, index) => index).filter((index) => index !== previousIndex);
  const unplayed = indices.find((index) => !completed.has(getAlternatePuzzle(mode, index).id));
  const nextIndex = unplayed ?? indices[Math.floor(Math.random() * indices.length)] ?? 0;
  const session = createMiniClassic(mode, options?.replayIndex ?? nextIndex, rules, newId(), Date.now());
  await saveModeProgress(MINI_CLASSIC_KEY, session);
  miniClassicClock.unload();
  appStore.setState({ miniClassic: session });
  return session;
}

function withMiniClock(session: MiniClassicSession): MiniClassicSession {
  if (!miniClassicClock.matches('mini', session.id) || miniClassicStatus(session) !== 'playing') return session;
  const elapsedMs = Math.min(miniClassicTimeLimit(session) ?? Infinity, Math.max(session.elapsedMs, miniClassicClock.read()));
  return elapsedMs === session.elapsedMs ? session : { ...session, elapsedMs };
}

function saveMiniClassic(session: MiniClassicSession) {
  if (miniClassicStatus(session) !== 'playing' && miniClassicClock.matches('mini', session.id)) miniClassicClock.stop();
  void saveModeProgress(MINI_CLASSIC_KEY, session).catch(report('saveMiniClassic'));
  appStore.setState({ miniClassic: session });
}

export function flushMiniClassic(id: string) {
  const current = appStore.getState().miniClassic;
  if (current?.id !== id || quittingAttempts.has(id)) return;
  const timed = withMiniClock(current);
  if (timed !== current) saveMiniClassic(timed);
}

export function mutateMiniClassic(id: string, operation: (session: MiniClassicSession) => MiniClassicSession): MiniClassicSession | null {
  const current = appStore.getState().miniClassic;
  if (current?.id !== id || quittingAttempts.has(id)) return null;
  const timed = withMiniClock(current);
  if (miniClassicStatus(timed) !== 'playing') {
    if (timed !== current) saveMiniClassic(timed);
    return timed;
  }
  const next = operation(timed);
  if (next === timed) return current;
  saveMiniClassic(next);
  return next;
}

export async function quitMiniClassic(id: string): Promise<boolean> {
  const session = appStore.getState().miniClassic;
  if (session?.id !== id || miniClassicStatus(session) === 'solved' || quittingAttempts.has(id)) return false;
  if (!repo) throw new Error('Saved data is unavailable.');
  quittingAttempts.add(id);
  try {
    await repo.deleteMiniClassic(id);
    if (appStore.getState().miniClassic?.id !== id) return false;
    if (miniClassicClock.matches('mini', id)) miniClassicClock.unload();
    appStore.setState({ miniClassic: null });
    return true;
  } finally {
    quittingAttempts.delete(id);
    flushMiniClassic(id);
  }
}

export async function completeMiniClassic(id: string): Promise<string | null> {
  const session = appStore.getState().miniClassic;
  if (!repo || session?.id !== id || miniClassicStatus(session) !== 'solved') return null;
  try {
    await repo.recordMiniCompletion(session, Date.now());
  } catch (error) {
    report('recordMiniCompletion')(error);
    return null;
  }
  appStore.setState((state) => ({
    miniClassic: state.miniClassic?.id === id ? null : state.miniClassic,
    completedPuzzleIds: state.completedPuzzleIds.includes(session.progress.puzzleId)
      ? state.completedPuzzleIds : [...state.completedPuzzleIds, session.progress.puzzleId],
  }));
  if (miniClassicClock.matches('mini', id)) miniClassicClock.unload();
  return id;
}

/* -------------------------------- sessions -------------------------------- */

const saveTimers: Partial<Record<SessionSlot, ReturnType<typeof setTimeout>>> = {};

function setSession(slot: SessionSlot, session: Session | null) {
  appStore.setState((s) => ({ sessions: { ...s.sessions, [slot]: session } }));
}

/** The session with its elapsed time brought up to date from the running clock. */
function withClock(session: Session): Session {
  if (!clock.matches(session.slot, session.id) || session.completed || getSessionFailure(session)) return session;
  const elapsedMs = Math.min(getTimeLimitMs(session) ?? Infinity, Math.max(session.elapsedMs, clock.read()));
  return elapsedMs === session.elapsedMs ? session : { ...session, elapsedMs };
}

/** Writes the session now, including when play stops or a countdown reaches zero. */
export function flushSession(slot: SessionSlot) {
  const timer = saveTimers[slot];
  if (timer) clearTimeout(timer);
  delete saveTimers[slot];
  const current = appStore.getState().sessions[slot];
  if (!current || quittingAttempts.has(current.id)) return;
  const session = withClock(current);
  if ((session.completed || getSessionFailure(session)) && clock.matches(slot, session.id)) clock.stop();
  if (session !== current) setSession(slot, session);
  repo?.saveSession(session, Date.now()).catch(report('saveSession'));
}

function scheduleSave(slot: SessionSlot) {
  if (saveTimers[slot]) return;
  saveTimers[slot] = setTimeout(() => flushSession(slot), 700);
}

/** Applies a pure session operation. The screen updates immediately; the save follows. */
export function mutateSession(slot: SessionSlot, operation: (session: Session) => Session): Session | null {
  const current = appStore.getState().sessions[slot];
  if (!current || quittingAttempts.has(current.id)) return null;
  const timed = withClock(current);
  if (timed.completed || getSessionFailure(timed)) {
    if (timed !== current) {
      setSession(slot, timed);
      flushSession(slot);
    }
    return timed;
  }
  const next = operation(timed);
  if (next === timed) return current;
  setSession(slot, next);
  if (next.completed || getSessionFailure(next)) flushSession(slot);
  else scheduleSave(slot);
  return next;
}

/** Discards the selected attempt, including any edits queued before the player quit. */
export async function quitSession(slot: SessionSlot, id: string): Promise<boolean> {
  const session = appStore.getState().sessions[slot];
  if (session?.id !== id || session.completed || quittingAttempts.has(id)) return false;
  if (!repo) throw new Error('Saved data is unavailable.');
  quittingAttempts.add(id);
  try {
    await repo.deleteSession(slot, id);
    if (appStore.getState().sessions[slot]?.id !== id) return false;
    if (clock.matches(slot, id)) clock.unload();
    setSession(slot, null);
    return true;
  } finally {
    quittingAttempts.delete(id);
    if (appStore.getState().sessions[slot]?.id === id) flushSession(slot);
  }
}

function beginSession(session: Session) {
  if (clock.slot === session.slot) clock.unload();
  setSession(session.slot, session);
  flushSession(session.slot);
  return session;
}

function choosePuzzle(difficulty: Difficulty, slot: 'classic' | 'challenge') {
  const { completedPuzzleIds, sessions } = appStore.getState();
  const pool = puzzlesOf(difficulty);
  const done = new Set(completedPuzzleIds);
  const currentId = sessions[slot]?.puzzleId;
  // Prefer puzzles not yet finished; once all are done, any but the current one.
  let choices = pool.filter((p) => !done.has(p.id) && p.id !== currentId);
  if (choices.length === 0) choices = pool.filter((p) => p.id !== currentId);
  if (choices.length === 0) choices = pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

export function startClassic(difficulty: Difficulty, rules?: SessionRules): Session {
  return beginSession(createSession(choosePuzzle(difficulty, 'classic'), 'classic', newId(), Date.now(), null, rules));
}

export function prepareChallenge(difficulty: Difficulty, rules: SessionRules): Challenge {
  return createChallenge(choosePuzzle(difficulty, 'challenge'), rules);
}

export function startChallenge(challenge: Challenge): Session {
  const current = appStore.getState().sessions.challenge;
  if (current?.challengeCode === challenge.code && !getSessionFailure(withClock(current))) {
    return current;
  }
  return beginSession(createChallengeSession(challenge, newId(), Date.now()));
}

export function startDaily(dateKey: string): Session {
  const puzzle = dailyPuzzleFor(dateKey, DAILY_POOL);
  return beginSession(createSession(puzzle, 'daily', newId(), Date.now(), dateKey));
}

export function startTechnique(puzzle: PuzzleRecord, techniquePack: TechniquePackId): Session {
  const current = appStore.getState().sessions.technique;
  if (current?.puzzleId === puzzle.id && current.techniquePack === techniquePack) return current;
  return beginSession(createTechniqueSession(puzzle, techniquePack, newId(), Date.now()));
}

export function startWeekly(weekKey: string, difficulty: WeeklyDifficulty): Session | null {
  if (!isWeeklyWeekKey(weekKey)) return null;
  const { sessions, weeklyCompleted } = appStore.getState();
  if (weeklyProgress(weekKey, weeklyCompleted).next !== difficulty) return null;
  const current = sessions.weekly;
  if (current?.dateKey === weekKey && current.difficulty === difficulty) return current;
  if (current?.completed) return null;
  const puzzle = weeklyPuzzleFor(weekKey, difficulty);
  return beginSession(createSession(puzzle, 'weekly', newId(), Date.now(), weekKey));
}

/** Records a finished session once and clears its slot. Returns the completion id. */
export async function completeSession(slot: SessionSlot): Promise<string | null> {
  const current = appStore.getState().sessions[slot];
  if (!current || !current.completed) return null;
  if (clock.matches(slot, current.id)) clock.stop();
  const session = current;
  const timer = saveTimers[slot];
  if (timer) clearTimeout(timer);
  delete saveTimers[slot];
  let weeklyCompletion: Completion | null = null;
  try {
    if (!repo) return null;
    await repo.recordCompletion(session, Date.now());
    if (slot === 'weekly') weeklyCompletion = await repo.getCompletion(session.id);
  } catch (error) {
    report('recordCompletion')(error);
    return null;
  }
  appStore.setState((s) => ({
    sessions: s.sessions[slot]?.id === session.id ? { ...s.sessions, [slot]: null } : s.sessions,
    completedPuzzleIds: s.completedPuzzleIds.includes(session.puzzleId)
      ? s.completedPuzzleIds
      : [...s.completedPuzzleIds, session.puzzleId],
    dailyCompleted:
      session.slot === 'daily' && session.dateKey && !s.dailyCompleted.includes(session.dateKey)
        ? [...s.dailyCompleted, session.dateKey]
        : s.dailyCompleted,
    weeklyCompleted: weeklyCompletion && !s.weeklyCompleted.some((completion) => completion.sessionId === session.id)
      ? [...s.weeklyCompleted, weeklyCompletion]
      : s.weeklyCompleted,
  }));
  if (clock.matches(slot, session.id)) clock.unload();
  return session.id;
}

export const getCompletion = (sessionId: string): Promise<Completion | null> =>
  repo ? repo.getCompletion(sessionId) : Promise.resolve(null);

export const getDailyCompletion = (dateKey: string): Promise<Completion | null> =>
  repo ? repo.getDailyCompletion(dateKey) : Promise.resolve(null);

export const listCompletions = (): Promise<Completion[]> => (repo ? repo.listCompletions() : Promise.resolve([]));

export const getFriendChallengeScore = (challengeCode: string): Promise<ChallengeScore | null> =>
  repo ? repo.getFriendChallengeScore(challengeCode) : Promise.resolve(null);

export async function saveFriendChallengeScore(score: ChallengeScore): Promise<void> {
  if (!repo) throw new Error('Saved data is unavailable.');
  await repo.saveFriendChallengeScore(score);
}

/* ---------------------------------- hints --------------------------------- */

export function getHintOffer(slot: SessionSlot): HintOffer | null {
  const { sessions, credits } = appStore.getState();
  const session = sessions[slot];
  return session && !quittingAttempts.has(session.id) && !getSessionFailure(withClock(session)) ? evaluateHint(session, credits) : null;
}

export type RevealResult = 'revealed' | 'insufficient' | 'error';

/**
 * Reveals a hint. The explanation is stored with its payment in one transaction, and
 * only then shown, so a hint is never charged without being available afterwards.
 */
export async function revealHint(slot: SessionSlot, offer: Extract<HintOffer, { kind: 'available' }>): Promise<RevealResult> {
  const current = appStore.getState().sessions[slot];
  if (!current || !repo || quittingAttempts.has(current.id)) return 'error';
  const timed = withClock(current);
  if (timed.completed || getSessionFailure(timed) || offer.hint.boardKey !== boardKey(timed.values)) return 'error';
  const session = withHintRevealed(timed, offer.hint, offer.cost);
  try {
    const { balance } = await repo.spendHint(session, offer.cost, Date.now());
    const latest = appStore.getState().sessions[slot];
    if (latest?.id !== session.id) {
      appStore.setState({ credits: balance });
      return 'revealed';
    }
    // Saving a hint can overlap a pause, timeout or board edit. Keep the current board and clock.
    const merged = {
      ...latest,
      elapsedMs: Math.max(latest.elapsedMs, session.elapsedMs),
      hint: session.hint,
      hintsUsed: session.hintsUsed,
      freeHintUsed: session.freeHintUsed,
    };
    appStore.setState((s) => ({ credits: balance, sessions: { ...s.sessions, [slot]: merged } }));
    if (latest !== current) flushSession(slot);
    return 'revealed';
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      repo.getCredits().then((credits) => appStore.setState({ credits }), report('getCredits'));
      return 'insufficient';
    }
    report('spendHint')(error);
    return 'error';
  }
}

/* ----------------------------------- ads ---------------------------------- */

/** Starts one rewarded ad. Only ever called from the player's explicit "Watch ad" tap. */
export function watchRewardedAd(): Promise<RewardOutcome> {
  if (!rewards) return Promise.resolve({ kind: 'failed', reason: 'unsupported' });
  return rewards.watchAd();
}

export function clearRewardOutcome() {
  rewards?.clearOutcome();
}

export function showPrivacyOptions(): Promise<void> {
  return adProvider ? adProvider.showPrivacyOptions().catch(() => undefined) : Promise.resolve();
}
