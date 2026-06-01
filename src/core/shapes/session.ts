import type { KPuzzle, KPattern } from 'cubing/kpuzzle';
import type { Penalty } from '../timing/timerMachine';
import type { ShapeEventId } from './catalog';

export interface ShapeSolve {
  readonly id: string;
  readonly at: number;
  readonly durationMs: number;
  readonly scramble: string;
  readonly moves: number;
  readonly assisted: boolean;
  readonly penalty: Penalty;
  readonly source: 'virtual' | 'manual';
}

export interface ShapeSession {
  readonly eventId: ShapeEventId;
  readonly kpuzzle: KPuzzle;
  readonly pattern: KPattern;
  readonly scramble: string | null;
  readonly phase: 'idle' | 'ready' | 'running' | 'solved';
  readonly startedAt: number | null;
  readonly lastDurationMs: number | null;
  readonly moves: readonly string[];
  readonly undo: readonly string[];
  readonly redo: readonly string[];
  readonly assisted: boolean;
  readonly solves: readonly ShapeSolve[];
}

export function isShapeSolved(pattern: KPattern): boolean {
  return pattern.isIdentical(pattern.kpuzzle.defaultPattern());
}

export function createShapeSession(eventId: ShapeEventId, kpuzzle: KPuzzle, solves: readonly ShapeSolve[] = []): ShapeSession {
  return { eventId, kpuzzle, pattern: kpuzzle.defaultPattern(), scramble: null, phase: 'idle', startedAt: null, lastDurationMs: null, moves: [], undo: [], redo: [], assisted: false, solves };
}

export function scrambleShapeSession(session: ShapeSession, scramble: string): ShapeSession {
  const pattern = session.kpuzzle.defaultPattern().applyAlg(scramble);
  if (isShapeSolved(pattern)) throw new Error('The scramble leaves the puzzle solved.');
  return { ...session, pattern, scramble, phase: 'ready', startedAt: null, lastDurationMs: null, moves: [], undo: [], redo: [], assisted: false };
}

export function turnShapeSession(session: ShapeSession, move: string, at: number, wallClock: number, id: string): ShapeSession {
  const pattern = session.pattern.applyMove(move);
  const phase = session.phase === 'ready' ? 'running' : session.phase === 'solved' ? 'idle' : session.phase;
  const startedAt = session.phase === 'ready' ? at : session.startedAt;
  const moves = [...session.moves, move];
  const undo = [...session.undo, move];
  if (phase === 'running' && startedAt !== null && isShapeSolved(pattern)) {
    const durationMs = Math.max(0, at - startedAt);
    const record: ShapeSolve = { id, at: wallClock, durationMs, scramble: session.scramble ?? '', moves: moves.length, assisted: session.assisted, penalty: 'none', source: 'virtual' };
    return { ...session, pattern, phase: 'solved', startedAt: null, lastDurationMs: durationMs, moves, undo, redo: [], solves: [...session.solves, record].slice(-500) };
  }
  return { ...session, pattern, phase, startedAt, moves, undo, redo: [] };
}

export function invertShapeMove(move: string): string {
  if (move.endsWith('++')) return `${move.slice(0, -2)}--`;
  if (move.endsWith('--')) return `${move.slice(0, -2)}++`;
  return move.endsWith("'") ? move.slice(0, -1) : `${move}'`;
}

export function undoShapeSession(session: ShapeSession): ShapeSession {
  const move = session.undo.at(-1);
  if (!move) return session;
  return {
    ...session,
    pattern: session.pattern.applyMove(invertShapeMove(move)),
    phase: session.phase === 'solved' ? 'idle' : session.phase,
    undo: session.undo.slice(0, -1),
    redo: [...session.redo, move],
    moves: session.moves.slice(0, -1),
    assisted: session.phase === 'running' || session.assisted,
  };
}

export function redoShapeSession(session: ShapeSession, at: number, wallClock: number, id: string): ShapeSession {
  const move = session.redo.at(-1);
  if (!move) return session;
  const remaining = session.redo.slice(0, -1);
  return { ...turnShapeSession({ ...session, assisted: true }, move, at, wallClock, id), redo: remaining };
}

export function resetShapeSession(session: ShapeSession): ShapeSession {
  return createShapeSession(session.eventId, session.kpuzzle, session.solves);
}

export function addManualShapeSolve(session: ShapeSession, durationMs: number, penalty: Penalty, at: number, id: string): ShapeSession {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86_400_000 || (durationMs === 0 && penalty !== 'DNF')) {
    throw new RangeError('Manual solve time is invalid.');
  }
  const record: ShapeSolve = { id, at, durationMs, scramble: '', moves: 0, assisted: false, penalty, source: 'manual' };
  return { ...session, solves: [...session.solves, record].slice(-500) };
}

export function setShapePenalty(session: ShapeSession, id: string, penalty: Penalty): ShapeSession {
  if (!session.solves.some((solve) => solve.id === id)) return session;
  return { ...session, solves: session.solves.map((solve) => solve.id === id ? { ...solve, penalty } : solve) };
}

export function deleteShapeSolve(session: ShapeSession, id: string): ShapeSession {
  if (!session.solves.some((solve) => solve.id === id)) return session;
  return { ...session, solves: session.solves.filter((solve) => solve.id !== id) };
}
