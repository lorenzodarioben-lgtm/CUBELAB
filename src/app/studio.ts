/**
 * The studio controller: orchestrates the engine, timer, scramble generation,
 * solver playback, history and settings. Framework-agnostic (a vanilla Zustand
 * store), so the whole product flow is unit-testable without React or WebGL.
 *
 * Integrity rules enforced here:
 *  - Only `manual`/`undo`/`redo` commits ever reach the timer as turns.
 *  - Async results (scramble, solution) carry a request id and the engine
 *    version they were computed for; anything stale is dropped, never applied.
 *  - Solver playback re-checks the engine version before every move, so a
 *    newer user action can never be overwritten.
 */
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { KPuzzle } from 'cubing/kpuzzle';
import { CubeEngine } from '../core/engine/cubeEngine';
import type { CommitEvent, EngineEvent, MoveSource } from '../core/engine/cubeEngine';
import { createSolvedState, isSolved, stateFacelets } from '../core/puzzle/cubeState';
import type { CubeState } from '../core/puzzle/cubeState';
import { formatAlg, invertMove, moveMetrics, parseAlg } from '../core/puzzle/notation';
import type { Move } from '../core/puzzle/notation';
import { generateScramble } from '../core/scramble/scrambler';
import type { ScrambleSource } from '../core/scramble/scrambler';
import { SolverError, solveState } from '../core/solver/solver';
import { createTimerState, isAttemptActive, timerTransition, turnPolicy } from '../core/timing/timerMachine';
import type { CompletedAttempt, TimerEvent, TimerState } from '../core/timing/timerMachine';
import { DEFAULT_SETTINGS, PLAYBACK_DURATION_MS, SCRAMBLE_DURATION_MS, TURN_DURATION_MS } from '../core/persistence/settings';
import type { Settings } from '../core/persistence/settings';
import { HISTORY_LIMIT, loadCube, loadHistory, loadSettings, saveCube, saveHistory, saveSettings } from '../core/persistence/storage';
import type { KeyValueStore, SolveRecord } from '../core/persistence/storage';
import { silentPlayer } from '../core/audio/sound';
import type { SoundPlayer } from '../core/audio/sound';

export type ScrambleStatus = 'idle' | 'generating' | 'applying' | 'applied' | 'error';
export type SolverStatus = 'idle' | 'solving' | 'playing' | 'paused' | 'done' | 'stale' | 'error';

export interface ScrambleInfo {
  readonly status: ScrambleStatus;
  readonly text: string | null;
  readonly moves: readonly Move[];
  /** How many scramble moves have been committed (for notation highlighting). */
  readonly applied: number;
  readonly origin: 'random' | 'shared' | 'restored' | null;
  readonly error: string | null;
}

export interface SolverInfo {
  readonly status: SolverStatus;
  readonly moves: readonly Move[];
  /** Number of solution moves currently applied to the cube. */
  readonly cursor: number;
  readonly error: string | null;
  /** True while a single step is animating (steps are serialised). */
  readonly stepping: boolean;
  /** First solve request boots the worker and its tables. */
  readonly warm: boolean;
}

export interface Notice {
  readonly id: number;
  readonly tone: 'info' | 'success' | 'warn' | 'error';
  readonly text: string;
}

export interface Celebration {
  readonly id: number;
  readonly kind: 'timed' | 'free' | 'auto';
}

export interface StudioState {
  readonly version: number;
  readonly facelets: string;
  readonly solved: boolean;
  readonly busy: boolean;
  readonly dragging: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly lastMove: { readonly move: Move; readonly source: MoveSource; readonly id: number } | null;
  /**
   * The user's own turns since the last scramble/reset (newest last, capped).
   * Undo pops, redo pushes back, so the list always reflects the cube.
   */
  readonly moveLog: readonly Move[];
  /** Total user turns in the current log (STM), including any beyond the cap. */
  readonly moveCount: number;
  readonly timer: TimerState;
  readonly scramble: ScrambleInfo;
  readonly solver: SolverInfo;
  readonly history: readonly SolveRecord[];
  readonly settings: Settings;
  readonly systemReducedMotion: boolean;
  readonly notice: Notice | null;
  readonly hint: { readonly id: number; readonly text: string } | null;
  readonly announcement: string;
  readonly celebration: Celebration | null;
  /** Count of entries dropped from corrupt storage at startup (reported once). */
  readonly droppedRecords: number;
}

