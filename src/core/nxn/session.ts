import { applyNxMove, applyNxMoves, createNxState, invertNxMove, isNxSolved } from './model';
import type { NxMove, NxState } from './model';
import type { NxScramble } from './scramble';
import { effectiveMs } from '../stats/stats';
import type { Penalty } from '../timing/timerMachine';

export interface NxSolve {
  readonly id: string;
  readonly at: number;
  readonly durationMs: number;
  readonly scramble: string;
  readonly moves: number;
  /** Undo or redo was used while timing. Practice solves do not count as PBs. */
  readonly assisted: boolean;
  readonly penalty: Penalty;
  readonly source: 'virtual' | 'manual';
}

export interface NxSession {
  readonly cube: NxState;
  readonly scramble: string | null;
  readonly phase: 'idle' | 'ready' | 'running' | 'solved';
  readonly startedAt: number | null;
  readonly lastDurationMs: number | null;
  readonly moves: readonly NxMove[];
  readonly undo: readonly NxMove[];
  readonly redo: readonly NxMove[];
  readonly assisted: boolean;
  readonly solves: readonly NxSolve[];
}

export function createNxSession(size: number, solves: readonly NxSolve[] = []): NxSession {
  return {
    cube: createNxState(size), scramble: null, phase: 'idle', startedAt: null,
    lastDurationMs: null, moves: [], undo: [], redo: [], assisted: false, solves,
  };
}

export function scrambleNxSession(session: NxSession, scramble: NxScramble): NxSession {
  const cube = applyNxMoves(createNxState(session.cube.size), scramble.moves);
  if (isNxSolved(cube)) throw new Error('The scramble leaves the cube solved.');
  return {
    ...session, cube, scramble: scramble.text, phase: 'ready', startedAt: null,
    lastDurationMs: null, moves: [], undo: [], redo: [], assisted: false,
  };
}

export function resetNxSession(session: NxSession): NxSession {
  return { ...createNxSession(session.cube.size, session.solves) };
}

function finishIfSolved(session: NxSession, at: number, wallClock: number, id: string): NxSession {
  if (session.phase !== 'running' || !isNxSolved(session.cube) || session.startedAt === null) return session;
  const durationMs = Math.max(0, at - session.startedAt);
  const record: NxSolve = {
    id, at: wallClock, durationMs, scramble: session.scramble ?? '',
    moves: session.moves.length, assisted: session.assisted, penalty: 'none', source: 'virtual',
  };
  return {
    ...session, phase: 'solved', startedAt: null, lastDurationMs: durationMs,
    solves: [...session.solves, record].slice(-500),
  };
}

export function turnNxSession(session: NxSession, move: NxMove, at: number, wallClock: number, id: string): NxSession {
  const next: NxSession = {
    ...session,
    cube: applyNxMove(session.cube, move),
    phase: session.phase === 'ready' ? 'running' : session.phase === 'solved' ? 'idle' : session.phase,
    startedAt: session.phase === 'ready' ? at : session.startedAt,
    moves: [...session.moves, move],
    undo: [...session.undo, move],
    redo: [],
  };
  return finishIfSolved(next, at, wallClock, id);
}

export function undoNxSession(session: NxSession, at: number): NxSession {
  const move = session.undo.at(-1);
  if (!move) return session;
  return {
    ...session,
    cube: applyNxMove(session.cube, invertNxMove(move)),
    phase: session.phase === 'solved' ? 'idle' : session.phase,
    undo: session.undo.slice(0, -1),
    redo: [...session.redo, move],
    moves: session.moves.slice(0, -1),
    assisted: session.phase === 'running' || session.assisted,
    startedAt: session.phase === 'ready' ? at : session.startedAt,
  };
}

export function redoNxSession(session: NxSession, at: number, wallClock: number, id: string): NxSession {
  const move = session.redo.at(-1);
  if (!move) return session;
  const next: NxSession = {
    ...session,
    cube: applyNxMove(session.cube, move),
    phase: session.phase === 'ready' ? 'running' : session.phase === 'solved' ? 'idle' : session.phase,
    startedAt: session.phase === 'ready' ? at : session.startedAt,
    undo: [...session.undo, move],
    redo: session.redo.slice(0, -1),
    moves: [...session.moves, move],
    assisted: true,
  };
  return finishIfSolved(next, at, wallClock, id);
}

export function bestNxSingle(solves: readonly NxSolve[]): number | null {
  const clean = solves.filter((solve) => !solve.assisted && solve.penalty !== 'DNF');
  return clean.length ? Math.min(...clean.map(effectiveMs)) : null;
}

/** Physical-cube times share the event history but never change the virtual cube. */
export function addManualNxSolve(session: NxSession, durationMs: number, penalty: Penalty, at: number, id: string): NxSession {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86_400_000 || (durationMs === 0 && penalty !== 'DNF')) {
    throw new RangeError('Manual solve time is invalid.');
  }
  const record: NxSolve = {
    id, at, durationMs, penalty, source: 'manual', scramble: '', moves: 0, assisted: false,
  };
  return { ...session, solves: [...session.solves, record].slice(-500) };
}

export function setNxPenalty(session: NxSession, id: string, penalty: Penalty): NxSession {
  if (!session.solves.some((solve) => solve.id === id)) return session;
  return { ...session, solves: session.solves.map((solve) => solve.id === id ? { ...solve, penalty } : solve) };
}

export function deleteNxSolve(session: NxSession, id: string): NxSession {
  if (!session.solves.some((solve) => solve.id === id)) return session;
  return { ...session, solves: session.solves.filter((solve) => solve.id !== id) };
}

/** Apply verified solver moves as practice, without manufacturing a timed PB. */
export function applyNxSolution(session: NxSession, solution: readonly NxMove[]): NxSession {
  const cube = applyNxMoves(session.cube, solution);
  if (!isNxSolved(cube)) throw new Error('The solution does not solve this cube.');
  return {
    ...session,
    cube,
    phase: 'solved',
    startedAt: null,
    lastDurationMs: null,
    assisted: true,
    moves: [...session.moves, ...solution],
    undo: [],
    redo: [],
  };
}
