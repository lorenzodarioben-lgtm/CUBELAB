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
  readonly solves: readonly ShapeSolve[];
}

export function isShapeSolved(pattern: KPattern): boolean {
  return pattern.isIdentical(pattern.kpuzzle.defaultPattern());
}

export function createShapeSession(eventId: ShapeEventId, kpuzzle: KPuzzle, solves: readonly ShapeSolve[] = []): ShapeSession {
  return { eventId, kpuzzle, pattern: kpuzzle.defaultPattern(), scramble: null, phase: 'idle', startedAt: null, lastDurationMs: null, moves: [], solves };
}

export function scrambleShapeSession(session: ShapeSession, scramble: string): ShapeSession {
  const pattern = session.kpuzzle.defaultPattern().applyAlg(scramble);
  if (isShapeSolved(pattern)) throw new Error('The scramble leaves the puzzle solved.');
  return { ...session, pattern, scramble, phase: 'ready', startedAt: null, lastDurationMs: null, moves: [] };
}

export function turnShapeSession(session: ShapeSession, move: string, at: number, wallClock: number, id: string): ShapeSession {
  const pattern = session.pattern.applyMove(move);
  const phase = session.phase === 'ready' ? 'running' : session.phase === 'solved' ? 'idle' : session.phase;
  const startedAt = session.phase === 'ready' ? at : session.startedAt;
  const moves = [...session.moves, move];
  if (phase === 'running' && startedAt !== null && isShapeSolved(pattern)) {
    const durationMs = Math.max(0, at - startedAt);
    const record: ShapeSolve = { id, at: wallClock, durationMs, scramble: session.scramble ?? '', moves: moves.length, assisted: false, penalty: 'none', source: 'virtual' };
    return { ...session, pattern, phase: 'solved', startedAt: null, lastDurationMs: durationMs, moves, solves: [...session.solves, record].slice(-500) };
  }
  return { ...session, pattern, phase, startedAt, moves };
}

export function resetShapeSession(session: ShapeSession): ShapeSession {
  return createShapeSession(session.eventId, session.kpuzzle, session.solves);
}
