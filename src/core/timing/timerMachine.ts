/**
 * Solve timer as an explicit state machine (pure; time is passed in).
 *
 * Phases
 *   idle         free play, no attempt in progress
 *   scrambling   a scramble is being generated/applied; turns are blocked
 *   ready        scrambled, waiting for the attempt to start
 *   inspecting   spacebar mode: inspection countdown running
 *   arming       spacebar mode: Space held; release after HOLD_TO_ARM_MS starts
 *   running      attempt in progress
 *   solved       attempt finished by a manual turn that solved the cube
 *   interrupted  attempt ended without a valid solve (DNF)
 *   assisted     attempt abandoned because the solver was used
 *
 * Modes
 *   casual    the first committed manual turn starts the clock; the turn that
 *             solves the cube stops it. Both instants are turn-commit times.
 *   spacebar  hold Space ≥ 300 ms to arm, release to start; optional 15 s
 *             inspection with training thresholds mirroring current WCA
 *             practice (< 15 s ok, ≥ 15 s +2, ≥ 17 s DNF). Turning is blocked
 *             until the clock runs, and only a genuine solve stops it.
 *
 * Integrity: undo/redo during an attempt flags it `assisted` (it is recorded as
 * practice and never counts toward PB/averages); using the solver ends the
 * attempt unrecorded. Scramble playback and solver moves never reach this
 * machine as manual turns.
 */
export type TimerMode = 'casual' | 'spacebar';
export type TimerPhase =
  | 'idle'
  | 'scrambling'
  | 'ready'
  | 'inspecting'
  | 'arming'
  | 'running'
  | 'solved'
  | 'interrupted'
  | 'assisted';
export type Penalty = 'none' | '+2' | 'DNF';

/** Per-turn metric increments (see `moveMetrics` in notation.ts). */
export interface TurnMetrics {
  readonly stm: number;
  readonly htm: number;
  readonly qtm: number;
}

export const HOLD_TO_ARM_MS = 300;
export const INSPECTION_LIMIT_MS = 15_000;
export const INSPECTION_DNF_MS = 17_000;

export interface CompletedAttempt {
  readonly durationMs: number;
  readonly penalty: Penalty;
  readonly scramble: string;
  /** Slice turn metric: every layer turn counts 1 (the UI's "turns"). */
  readonly turnsSTM: number;
  readonly turnsHTM: number;
  readonly turnsQTM: number;
  readonly mode: TimerMode;
  readonly inspectionMs: number | null;
  readonly assisted: boolean;
  readonly note: 'inspection-timeout' | 'stopped-early' | null;
}

export interface TimerState {
  readonly phase: TimerPhase;
  readonly mode: TimerMode;
  readonly inspection: boolean;
  readonly scramble: string | null;
  readonly startedAt: number | null;
  readonly stoppedAt: number | null;
  readonly inspectionStartedAt: number | null;
  readonly inspectionMs: number | null;
  readonly penalty: Penalty;
  readonly holdStartedAt: number | null;
  readonly armingFrom: 'ready' | 'inspecting' | null;
  /** Swallow the key-up that belongs to the press which started inspection. */
  readonly swallowRelease: boolean;
  readonly turnsSTM: number;
  readonly turnsHTM: number;
  readonly turnsQTM: number;
  readonly assisted: boolean;
  readonly last: CompletedAttempt | null;
}

export type TimerEvent =
  | { readonly type: 'configure'; readonly mode: TimerMode; readonly inspection: boolean }
  | { readonly type: 'scrambleStarted' }
  | { readonly type: 'scrambleApplied'; readonly scramble: string }
  | { readonly type: 'scrambleFailed' }
  | { readonly type: 'manualTurn'; readonly at: number; readonly metrics: TurnMetrics; readonly solved: boolean }
  | { readonly type: 'assist'; readonly kind: 'undo' | 'redo' | 'solver' }
  | { readonly type: 'spaceDown'; readonly at: number }
  | { readonly type: 'spaceUp'; readonly at: number }
  | { readonly type: 'tick'; readonly at: number }
  | { readonly type: 'discard' };

export interface TimerOutput {
  readonly state: TimerState;
  readonly completed: CompletedAttempt | null;
}