export interface StudioDeps {
  readonly kpuzzle: KPuzzle;
  readonly storage: KeyValueStore;
  readonly now?: () => number;
  readonly wallClock?: () => number;
  readonly scheduleFrame?: (callback: () => void) => void;
  readonly scrambleSource?: ScrambleSource;
  readonly solve?: (state: CubeState) => Promise<Move[]>;
  readonly sound?: SoundPlayer;
  readonly newId?: () => string;
  /** Overrides the persisted cube (tests, shared links). */
  readonly initialState?: CubeState;
  readonly persistDelayMs?: number;
}

export type ConfirmableResult = 'done' | 'confirm' | 'blocked';

interface PlaybackSession {
  readonly id: number;
  readonly moves: readonly Move[];
  readonly startState: CubeState;
  cursor: number;
  expectedVersion: number;
  inFlight: 'forward' | 'back' | null;
}

const MOVE_LOG_LIMIT = 400;

const IDLE_SOLVER: SolverInfo = { status: 'idle', moves: [], cursor: 0, error: null, stepping: false, warm: false };
const IDLE_SCRAMBLE: ScrambleInfo = { status: 'idle', text: null, moves: [], applied: 0, origin: null, error: null };

export class Studio {
  readonly engine: CubeEngine;
  readonly store: StoreApi<StudioState>;
  readonly kpuzzle: KPuzzle;

  readonly #deps: StudioDeps;
  readonly #now: () => number;
  readonly #wallClock: () => number;
  readonly #sound: SoundPlayer;
  readonly #solve: (state: CubeState) => Promise<Move[]>;
  #scrambleRequest = 0;
  #scrambleJob: { id: number; total: number; applied: number; text: string; expected: CubeState['pattern'] } | null = null;
  #solveRequest = 0;
  #session: PlaybackSession | null = null;
  #noticeId = 0;
  #hintId = 0;
  #moveId = 0;
  #celebrationId = 0;
  #inspectionTicker: ReturnType<typeof setInterval> | null = null;
  #persistTimer: ReturnType<typeof setTimeout> | null = null;
  #solverWarm = false;
  #unsubscribe: () => void;

