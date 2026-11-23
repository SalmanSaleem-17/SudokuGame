/**
 * Application state and actions. Screens read from `appStore` and call these functions;
 * storage writes are queued here so they never sit on the tap-feedback path.
 */
import { createAdProvider, isSimulatedAds } from '../ads';
import { AdReward, RewardController, RewardOutcome, RewardState } from '../ads/rewardController';
import { AdProviderState, RewardedAdProvider, UNAVAILABLE_STATE } from '../ads/types';
import { DAILY_POOL, puzzlesOf } from '../data/pool';
import { DIFFICULTIES, type Difficulty } from '../engine/grader';
import type { PuzzleRecord } from '../engine/pool';
import { alternatePuzzleCount, getAlternatePuzzle } from '../game/alternate';
import { createChallenge, type Challenge, type ChallengeScore } from '../game/challenge';
import { applyBoardContinue, applyMiniContinue } from '../game/continue';
import { dailyPuzzleFor, dateKeyOf } from '../game/daily';
import { isWeeklyWeekKey, weeklyProgress, weeklyPuzzleFor, type WeeklyDifficulty } from '../game/events';
import { HintOffer, evaluateHint, withHintRevealed } from '../game/hintAccess';
import type { TechniquePackId } from '../game/learning';
import { LEVEL_COUNT, isLevelNumber, isLevelUnlocked, levelProgress, levelPuzzle, levelRules, miniLevelIndex } from '../game/levels';
import { MINI_CLASSIC_KEY, MINI_LEVEL_KEY, createMiniClassic, createMiniLevel, miniClassicStatus, miniClassicTimeLimit, readMiniClassic, type MiniClassicSession } from '../game/miniClassic';
import { miniModeForDifficulty, type MiniMode } from '../game/playFormat';
import { DAILY_GIFT_CREDITS, completionXp, rewardsForCompletion, totalXp, type RewardGrant } from '../game/rewards';
import { DEFAULT_SESSION_RULES, SESSION_SLOTS, Session, SessionRules, SessionSlot, boardKey, createChallengeSession, createLevelSession, createSession, createTechniqueSession, getSessionFailure, getTimeLimitMs } from '../game/session';
import { DEFAULT_SETTINGS, FREE_BOARD_THEMES, Settings, isBoardTheme, isThemeAvailable, type BoardTheme } from '../game/settings';
import { isStreakList, repairableDay, streakDays } from '../game/streak';
import { openExpoDriver } from '../storage/expoDriver';
import { BackupData, Completion, InsufficientCreditsError, Repository } from '../storage/repository';
import { GameClock } from './clock';
import { createStore } from './store';

export interface AppState {
  ready: boolean;
  loadError: string | null;
  settings: Settings;
  credits: number;
  sessions: Record<SessionSlot, Session | null>;
  miniClassic: MiniClassicSession | null;
  /** The Easy (4×4) or Medium (6×6) level attempt in progress. */
  miniLevel: MiniClassicSession | null;
  /** Date keys of finished daily puzzles. */
  dailyCompleted: string[];
  weeklyCompleted: Completion[];
  completedPuzzleIds: string[];
  /** Best stars per level for each difficulty; 0 means not cleared. */
  levelStars: Record<Difficulty, number[]>;
  /** Experience from every finished game. */
  xp: number;
  /** Dates that count toward the daily streak, including repaired ones. */
  streakDays: string[];
  streakRepairs: string[];
  /** What the most recently finished game earned, shown on its results screen. */
  lastRewards: { sessionId: string; grants: RewardGrant[]; xp: number; doubled?: boolean } | null;
  /** Board themes opened with an ad. The free themes are not listed. */
  unlockedThemes: BoardTheme[];
  /** The local day whose daily gift has been claimed, when that is known. */
  giftDay: string | null;
  ads: AdProviderState;
  adsSimulated: boolean;
  reward: RewardState;
}

function emptyLevelStars(): Record<Difficulty, number[]> {
  return Object.fromEntries(DIFFICULTIES.map((d) => [d, new Array<number>(LEVEL_COUNT).fill(0)])) as Record<Difficulty, number[]>;
}