export function createTimerState(mode: TimerMode = 'casual', inspection = false): TimerState {
  return {
    phase: 'idle',
    mode,
    inspection,
    scramble: null,
    startedAt: null,
    stoppedAt: null,
    inspectionStartedAt: null,
    inspectionMs: null,
    penalty: 'none',
    holdStartedAt: null,
    armingFrom: null,
    swallowRelease: false,
    turnsSTM: 0,
    turnsHTM: 0,
    turnsQTM: 0,
    assisted: false,
    last: null,
  };
}

export function inspectionPenalty(inspectionMs: number): Penalty {
  if (inspectionMs >= INSPECTION_DNF_MS) return 'DNF';
  if (inspectionMs >= INSPECTION_LIMIT_MS) return '+2';
  return 'none';
}

/** Attempt-scoped fields reset to their resting values. */
function cleared(state: TimerState, phase: TimerPhase): TimerState {
  return {
    ...state,
    phase,
    startedAt: null,
    stoppedAt: null,
    inspectionStartedAt: null,
    inspectionMs: null,
    penalty: 'none',
    holdStartedAt: null,
    armingFrom: null,
    swallowRelease: false,
    turnsSTM: 0,
    turnsHTM: 0,
    turnsQTM: 0,
    assisted: false,
  };
}

const ATTEMPT_PHASES: readonly TimerPhase[] = ['ready', 'inspecting', 'arming', 'running'];

export function isAttemptActive(state: TimerState): boolean {
  return ATTEMPT_PHASES.includes(state.phase);
}

/** True when the clock is actually counting. */
export function isTiming(state: TimerState): boolean {
  return state.phase === 'running';
}

/** Whether a manual turn may be accepted right now, and why not. */
export function turnPolicy(state: TimerState): { allowed: boolean; reason: string | null } {
  if (state.phase === 'scrambling') return { allowed: false, reason: 'Scrambling…' };
  if (state.mode === 'spacebar' && (state.phase === 'ready' || state.phase === 'inspecting' || state.phase === 'arming')) {
    return {
      allowed: false,
      reason: state.phase === 'inspecting' ? 'Inspecting — hold Space, release to start' : 'Hold Space and release to start the clock',
    };
  }
  return { allowed: true, reason: null };
}

/** Elapsed solve time at `now` (or the final time once stopped). */
export function elapsedMs(state: TimerState, now: number): number {
  if (state.startedAt === null) return 0;
  const end = state.stoppedAt ?? now;
  return Math.max(0, end - state.startedAt);
}

export function inspectionElapsedMs(state: TimerState, now: number): number {
  if (state.inspectionStartedAt === null) return 0;
  return Math.max(0, now - state.inspectionStartedAt);
}

function finish(state: TimerState, at: number, phase: 'solved' | 'interrupted', note: CompletedAttempt['note']): TimerOutput {
  const durationMs = state.startedAt === null ? 0 : Math.max(0, at - state.startedAt);
  const penalty: Penalty = phase === 'interrupted' ? 'DNF' : state.penalty;
  const completed: CompletedAttempt = {
    durationMs,
    penalty,
    scramble: state.scramble ?? '',
    turnsSTM: state.turnsSTM,
    turnsHTM: state.turnsHTM,
    turnsQTM: state.turnsQTM,
    mode: state.mode,
    inspectionMs: state.inspectionMs,
    assisted: state.assisted,
    note,
  };
  return {
    state: { ...state, phase, stoppedAt: at, penalty, holdStartedAt: null, armingFrom: null, last: completed },
    completed,
  };
}

function same(state: TimerState): TimerOutput {
  return { state, completed: null };
}