  constructor(deps: StudioDeps) {
    this.#deps = deps;
    this.kpuzzle = deps.kpuzzle;
    this.#now = deps.now ?? (() => performance.now());
    this.#wallClock = deps.wallClock ?? (() => Date.now());
    this.#sound = deps.sound ?? silentPlayer;
    this.#solve = deps.solve ?? ((state) => solveState(state));

    const settings = loadSettings(deps.storage);
    const { records, dropped } = loadHistory(deps.storage);
    const snapshot = deps.initialState ? null : loadCube(deps.storage, deps.kpuzzle);
    const initial = deps.initialState ?? snapshot?.state ?? createSolvedState(deps.kpuzzle);

    this.engine = new CubeEngine(initial, {
      now: this.#now,
      ...(deps.scheduleFrame ? { scheduleFrame: deps.scheduleFrame } : {}),
    });
    this.#sound.setEnabled(settings.sound);

    const scramble: ScrambleInfo =
      snapshot?.scramble && !isSolved(initial)
        ? { ...IDLE_SCRAMBLE, status: 'applied', text: snapshot.scramble, moves: parseAlg(snapshot.scramble), origin: 'restored' }
        : IDLE_SCRAMBLE;

    this.store = createStore<StudioState>(() => ({
      version: this.engine.version,
      facelets: stateFacelets(initial),
      solved: isSolved(initial),
      busy: false,
      dragging: false,
      canUndo: false,
      canRedo: false,
      lastMove: null,
      moveLog: [],
      moveCount: 0,
      timer: createTimerState(settings.timerMode, settings.inspection),
      scramble,
      solver: IDLE_SOLVER,
      history: records,
      settings,
      systemReducedMotion: false,
      notice: dropped > 0 ? { id: ++this.#noticeId, tone: 'warn', text: `${dropped} damaged history entr${dropped === 1 ? 'y was' : 'ies were'} skipped (a backup was kept).` } : null,
      hint: null,
      announcement: '',
      celebration: null,
      droppedRecords: dropped,
    }));

    this.#unsubscribe = this.engine.subscribe((event) => this.#onEngineEvent(event));
  }

  dispose(): void {
    this.#unsubscribe();
    this.engine.dispose();
    if (this.#inspectionTicker) clearInterval(this.#inspectionTicker);
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = null;
    }
  }

  get state(): StudioState {
    return this.store.getState();
  }

  // ── Derived helpers ────────────────────────────────────────────────────

  reducedMotion(): boolean {
    const { settings, systemReducedMotion } = this.state;
    return settings.motion === 'reduce' || (settings.motion === 'system' && systemReducedMotion);
  }

  turnDuration(move?: Move): number {
    if (this.reducedMotion()) return 0;
    const base = TURN_DURATION_MS[this.state.settings.turnSpeed];
    return move && move.turns === 2 ? base * 1.45 : base;
  }

  /** Quarter-turn duration for drag continuations. */
  dragQuarterDuration(): number {
    return this.reducedMotion() ? 0 : Math.max(90, TURN_DURATION_MS[this.state.settings.turnSpeed] || 0);
  }

  #playbackDuration(move: Move): number {
    if (this.reducedMotion()) return 0;
    const base = PLAYBACK_DURATION_MS[this.state.settings.playbackSpeed];
    return move.turns === 2 ? base * 1.35 : base;
  }

  /** Whether the user may turn the cube right now (and why not). */
  manualTurnPolicy(): { allowed: boolean; reason: string | null } {
    const s = this.state;
    if (s.scramble.status === 'generating' || s.scramble.status === 'applying') return { allowed: false, reason: 'Scrambling…' };
    if (s.solver.status === 'solving') return { allowed: false, reason: 'Computing a solution…' };
    if (s.solver.status === 'playing') return { allowed: false, reason: 'Pause or stop the solution to turn by hand' };
    return turnPolicy(s.timer);
  }

  attemptInProgress(): boolean {
    const phase = this.state.timer.phase;
    return phase === 'running' || phase === 'inspecting' || phase === 'arming';
  }

  // ── Manual input ───────────────────────────────────────────────────────

  turn(move: Move): boolean {
    const policy = this.manualTurnPolicy();
    if (!policy.allowed) {
      this.hint(policy.reason ?? 'Turning is paused right now');
      return false;
    }
    const accepted = this.engine.enqueue(move, { source: 'manual', durationMs: this.turnDuration(move) });
    if (!accepted) this.hint('Slow down — a few turns are still queued');
    return accepted;
  }

  /** Called by the pointer layer before it starts a twist preview. */
  beginTwist(): boolean {
    const policy = this.manualTurnPolicy();
    if (!policy.allowed) {
      this.hint(policy.reason ?? 'Turning is paused right now');
      return false;
    }
    return this.engine.beginDrag();
  }

  undo(): boolean {
    const policy = this.manualTurnPolicy();
    if (!policy.allowed) {
      this.hint(policy.reason ?? 'Undo is unavailable right now');
      return false;
    }
    if (!this.engine.requestUndo(this.turnDuration())) {
      this.hint('Nothing to undo');
      return false;
    }
    return true;
  }

  redo(): boolean {
    const policy = this.manualTurnPolicy();
    if (!policy.allowed) {
      this.hint(policy.reason ?? 'Redo is unavailable right now');
      return false;
    }
    if (!this.engine.requestRedo(this.turnDuration())) {
      this.hint('Nothing to redo');
      return false;
    }
    return true;
  }

  // ── Scramble ───────────────────────────────────────────────────────────