export const appStore = createStore<AppState>({
  ready: false,
  loadError: null,
  settings: DEFAULT_SETTINGS,
  credits: 0,
  sessions: { classic: null, daily: null, challenge: null, technique: null, weekly: null, level: null },
  miniClassic: null,
  miniLevel: null,
  dailyCompleted: [],
  weeklyCompleted: [],
  completedPuzzleIds: [],
  levelStars: emptyLevelStars(),
  xp: 0,
  streakDays: [],
  streakRepairs: [],
  lastRewards: null,
  unlockedThemes: [],
  giftDay: null,
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
      await loadProgress(repo);
    } catch (error) {
      appStore.setState({ ready: true, loadError: error instanceof Error ? error.message : String(error) });
    }
    startAds();
  })();
  return initPromise;
}

const STREAK_REPAIRS_KEY = 'streak-repairs';
const THEME_GRANT = 'theme:';
const giftGrantId = (dateKey: string) => `gift:${dateKey}`;

/** Reads everything saved on the device into the store. Also used after a reset or a restore. */
async function loadProgress(store: Repository): Promise<void> {
  const sessions = await store.loadSessions();
  const recovered: string[] = [];
  // If the app was killed between solving the last cell and recording the result,
  // finish the job now so the completion is never lost or replayed.
  for (const slot of SESSION_SLOTS) {
    const saved = sessions[slot];
    if (saved?.completed) {
      await store.recordCompletion(saved, Date.now());
      recovered.push(saved.id);
      sessions[slot] = null;
    }
  }
  const loadMini = async (key: string) => {
    const saved = readMiniClassic(await store.loadModeProgress(key));
    if (!saved || miniClassicStatus(saved) !== 'solved') return saved;
    await store.recordMiniCompletion(saved, Date.now());
    recovered.push(saved.id);
    return null;
  };
  const miniClassic = await loadMini(MINI_CLASSIC_KEY);
  const miniLevel = await loadMini(MINI_LEVEL_KEY);
  const today = dateKeyOf(new Date());
  const [settings, credits, completions, repairs, themeGrants, giftGrants] = await Promise.all([
    store.loadSettings(),
    store.getCredits(),
    store.listCompletions(),
    store.loadModeProgress(STREAK_REPAIRS_KEY),
    store.listGrantIds(THEME_GRANT),
    store.listGrantIds(giftGrantId(today)),
  ]);
  const streakRepairs = isStreakList(repairs) ? repairs : [];
  const unlockedThemes = themeGrants.map((id) => id.slice(THEME_GRANT.length)).filter(isBoardTheme);
  // A theme chosen before themes had locks, or restored from a backup, stays the player's.
  if (!isThemeAvailable(settings.boardTheme, unlockedThemes, DEFAULT_SETTINGS.boardTheme)) {
    await store.grantRewards([{ id: THEME_GRANT + settings.boardTheme, credits: 0 }], Date.now());
    unlockedThemes.push(settings.boardTheme);
  }
  appStore.setState({
    ready: true,
    loadError: null,
    settings,
    sessions,
    miniClassic,
    miniLevel,
    credits,
    dailyCompleted: completions.flatMap((c) => c.slot === 'daily' && c.dateKey ? [c.dateKey] : []),
    weeklyCompleted: completions.filter((c) => c.slot === 'weekly'),
    completedPuzzleIds: completions.map((c) => c.puzzleId),
    levelStars: levelProgress(completions),
    xp: totalXp(completions),
    streakDays: streakDays(completions, streakRepairs),
    streakRepairs,
    lastRewards: null,
    unlockedThemes,
    giftDay: giftGrants.length > 0 ? today : null,
  });
  for (const sessionId of recovered) await settleRewards(sessionId);
}

/**
 * Pays what a newly recorded game earned and refreshes everything derived from results.
 * Each reward id is granted at most once by storage, so calling this twice is harmless.
 */
