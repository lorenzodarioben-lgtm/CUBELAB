import type { KeyValueStore } from '../persistence/storage';
import type { CubeEventId } from './catalog';
import { applyNxMoves, createNxState } from './model';
import { formatNxAlg, parseNxAlg } from './notation';
import { createNxSession } from './session';
import type { NxSession, NxSolve } from './session';

export function nxCurrentKey(eventId: CubeEventId): string {
  return `cubelab.nxn.${eventId}.current`;
}

export function saveNxCurrent(store: KeyValueStore, eventId: CubeEventId, session: NxSession): boolean {
  try {
    store.setItem(nxCurrentKey(eventId), JSON.stringify({ v: 1, scramble: session.scramble, moves: formatNxAlg(session.moves) }));
    return true;
  } catch { return false; }
}

/** Restore only committed turns. A timer interrupted by reload stays unranked. */
export function loadNxCurrent(store: KeyValueStore, eventId: CubeEventId, size: number, solves: readonly NxSolve[]): NxSession {
  const base = createNxSession(size, solves);
  const raw = store.getItem(nxCurrentKey(eventId));
  if (!raw) return base;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || !('v' in data) || data.v !== 1 || !('scramble' in data) || !('moves' in data)) throw new Error('schema');
    if (data.scramble !== null && (typeof data.scramble !== 'string' || !data.scramble || data.scramble.length > 3000)) throw new Error('scramble');
    if (typeof data.moves !== 'string' || data.moves.length > 5000) throw new Error('moves');
    const scramble = data.scramble;
    const scrambleMoves = scramble ? parseNxAlg(scramble, size) : [];
    const moves = parseNxAlg(data.moves, size);
    if (moves.length > 1000) throw new Error('moves');
    const cube = applyNxMoves(applyNxMoves(createNxState(size), scrambleMoves), moves);
    return { ...base, cube, scramble, moves, undo: moves, phase: scramble && moves.length === 0 ? 'ready' : 'idle', assisted: moves.length > 0 };
  } catch {
    try { store.setItem(`cubelab.backup.nxn.${eventId}.current`, raw); } catch { /* quota */ }
    return base;
  }
}