  async newScramble(options: { force?: boolean; text?: string } = {}): Promise<ConfirmableResult> {
    if (this.attemptInProgress() && !options.force) return 'confirm';
    const id = ++this.#scrambleRequest;
    this.#clearSession();
    this.engine.cancelPending();
    this.#timer({ type: 'scrambleStarted' });
    this.#set({ scramble: { ...IDLE_SCRAMBLE, status: 'generating' } });
    this.#announce('Generating a random-state scramble');

    let text: string;
    let moves: readonly Move[];
    try {
      if (options.text !== undefined) {
        moves = parseAlg(options.text);
        if (moves.length === 0 || moves.length > 60) throw new Error('Shared scramble must contain 1–60 moves.');
        text = formatAlg(moves);
      } else {
        const generated = await generateScramble(this.kpuzzle, this.#deps.scrambleSource);
        text = generated.text;
        moves = generated.moves;
      }
    } catch (error) {
      if (id !== this.#scrambleRequest) return 'done';
      this.#timer({ type: 'scrambleFailed' });
      const message = error instanceof Error && options.text !== undefined ? error.message : 'Scramble generation failed. Please try again.';
      this.#set({ scramble: { ...IDLE_SCRAMBLE, status: 'error', error: message } });
      this.#notify('error', message);
      return 'done';
    }
    if (id !== this.#scrambleRequest) return 'done'; // superseded by reset / another scramble

    const solved = createSolvedState(this.kpuzzle);
    this.engine.replaceState(solved, 'scramble');
    this.#scrambleJob = {
      id,
      total: moves.length,
      applied: 0,
      text,
      expected: this.kpuzzle.defaultPattern().applyAlg(text),
    };
    this.#set({
      scramble: { status: 'applying', text, moves, applied: 0, origin: options.text !== undefined ? 'shared' : 'random', error: null },
    });
    const instant = this.state.settings.scrambleStyle === 'instant' || this.reducedMotion();
    if (instant) {
      this.engine.applyInstant(moves, 'scramble', `scramble:${id}`);
    } else {
      this.engine.enqueueMany(moves, { source: 'scramble', durationMs: SCRAMBLE_DURATION_MS, tag: `scramble:${id}` });
    }
    return 'done';
  }

  /** Completes an animating scramble immediately. */
  skipScrambleAnimation(): void {
    if (this.state.scramble.status === 'applying') this.engine.fastForward();
  }

  // ── Reset / attempt control ────────────────────────────────────────────

  reset(options: { force?: boolean } = {}): ConfirmableResult {
    if (this.attemptInProgress() && !options.force) return 'confirm';
    this.#scrambleRequest++;
    this.#scrambleJob = null;
    this.#clearSession();
    this.engine.replaceState(createSolvedState(this.kpuzzle), 'reset');
    this.#timer({ type: 'discard' });
    this.#set({ scramble: IDLE_SCRAMBLE });
    this.#announce('Cube reset to solved');
    return 'done';
  }

  /** Abandons the current attempt but keeps the cube as it is (free play). */
  discardAttempt(): void {
    if (!isAttemptActive(this.state.timer)) return;
    this.#timer({ type: 'discard' });
    this.#announce('Attempt discarded — free play');
  }

  spaceDown(at: number): void {
    const before = this.state.timer;
    if (before.mode !== 'spacebar') return;
    if (before.phase === 'idle' || before.phase === 'solved' || before.phase === 'interrupted' || before.phase === 'assisted') {
      this.hint('Generate a scramble first (N)');
      return;
    }
    this.#timer({ type: 'spaceDown', at });
  }

  spaceUp(at: number): void {
    if (this.state.timer.mode !== 'spacebar') return;
    const before = this.state.timer.phase;
    this.#timer({ type: 'spaceUp', at });
    const after: TimerState['phase'] = this.store.getState().timer.phase;
    if (before === 'arming' && after === 'running') this.#sound.arm();
  }

