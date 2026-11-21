/**
 * Application state and actions. Screens read from `appStore` and call these functions;
 * storage writes are queued here so they never sit on the tap-feedback path.
 */
import { createAdProvider, isSimulatedAds } from '../ads';
import { RewardController, RewardOutcome, RewardState } from '../ads/rewardController';
import { AdProviderState, RewardedAdProvider, UNAVAILABLE_STATE } from '../ads/types';
import { DAILY_POOL, puzzlesOf } from '../data/pool';
import type { Difficulty } from '../engine/grader';
import { dailyPuzzleFor } from '../game/daily';
import { HintOffer, evaluateHint, withHintRevealed } from '../game/hintAccess';
import { Session, SessionSlot, createSession } from '../game/session';
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
  /** Date keys of finished daily puzzles. */
  dailyCompleted: string[];
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
  sessions: { classic: null, daily: null },
  dailyCompleted: [],
  completedPuzzleIds: [],
  ads: UNAVAILABLE_STATE,
  adsSimulated: false,
  reward: { phase: 'idle', lastOutcome: null },
});

export const clock = new GameClock();

let repo: Repository | null = null;
let adProvider: RewardedAdProvider | null = null;
let rewards: RewardController | null = null;
let initPromise: Promise<void> | null = null;

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
      for (const slot of ['classic', 'daily'] as SessionSlot[]) {
        const saved = sessions[slot];
        if (saved?.completed) {
          await repo.recordCompletion(saved, Date.now());
          sessions[slot] = null;
        }
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
        credits,
        dailyCompleted: completions.filter((c) => c.dateKey).map((c) => c.dateKey!),
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

/* -------------------------------- sessions -------------------------------- */

const saveTimers: Record<SessionSlot, ReturnType<typeof setTimeout> | null> = { classic: null, daily: null };

function setSession(slot: SessionSlot, session: Session | null) {
  appStore.setState((s) => ({ sessions: { ...s.sessions, [slot]: session } }));
}

/** The session with its elapsed time brought up to date from the running clock. */
function withClock(session: Session): Session {
  if (clock.slot !== session.slot) return session;
  const elapsedMs = clock.read();
  return elapsedMs === session.elapsedMs ? session : { ...session, elapsedMs };
}

/** Writes the session now. Used on pause, backgrounding and leaving the game screen. */
export function flushSession(slot: SessionSlot) {
  const timer = saveTimers[slot];
  if (timer) clearTimeout(timer);
  saveTimers[slot] = null;
  const current = appStore.getState().sessions[slot];
  if (!current || !repo) return;
  const session = withClock(current);
  if (session !== current) setSession(slot, session);
  repo.saveSession(session, Date.now()).catch(report('saveSession'));
}

function scheduleSave(slot: SessionSlot) {
  if (saveTimers[slot]) return;
  saveTimers[slot] = setTimeout(() => flushSession(slot), 700);
}

/** Applies a pure session operation. The screen updates immediately; the save follows. */
export function mutateSession(slot: SessionSlot, operation: (session: Session) => Session): Session | null {
  const current = appStore.getState().sessions[slot];
  if (!current) return null;
  const next = operation(current);
  if (next === current) return current;
  setSession(slot, next);
  if (next.completed) flushSession(slot);
  else scheduleSave(slot);
  return next;
}

function beginSession(session: Session) {
  setSession(session.slot, session);
  flushSession(session.slot);
  return session;
}

export function startClassic(difficulty: Difficulty): Session {
  const { completedPuzzleIds, sessions } = appStore.getState();
  const pool = puzzlesOf(difficulty);
  const done = new Set(completedPuzzleIds);
  const currentId = sessions.classic?.puzzleId;
  // Prefer puzzles not yet finished; once all are done, any but the current one.
  let choices = pool.filter((p) => !done.has(p.id) && p.id !== currentId);
  if (choices.length === 0) choices = pool.filter((p) => p.id !== currentId);
  if (choices.length === 0) choices = pool;
  const puzzle = choices[Math.floor(Math.random() * choices.length)];
  return beginSession(createSession(puzzle, 'classic', newId(), Date.now()));
}

export function startDaily(dateKey: string): Session {
  const puzzle = dailyPuzzleFor(dateKey, DAILY_POOL);
  return beginSession(createSession(puzzle, 'daily', newId(), Date.now(), dateKey));
}

/** Records a finished session once and clears its slot. Returns the completion id. */
export async function completeSession(slot: SessionSlot): Promise<string | null> {
  const current = appStore.getState().sessions[slot];
  if (!current || !current.completed) return null;
  if (clock.slot === slot) clock.stop();
  const session = withClock(current);
  const timer = saveTimers[slot];
  if (timer) clearTimeout(timer);
  saveTimers[slot] = null;
  try {
    await repo?.recordCompletion(session, Date.now());
  } catch (error) {
    report('recordCompletion')(error);
  }
  appStore.setState((s) => ({
    sessions: { ...s.sessions, [slot]: null },
    completedPuzzleIds: s.completedPuzzleIds.includes(session.puzzleId)
      ? s.completedPuzzleIds
      : [...s.completedPuzzleIds, session.puzzleId],
    dailyCompleted:
      session.slot === 'daily' && session.dateKey && !s.dailyCompleted.includes(session.dateKey)
        ? [...s.dailyCompleted, session.dateKey]
        : s.dailyCompleted,
  }));
  if (clock.slot === slot) clock.unload();
  return session.id;
}

export const getCompletion = (sessionId: string): Promise<Completion | null> =>
  repo ? repo.getCompletion(sessionId) : Promise.resolve(null);

export const getDailyCompletion = (dateKey: string): Promise<Completion | null> =>
  repo ? repo.getDailyCompletion(dateKey) : Promise.resolve(null);

/* ---------------------------------- hints --------------------------------- */

export function getHintOffer(slot: SessionSlot): HintOffer | null {
  const { sessions, credits } = appStore.getState();
  const session = sessions[slot];
  return session ? evaluateHint(session, credits) : null;
}

export type RevealResult = 'revealed' | 'insufficient' | 'error';

/**
 * Reveals a hint. The explanation is stored with its payment in one transaction, and
 * only then shown, so a hint is never charged without being available afterwards.
 */
export async function revealHint(slot: SessionSlot, offer: Extract<HintOffer, { kind: 'available' }>): Promise<RevealResult> {
  const current = appStore.getState().sessions[slot];
  if (!current || !repo) return 'error';
  const session = withHintRevealed(withClock(current), offer.hint, offer.cost);
  try {
    const { balance } = await repo.spendHint(session, offer.cost, Date.now());
    appStore.setState((s) => ({ credits: balance, sessions: { ...s.sessions, [slot]: session } }));
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