export function timerTransition(state: TimerState, event: TimerEvent): TimerOutput {
  switch (event.type) {
    case 'configure': {
      if (event.mode === state.mode && event.inspection === state.inspection) return same(state);
      // Changing rules mid-attempt would make the result incomparable: keep the
      // scramble but restart the attempt from "ready".
      const base = { ...state, mode: event.mode, inspection: event.inspection };
      if (isAttemptActive(state)) return same(cleared(base, state.phase === 'running' ? 'idle' : 'ready'));
      return same(base);
    }

    case 'scrambleStarted':
      return same({ ...cleared(state, 'scrambling'), scramble: null });

    case 'scrambleApplied':
      return same({ ...cleared(state, 'ready'), scramble: event.scramble });

    case 'scrambleFailed':
      return same({ ...cleared(state, 'idle'), scramble: null });

    case 'manualTurn': {
      const m = event.metrics;
      if (state.phase === 'running') {
        const next = {
          ...state,
          turnsSTM: state.turnsSTM + m.stm,
          turnsHTM: state.turnsHTM + m.htm,
          turnsQTM: state.turnsQTM + m.qtm,
        };
        return event.solved ? finish(next, event.at, 'solved', null) : same(next);
      }
      if (state.phase === 'ready' && state.mode === 'casual') {
        const started: TimerState = {
          ...state,
          phase: 'running',
          startedAt: event.at,
          turnsSTM: m.stm,
          turnsHTM: m.htm,
          turnsQTM: m.qtm,
        };
        return event.solved ? finish(started, event.at, 'solved', null) : same(started);
      }
      if (state.phase === 'solved' || state.phase === 'interrupted' || state.phase === 'assisted') {
        return same(cleared(state, 'idle'));
      }
      return same(state);
    }

    case 'assist': {
      if (event.kind === 'solver') {
        if (isAttemptActive(state)) return same({ ...cleared(state, 'assisted') });
        return same(state);
      }
      if (state.phase === 'running') return same({ ...state, assisted: true });
      return same(state);
    }

    case 'spaceDown': {
      if (state.mode !== 'spacebar') return same(state);
      if (state.phase === 'ready') {
        if (state.inspection) {
          return same({ ...state, phase: 'inspecting', inspectionStartedAt: event.at, swallowRelease: true });
        }
        return same({ ...state, phase: 'arming', holdStartedAt: event.at, armingFrom: 'ready' });
      }
      if (state.phase === 'inspecting') {
        return same({ ...state, phase: 'arming', holdStartedAt: event.at, armingFrom: 'inspecting', swallowRelease: false });
      }
      if (state.phase === 'running') {
        // Stopping the clock by hand can never produce a valid single.
        return finish(state, event.at, 'interrupted', 'stopped-early');
      }
      return same(state);
    }

    case 'spaceUp': {
      if (state.mode !== 'spacebar') return same(state);
      if (state.phase === 'inspecting' && state.swallowRelease) return same({ ...state, swallowRelease: false });
      if (state.phase !== 'arming' || state.holdStartedAt === null) return same(state);
      const held = event.at - state.holdStartedAt;
      if (held < HOLD_TO_ARM_MS) {
        return same({ ...state, phase: state.armingFrom ?? 'ready', holdStartedAt: null, armingFrom: null });
      }
      let inspectionMs: number | null = null;
      let penalty: Penalty = 'none';
      if (state.armingFrom === 'inspecting' && state.inspectionStartedAt !== null) {
        inspectionMs = event.at - state.inspectionStartedAt;
        penalty = inspectionPenalty(inspectionMs);
      }
      const running: TimerState = {
        ...state,
        phase: 'running',
        startedAt: event.at,
        inspectionMs,
        penalty,
        holdStartedAt: null,
        armingFrom: null,
        turnsSTM: 0,
        turnsHTM: 0,
        turnsQTM: 0,
      };
      if (penalty === 'DNF') return finish(running, event.at, 'interrupted', 'inspection-timeout');
      return same(running);
    }

    case 'tick': {
      const inspecting = state.phase === 'inspecting' || (state.phase === 'arming' && state.armingFrom === 'inspecting');
      if (inspecting && state.inspectionStartedAt !== null && event.at - state.inspectionStartedAt >= INSPECTION_DNF_MS) {
        const timedOut: TimerState = {
          ...state,
          startedAt: event.at,
          inspectionMs: event.at - state.inspectionStartedAt,
        };
        return finish(timedOut, event.at, 'interrupted', 'inspection-timeout');
      }
      return same(state);
    }

    case 'discard':
      return same(cleared(state, 'idle'));
  }
}