  /** Releases a held Space without starting (pointer cancelled, Esc). */
  cancelArming(): void {
    const t = this.state.timer;
    if (t.phase === 'arming' && t.holdStartedAt !== null) this.#timer({ type: 'spaceUp', at: t.holdStartedAt });
  }

  // ── Auto solve & playback ──────────────────────────────────────────────

  async autoSolve(): Promise<void> {
    const s = this.state;
    if (s.scramble.status === 'generating' || s.scramble.status === 'applying') {
      this.hint('Wait for the scramble to finish');
      return;
    }
    if (s.solver.status === 'solving') return;
    if (isAttemptActive(s.timer)) this.#timer({ type: 'assist', kind: 'solver' });
    this.#clearSession();
    const id = ++this.#solveRequest;
    this.#set({ solver: { ...IDLE_SOLVER, status: 'solving', warm: this.#solverWarm } });
    this.#announce('Computing a solution for the current state');

    await this.engine.whenIdle();
    if (id !== this.#solveRequest) return;
    const captured = this.engine.state;
    const version = this.engine.version;
    if (isSolved(captured)) {
      this.#set({ solver: IDLE_SOLVER });
      this.#notify('info', 'The cube is already solved.');
      return;
    }

    let moves: Move[];
    try {
      moves = await this.#solve(captured);
      this.#solverWarm = true;
    } catch (error) {
      if (id !== this.#solveRequest) return;
      const message =
        error instanceof SolverError && error.code === 'timeout'
          ? 'The solver timed out. Please try again.'
          : error instanceof SolverError && error.code === 'invalid-solution'
            ? 'The solver returned an invalid solution, so it was not played.'
            : 'The solver could not run. Please try again.';
      this.#set({ solver: { ...IDLE_SOLVER, status: 'error', error: message, warm: this.#solverWarm } });
      this.#notify('error', message);
      return;
    }
    if (id !== this.#solveRequest) return; // cancelled by reset / scramble / stop
    if (this.engine.version !== version) {
      this.#set({ solver: { ...IDLE_SOLVER, status: 'stale', warm: true } });
      this.#notify('warn', 'The cube changed while solving — solve again for the new state.');
      return;
    }
    this.#session = { id, moves, startState: captured, cursor: 0, expectedVersion: version, inFlight: null };
    this.#set({ solver: { status: 'playing', moves, cursor: 0, error: null, stepping: false, warm: true } });
    this.#announce(`Solution found: ${moves.length} moves. Playing.`);
    this.#advance();
  }

  playbackPlay(): void {
    const session = this.#session;
    const status = this.state.solver.status;
    if (!session) return;
    if (status === 'done') {
      this.playbackReplay();
      return;
    }
    if (status !== 'paused') return;
    if (!this.#sessionCurrent()) return;
    this.#setSolver({ status: 'playing' });
    this.#advance();
  }

  playbackPause(): void {
    if (this.state.solver.status === 'playing') this.#setSolver({ status: 'paused' });
  }

  playbackStep(direction: 1 | -1): void {
    const session = this.#session;
    const status = this.state.solver.status;
    if (!session || session.inFlight) return;
    if (status !== 'paused' && status !== 'done') return;
    if (!this.#sessionCurrent()) return;
    if (direction === 1 && session.cursor >= session.moves.length) return;
    if (direction === -1 && session.cursor <= 0) return;
    if (status !== 'paused') this.#setSolver({ status: 'paused' });
    const move = direction === 1 ? session.moves[session.cursor]! : invertMove(session.moves[session.cursor - 1]!);
    session.inFlight = direction === 1 ? 'forward' : 'back';
    this.#setSolver({ stepping: true });
    this.engine.enqueue(move, { source: 'solver', durationMs: this.#playbackDuration(move), tag: `solve:${session.id}` });
  }

  /** Restores the captured start state and plays the solution from the beginning. */
  playbackReplay(): void {
    const session = this.#session;
    if (!session) return;
    if (this.attemptInProgress()) this.#timer({ type: 'assist', kind: 'solver' });
    this.engine.replaceState(session.startState, 'replay');
    session.cursor = 0;
    session.inFlight = null;
    session.expectedVersion = this.engine.version;
    this.#setSolver({ status: 'playing', cursor: 0, stepping: false });
    this.#advance();
  }

  /** Stops playback; the cube stays in its current valid (partially solved) state. */
  playbackStop(): void {
    const session = this.#session;
    if (!session) {
      if (this.state.solver.status !== 'idle') {
        this.#solveRequest++;
        this.#set({ solver: { ...IDLE_SOLVER, warm: this.#solverWarm } });
      }
      return;
    }
    this.engine.cancelPending((source) => source === 'solver');
    this.#solveRequest++;
    this.#session = null;
    this.#set({ solver: { ...IDLE_SOLVER, warm: true } });
    this.#announce('Solution playback stopped');
  }

  dismissSolver(): void {
    const status = this.state.solver.status;
    if (status === 'playing' || status === 'solving') return;
    this.#session = null;
    this.#set({ solver: { ...IDLE_SOLVER, warm: this.#solverWarm } });
  }

  // ── Settings & history ─────────────────────────────────────────────────

  updateSettings(patch: Partial<Settings>): void {
    const settings = { ...this.state.settings, ...patch };
    this.#set({ settings });
    saveSettings(this.#deps.storage, settings);
    if (patch.sound !== undefined) this.#sound.setEnabled(patch.sound);
    if (patch.timerMode !== undefined || patch.inspection !== undefined) {
      this.#timer({ type: 'configure', mode: settings.timerMode, inspection: settings.inspection });
    }
  }

  resetSettings(): void {
    this.updateSettings({ ...DEFAULT_SETTINGS });
    this.#notify('info', 'Settings restored to defaults.');
  }

  setSystemReducedMotion(reduced: boolean): void {
    if (this.state.systemReducedMotion !== reduced) this.#set({ systemReducedMotion: reduced });
  }

  deleteSolve(id: string): void {
    const history = this.state.history.filter((r) => r.id !== id);
    this.#set({ history });
    saveHistory(this.#deps.storage, history);
  }

  clearHistory(): void {
    this.#set({ history: [] });
    saveHistory(this.#deps.storage, []);
    this.#notify('info', 'Solve history cleared.');
  }

  // ── Feedback ───────────────────────────────────────────────────────────

  hint(text: string): void {
    this.#set({ hint: { id: ++this.#hintId, text } });
  }

  notify(tone: Notice['tone'], text: string): void {
    this.#notify(tone, text);
  }

  dismissNotice(id: number): void {
    if (this.state.notice?.id === id) this.#set({ notice: null });
  }

  /** Page visibility: pause playback and stop animating while hidden. */
  setPageHidden(hidden: boolean): void {
    if (hidden) {
      this.playbackPause();
      this.engine.setInstantMode(true);
      this.flushPersistence();
    } else {
      this.engine.setInstantMode(false);
    }
  }

  flushPersistence(): void {
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = null;
    }
    saveCube(this.#deps.storage, this.engine.state, this.state.scramble.status === 'applied' ? this.state.scramble.text : null);
  }

  // ── Internals ──────────────────────────────────────────────────────────

  #set(partial: Partial<StudioState>): void {
    this.store.setState(partial);
  }

  #setSolver(partial: Partial<SolverInfo>): void {
    this.#set({ solver: { ...this.state.solver, ...partial } });
  }

  #notify(tone: Notice['tone'], text: string): void {
    this.#set({ notice: { id: ++this.#noticeId, tone, text } });
    if (tone === 'error' || tone === 'warn') this.#announce(text);
  }

  #announce(text: string): void {
    this.#set({ announcement: text });
  }

  #celebrate(kind: Celebration['kind']): void {
    this.#set({ celebration: { id: ++this.#celebrationId, kind } });
    this.#sound.solved();
  }

  #timer(event: TimerEvent): void {
    const out = timerTransition(this.state.timer, event);
    if (out.state !== this.state.timer) this.#set({ timer: out.state });
    if (out.completed) this.#record(out.completed);
    this.#syncInspectionTicker();
  }

  #record(attempt: CompletedAttempt): void {
    const id = this.#deps.newId?.() ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    const record: SolveRecord = { id, timestamp: this.#wallClock(), ...attempt };
    const history = [...this.state.history, record].slice(-HISTORY_LIMIT);
    this.#set({ history });
    saveHistory(this.#deps.storage, history);
  }

  #syncInspectionTicker(): void {
    const t = this.state.timer;
    const inspecting = t.phase === 'inspecting' || (t.phase === 'arming' && t.armingFrom === 'inspecting');
    if (inspecting && !this.#inspectionTicker) {
      this.#inspectionTicker = setInterval(() => this.#timer({ type: 'tick', at: this.#now() }), 100);
    } else if (!inspecting && this.#inspectionTicker) {
      clearInterval(this.#inspectionTicker);
      this.#inspectionTicker = null;
    }
  }

  #clearSession(): void {
    this.#solveRequest++;
    if (this.#session) this.engine.cancelPending((source) => source === 'solver');
    this.#session = null;
    if (this.state.solver.status !== 'idle') this.#set({ solver: { ...IDLE_SOLVER, warm: this.#solverWarm } });
  }

  /** Session still matches the cube? Otherwise mark it stale. */
  #sessionCurrent(): boolean {
    const session = this.#session;
    if (!session) return false;
    if (this.engine.version === session.expectedVersion) return true;
    this.#session = null;
    this.#set({ solver: { ...IDLE_SOLVER, status: 'stale', warm: true } });
    return false;
  }

  #advance(): void {
    const session = this.#session;
    if (!session || session.inFlight || this.state.solver.status !== 'playing') return;
    if (!this.#sessionCurrent()) return;
    if (session.cursor >= session.moves.length) {
      this.#finishPlayback();
      return;
    }
    const move = session.moves[session.cursor]!;
    session.inFlight = 'forward';
    this.engine.enqueue(move, { source: 'solver', durationMs: this.#playbackDuration(move), tag: `solve:${session.id}` });
  }

  #finishPlayback(): void {
    const session = this.#session;
    if (!session) return;
    if (isSolved(this.engine.state)) {
      this.#setSolver({ status: 'done', cursor: session.cursor, stepping: false });
      this.#announce(`Auto Solve complete — solved in ${session.moves.length} moves`);
      this.#celebrate('auto');
    } else {
      this.#session = null;
      this.#set({ solver: { ...IDLE_SOLVER, status: 'error', error: 'Playback ended without a solved cube.', warm: true } });
      this.#notify('error', 'Playback ended without a solved cube.');
    }
  }

  #onEngineEvent(event: EngineEvent): void {
    if (event.type === 'commit') this.#onCommit(event);
    else if (event.type === 'replace') {
      this.#set({ moveLog: [], moveCount: 0 });
      this.#syncCube(false);
    } else this.#syncFlags();
  }

  #logUserMove(move: Move, source: MoveSource): void {
    const { moveLog, moveCount } = this.state;
    if (source === 'undo') {
      this.#set({ moveLog: moveLog.slice(0, -1), moveCount: Math.max(0, moveCount - 1) });
      return;
    }
    const next = [...moveLog, move];
    this.#set({ moveLog: next.length > MOVE_LOG_LIMIT ? next.slice(-MOVE_LOG_LIMIT) : next, moveCount: moveCount + 1 });
  }

  #syncFlags(): void {
    const busy = this.engine.isBusy();
    const dragging = this.engine.isDragging();
    const canUndo = this.engine.canUndo();
    const canRedo = this.engine.canRedo();
    const s = this.state;
    if (s.busy !== busy || s.dragging !== dragging || s.canUndo !== canUndo || s.canRedo !== canRedo) {
      this.#set({ busy, dragging, canUndo, canRedo });
    }
  }

  /** `solved` may be supplied by the caller (a commit event already computed it). */
  #syncCube(schedulePersist = true, solved?: boolean): void {
    const state = this.engine.state;
    this.#set({ version: this.engine.version, facelets: stateFacelets(state), solved: solved ?? isSolved(state) });
    this.#syncFlags();
    this.#schedulePersist(schedulePersist);
  }