async function settleRewards(sessionId: string): Promise<void> {
  if (!repo) return;
  try {
    const completions = await repo.listCompletions();
    const completion = completions.find((c) => c.sessionId === sessionId);
    if (!completion) return;
    const { streakRepairs } = appStore.getState();
    const earned = rewardsForCompletion(completions.filter((c) => c.sessionId !== sessionId), completion, streakRepairs);
    const { granted, balance } = await repo.grantRewards(earned, Date.now());
    appStore.setState({
      credits: balance,
      levelStars: levelProgress(completions),
      xp: totalXp(completions),
      streakDays: streakDays(completions, streakRepairs),
      lastRewards: { sessionId, grants: granted, xp: completionXp(completion) },
    });
  } catch (error) {
    report('settleRewards')(error);
  }
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
  const { settings: current, unlockedThemes } = appStore.getState();
  // A locked board theme cannot be selected; it opens through `watchAdToUnlockTheme`.
  if (patch.boardTheme && !isThemeAvailable(patch.boardTheme, unlockedThemes, current.boardTheme)) return;
  const settings = { ...current, ...patch };
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

/** A small-board game is either the Play Now mini or an Easy or Medium level attempt. */
const miniSaveKey = (session: MiniClassicSession) => (session.level ? MINI_LEVEL_KEY : MINI_CLASSIC_KEY);

function setMini(session: MiniClassicSession | null, level: boolean) {
  appStore.setState(level ? { miniLevel: session } : { miniClassic: session });
}

/** Finds the small-board game with this id, whichever of the two saves it is. */
function findMini(id: string): MiniClassicSession | null {
  const { miniClassic, miniLevel } = appStore.getState();
  return miniClassic?.id === id ? miniClassic : miniLevel?.id === id ? miniLevel : null;
}

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

/**
 * Starts or resumes an Easy (4×4) or Medium (6×6) level. `fresh` always begins a new
 * attempt. Returns null when the level is locked or is not played on a small board.
 */
export async function startMiniLevel(difficulty: Difficulty, number: number, fresh = false): Promise<MiniClassicSession | null> {
  const mode = miniModeForDifficulty(difficulty);
  const { miniLevel, levelStars } = appStore.getState();
  if (!mode || !isLevelNumber(number) || !isLevelUnlocked(levelStars[difficulty], number)) return null;
  if (miniLevel && miniClassicStatus(miniLevel) === 'solved') throw new Error('Save your finished level first.');
  if (!fresh && miniLevel?.mode === mode && miniLevel.level?.number === number && miniClassicStatus(withMiniClock(miniLevel)) === 'playing') {
    return miniLevel;
  }
  const session = createMiniLevel(mode, miniLevelIndex(number), levelRules(difficulty, number), newId(), Date.now());
  await saveModeProgress(MINI_LEVEL_KEY, session);
  miniClassicClock.unload();
  appStore.setState({ miniLevel: session });
  return session;
}

function withMiniClock(session: MiniClassicSession): MiniClassicSession {
  if (!miniClassicClock.matches('mini', session.id) || miniClassicStatus(session) !== 'playing') return session;
  const elapsedMs = Math.min(miniClassicTimeLimit(session) ?? Infinity, Math.max(session.elapsedMs, miniClassicClock.read()));
  return elapsedMs === session.elapsedMs ? session : { ...session, elapsedMs };
}

function saveMiniClassic(session: MiniClassicSession) {
  if (miniClassicStatus(session) !== 'playing' && miniClassicClock.matches('mini', session.id)) miniClassicClock.stop();
  void saveModeProgress(miniSaveKey(session), session).catch(report('saveMiniClassic'));
  setMini(session, !!session.level);
}

export function flushMiniClassic(id: string) {
  const current = findMini(id);
  if (!current || quittingAttempts.has(id)) return;
  const timed = withMiniClock(current);
  if (timed !== current) saveMiniClassic(timed);
}

export function mutateMiniClassic(id: string, operation: (session: MiniClassicSession) => MiniClassicSession): MiniClassicSession | null {
  const current = findMini(id);
  if (!current || quittingAttempts.has(id)) return null;
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
  const session = findMini(id);
  if (!session || miniClassicStatus(session) === 'solved' || quittingAttempts.has(id)) return false;
  if (!repo) throw new Error('Saved data is unavailable.');
  quittingAttempts.add(id);
  try {
    await repo.deleteMiniClassic(id, miniSaveKey(session));
    if (findMini(id)?.id !== id) return false;
    if (miniClassicClock.matches('mini', id)) miniClassicClock.unload();
    setMini(null, !!session.level);
    return true;
  } finally {
    quittingAttempts.delete(id);
    flushMiniClassic(id);
  }
}

export async function completeMiniClassic(id: string): Promise<string | null> {
  const session = findMini(id);
  if (!repo || !session || miniClassicStatus(session) !== 'solved') return null;
  try {
    await repo.recordMiniCompletion(session, Date.now());
  } catch (error) {
    report('recordMiniCompletion')(error);
    return null;
  }
  if (findMini(id)) setMini(null, !!session.level);
  appStore.setState((state) => ({
    completedPuzzleIds: state.completedPuzzleIds.includes(session.progress.puzzleId)
      ? state.completedPuzzleIds : [...state.completedPuzzleIds, session.progress.puzzleId],
  }));
  if (miniClassicClock.matches('mini', id)) miniClassicClock.unload();
  await settleRewards(id);
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

/** Plays a puzzle the player typed in. It uses the classic slot with no time or mistake limit. */
export function startCustom(puzzle: PuzzleRecord): Session {
  return beginSession(createSession(puzzle, 'classic', newId(), Date.now(), null, DEFAULT_SESSION_RULES));
}

/** Starts or resumes a 9×9 (Hard or Expert) level. Returns null when the stage is still locked. */
export function startLevel(difficulty: Difficulty, number: number): Session | null {
  if (!isLevelNumber(number) || miniModeForDifficulty(difficulty)) return null;
  const { sessions, levelStars } = appStore.getState();
  if (!isLevelUnlocked(levelStars[difficulty], number)) return null;
  const current = sessions.level;
  if (current && !current.completed && current.difficulty === difficulty && current.level?.number === number &&
    !getSessionFailure(withClock(current))) {
    return current;
  }
  return beginSession(createLevelSession(levelPuzzle(difficulty, number), levelRules(difficulty, number), newId(), Date.now()));
}

export type LevelRoute =
  | { pathname: '/game'; params: { slot: 'level' } }
  | { pathname: '/alternate'; params: { mode: MiniMode; play: 'level' } };

/**
 * Starts or resumes any level and says which screen plays it: the small-board screen for
 * Easy and Medium, the 9×9 game screen for Hard and Expert. Null when the level is locked.
 */
export async function openLevel(difficulty: Difficulty, number: number, fresh = false): Promise<LevelRoute | null> {
  const mode = miniModeForDifficulty(difficulty);
  if (mode) {
    return (await startMiniLevel(difficulty, number, fresh)) ? { pathname: '/alternate', params: { mode, play: 'level' } } : null;
  }
  return startLevel(difficulty, number) ? { pathname: '/game', params: { slot: 'level' } } : null;
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
  await settleRewards(session.id);
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

function watchAdFor(reward: AdReward): Promise<RewardOutcome> {
  if (!rewards) return Promise.resolve({ kind: 'failed', reason: 'unsupported' });
  return rewards.watchAd(reward);
}

/**
 * One optional ad lets the ended game with this id continue: one more mistake after the
 * mistake limit, or more time after a level's clock ran out (see `game/continue`). The
 * change is saved together with the ad's grant id, so it is applied exactly once.
 */
export function watchAdToContinue(sessionId: string): Promise<RewardOutcome> {
  return watchAdFor({
    credits: 0,
    grant: async (grantId) => {
      if (!repo) throw new Error('Saved data is unavailable.');
      const mini = findMini(sessionId);
      if (mini) {
        const next = applyMiniContinue(mini);
        if (!next) throw new Error('Nothing to continue');
        const result = await repo.grantModeReward(grantId, miniSaveKey(next), next, Date.now());
        if (result.granted && findMini(sessionId)) setMini(next, !!next.level);
        return result;
      }
      const { sessions } = appStore.getState();
      const current = SESSION_SLOTS.map((slot) => sessions[slot]).find((session) => session?.id === sessionId);
      const next = current ? applyBoardContinue(current) : null;
      if (!next) throw new Error('Nothing to continue');
      const result = await repo.grantSessionReward(grantId, next, Date.now());
      if (result.granted && appStore.getState().sessions[next.slot]?.id === next.id) setSession(next.slot, next);
      return result;
    },
  });
}

/** Hint credits a finished game paid, which one optional ad can pay a second time. */
export function doubleableCredits(sessionId: string): number {
  const last = appStore.getState().lastRewards;
  if (last?.sessionId !== sessionId || last.doubled) return 0;
  return last.grants.reduce((sum, grant) => sum + grant.credits, 0);
}

/** One optional ad pays a finished game's hint credits again. Once per game. */
export function watchAdToDoubleRewards(sessionId: string): Promise<RewardOutcome> {
  const credits = doubleableCredits(sessionId);
  if (credits <= 0) return Promise.resolve({ kind: 'failed', reason: 'unsupported' });
  return watchAdFor({
    credits,
    grant: async () => {
      if (!repo) throw new Error('Saved data is unavailable.');
      // The id belongs to the game, not the ad, so a game can never be doubled twice.
      const result = await repo.grantReward(`double:${sessionId}`, credits, Date.now());
      appStore.setState((state) => (state.lastRewards?.sessionId === sessionId ? { lastRewards: { ...state.lastRewards, doubled: true } } : {}));
      return result;
    },
  });
}

/** The daily gift can be claimed when today's has not been. */
export function isDailyGiftReady(giftDay: string | null, now = new Date()): boolean {
  return giftDay !== dateKeyOf(now);
}

/** One optional ad a day pays a few hint credits. */
export function watchAdForDailyGift(): Promise<RewardOutcome> {
  const dateKey = dateKeyOf(new Date());
  return watchAdFor({
    credits: DAILY_GIFT_CREDITS,
    grant: async () => {
      if (!repo) throw new Error('Saved data is unavailable.');
      // One grant id per local day: a second ad on the same day cannot pay again.
      const result = await repo.grantReward(giftGrantId(dateKey), DAILY_GIFT_CREDITS, Date.now());
      appStore.setState({ giftDay: dateKey });
      if (!result.granted) throw new Error('Gift already claimed');
      return result;
    },
  });
}

/** One optional ad opens a board theme for good and selects it. */
export function watchAdToUnlockTheme(theme: BoardTheme): Promise<RewardOutcome> {
  if (FREE_BOARD_THEMES.includes(theme)) return Promise.resolve({ kind: 'failed', reason: 'unsupported' });
  return watchAdFor({
    credits: 0,
    grant: async () => {
      if (!repo) throw new Error('Saved data is unavailable.');
      const { balance } = await repo.grantRewards([{ id: THEME_GRANT + theme, credits: 0 }], Date.now());
      appStore.setState((state) => ({ unlockedThemes: state.unlockedThemes.includes(theme) ? state.unlockedThemes : [...state.unlockedThemes, theme] }));
      updateSettings({ boardTheme: theme });
      return { granted: true, balance };
    },
  });
}

/**
 * One optional ad applies a change to a mode's saved progress (a Speed Round extension).
 * `build` returns the new progress, or null when the reward no longer applies; the new
 * progress is saved together with the ad's grant id and then handed to `onGranted`.
 */
export function watchAdForModeProgress<T>(key: string, build: () => T | null, onGranted: (next: T) => void): Promise<RewardOutcome> {
  return watchAdFor({
    credits: 0,
    grant: async (grantId) => {
      const next = build();
      if (!repo || next === null) throw new Error('Nothing to change');
      const result = await repo.grantModeReward(grantId, key, next, Date.now());
      if (result.granted) onGranted(next);
      return result;
    },
  });
}

/** One optional ad repairs yesterday's missed Daily Puzzle so the streak continues. */
export function watchAdToRepairStreak(dateKey: string): Promise<RewardOutcome> {
  return watchAdFor({
    credits: 0,
    grant: async (grantId) => {
      const { streakRepairs, streakDays: days } = appStore.getState();
      if (!repo || repairableDay(days, new Date()) !== dateKey) throw new Error('Nothing to repair');
      const next = [...streakRepairs, dateKey];
      const result = await repo.grantModeReward(grantId, STREAK_REPAIRS_KEY, next, Date.now());
      if (result.granted) appStore.setState({ streakRepairs: next, streakDays: [...days, dateKey].sort() });
      return result;
    },
  });
}

/* ----------------------------- reset and backup ---------------------------- */

function stopAllPlay() {
  for (const slot of SESSION_SLOTS) {
    const timer = saveTimers[slot];
    if (timer) clearTimeout(timer);
    delete saveTimers[slot];
  }
  clock.unload();
  miniClassicClock.unload();
}

/** Erases games, results and statistics. Hint credits and settings are kept. */
export async function resetProgress(): Promise<void> {
  if (!repo) throw new Error('Saved data is unavailable.');
  stopAllPlay();
  await repo.resetProgress();
  await loadProgress(repo);
}

export function exportBackup(): Promise<BackupData> {
  if (!repo) return Promise.reject(new Error('Saved data is unavailable.'));
  for (const slot of SESSION_SLOTS) if (appStore.getState().sessions[slot]) flushSession(slot);
  return repo.exportData(Date.now());
}

/** Replaces this device's games, results and settings with a backup file's contents. */
export async function importBackup(data: unknown): Promise<void> {
  if (!repo) throw new Error('Saved data is unavailable.');
  stopAllPlay();
  await repo.importData(data);
  await loadProgress(repo);
}

export function clearRewardOutcome() {
  rewards?.clearOutcome();
}

export function showPrivacyOptions(): Promise<void> {
  return adProvider ? adProvider.showPrivacyOptions().catch(() => undefined) : Promise.resolve();
}
