import type { KPuzzle } from 'cubing/kpuzzle';
import type { KeyValueStore } from '../persistence/storage';
import type { ShapeEventId } from './catalog';
import { createShapeSession } from './session';
import type { ShapeSession, ShapeSolve } from './session';

export function shapeCurrentKey(eventId: ShapeEventId): string {
  return `cubelab.shape.${eventId}.current`;
}

export function saveShapeCurrent(store: KeyValueStore, session: ShapeSession): boolean {
  try {
    store.setItem(shapeCurrentKey(session.eventId), JSON.stringify({ v: 1, eventId: session.eventId, scramble: session.scramble, moves: session.moves }));
    return true;
  } catch { return false; }
}

/** Recreate committed puzzle moves; elapsed time cannot survive a reload. */
export function loadShapeCurrent(store: KeyValueStore, eventId: ShapeEventId, kpuzzle: KPuzzle, solves: readonly ShapeSolve[]): ShapeSession {
  const base = createShapeSession(eventId, kpuzzle, solves);
  const raw = store.getItem(shapeCurrentKey(eventId));
  if (!raw) return base;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || !('v' in data) || data.v !== 1 || !('eventId' in data) || data.eventId !== eventId || !('scramble' in data) || !('moves' in data)) throw new Error('schema');
    if (data.scramble !== null && (typeof data.scramble !== 'string' || !data.scramble || data.scramble.length > 3000)) throw new Error('scramble');
    if (!Array.isArray(data.moves) || data.moves.length > 1000 || !data.moves.every((move) => typeof move === 'string' && move.length > 0 && move.length < 24)) throw new Error('moves');
    const scramble = data.scramble;
    let pattern = kpuzzle.defaultPattern();
    if (scramble) pattern = pattern.applyAlg(scramble);
    for (const move of data.moves as string[]) pattern = pattern.applyMove(move);
    return { ...base, pattern, scramble, moves: data.moves, undo: data.moves, phase: scramble && data.moves.length === 0 ? 'ready' : 'idle', assisted: data.moves.length > 0 };
  } catch {
    try { store.setItem(`cubelab.backup.shape.${eventId}.current`, raw); } catch { /* quota */ }
    return base;
  }
}