  #schedulePersist(debounced: boolean): void {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    const delay = debounced ? (this.#deps.persistDelayMs ?? 400) : 0;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      saveCube(this.#deps.storage, this.engine.state, this.state.scramble.status === 'applied' ? this.state.scramble.text : null);
    }, delay);
  }

  #onCommit(event: CommitEvent): void {
    // The store still holds the pre-commit flag; the engine computed the new one.
    const wasSolved = this.state.solved;
    this.#syncCube(true, event.solved);
    this.#set({ lastMove: { move: event.move, source: event.source, id: ++this.#moveId } });

    switch (event.source) {
      case 'manual':
      case 'undo':
      case 'redo': {
        this.#sound.turn('manual');
        if (event.source !== 'manual') this.#timer({ type: 'assist', kind: event.source });
        const phaseBefore = this.state.timer.phase;
        this.#logUserMove(event.move, event.source);
        this.#timer({ type: 'manualTurn', at: event.at, metrics: moveMetrics(event.move), solved: event.solved });
        const timedSolve = phaseBefore === 'running' && this.state.timer.phase === 'solved';
        if (timedSolve) {
          const last = this.state.timer.last;
          this.#announce(last ? `Solved${last.assisted ? ' (assisted)' : ''} — ${(last.durationMs / 1000).toFixed(2)} seconds` : 'Solved');
          this.#celebrate('timed');
        } else if (event.solved && !wasSolved) {
          this.#announce('Cube solved');
          this.#celebrate('free');
        }
        // A user change invalidates any paused/stopped solution.
        const status = this.state.solver.status;
        if (status === 'paused' || status === 'stale') {
          this.#session = null;
          this.#set({ solver: { ...IDLE_SOLVER, status: 'stale', warm: true } });
        } else if (status === 'done' || status === 'error') {
          this.#session = null;
          this.#set({ solver: { ...IDLE_SOLVER, warm: this.#solverWarm } });
        }
        break;
      }

      case 'scramble': {
        const job = this.#scrambleJob;
        if (!job || event.tag !== `scramble:${job.id}`) break;
        job.applied++;
        this.#set({ scramble: { ...this.state.scramble, applied: job.applied } });
        if (job.applied === job.total) {
          this.#scrambleJob = null;
          if (!this.engine.state.pattern.isIdentical(job.expected)) {
            this.#timer({ type: 'scrambleFailed' });
            this.#set({ scramble: { ...this.state.scramble, status: 'error', error: 'Scramble verification failed.' } });
            this.#notify('error', 'Scramble verification failed — the cube was not changed as expected.');
            break;
          }
          this.#set({ scramble: { ...this.state.scramble, status: 'applied' } });
          this.#timer({ type: 'scrambleApplied', scramble: job.text });
          this.#announce(
            this.state.timer.mode === 'spacebar'
              ? 'Scramble applied. Hold Space and release to start the timer.'
              : 'Scramble applied. Turn any face to start the timer.',
          );
          this.#schedulePersist(false);
        }
        break;
      }

      case 'solver': {
        this.#sound.turn('auto');
        // Automated moves reset the user's log (the engine clears undo history the same way).
        if (this.state.moveCount > 0) this.#set({ moveLog: [], moveCount: 0 });
        const session = this.#session;
        if (!session || event.tag !== `solve:${session.id}` || !session.inFlight) break;
        session.cursor += session.inFlight === 'forward' ? 1 : -1;
        session.inFlight = null;
        session.expectedVersion = event.version;
        this.#setSolver({ cursor: session.cursor, stepping: false });
        if (this.state.solver.status === 'playing') this.#advance();
        else if (session.cursor === session.moves.length && isSolved(this.engine.state)) this.#finishPlayback();
        break;
      }
    }
  }
}

export function createStudio(deps: StudioDeps): Studio {
  return new Studio(deps);
}
