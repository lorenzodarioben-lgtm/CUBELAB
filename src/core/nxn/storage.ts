import type { KeyValueStore } from '../persistence/storage';
import { cubeEvent } from './catalog';
import type { CubeEventId } from './catalog';
import { parseNxAlg } from './notation';
import type { NxSolve } from './session';

const VERSION = 2;
const LIMIT = 500;

export function nxHistoryKey(eventId: CubeEventId): string {
  return `cubelab.nxn.${eventId}.history`;
}

export function sanitizeNxSolve(value: unknown, size: number, version = VERSION): NxSolve | null {
  if (typeof value !== 'object' || value === null) return null;
  const solve = value as Record<string, unknown>;
  if (typeof solve.id !== 'string' || !solve.id || solve.id.length > 80) return null;
  if (typeof solve.at !== 'number' || !Number.isFinite(solve.at) || solve.at <= 0) return null;
  if (typeof solve.durationMs !== 'number' || !Number.isFinite(solve.durationMs) || solve.durationMs < 0 || solve.durationMs > 864e5) return null;
  if (typeof solve.moves !== 'number' || !Number.isInteger(solve.moves) || solve.moves < 0 || solve.moves > 100_000) return null;
  if (typeof solve.assisted !== 'boolean') return null;
  if (typeof solve.scramble !== 'string' || solve.scramble.length > 3000) return null;
  const source = version === 1 ? 'virtual' : solve.source;
  const penalty = version === 1 ? 'none' : solve.penalty;
  if (source !== 'virtual' && source !== 'manual') return null;
  if (penalty !== 'none' && penalty !== '+2' && penalty !== 'DNF') return null;
  try {
    if (source === 'virtual' && parseNxAlg(solve.scramble, size).length === 0) return null;
    if (source === 'manual' && solve.scramble) parseNxAlg(solve.scramble, size);
  } catch {
    return null;
  }
  return {
    id: solve.id, at: solve.at, durationMs: solve.durationMs,
    scramble: solve.scramble, moves: solve.moves, assisted: solve.assisted,
    source, penalty,
  };
}

/** Separate, versioned event histories; never rewrites the established 3×3 history. */
export function loadNxHistory(store: KeyValueStore, eventId: CubeEventId): NxSolve[] {
  const key = nxHistoryKey(eventId);
  const raw = store.getItem(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('v' in parsed) || (parsed.v !== 1 && parsed.v !== VERSION) || !('data' in parsed) || !Array.isArray(parsed.data)) {
      throw new Error('Unknown NxN history schema.');
    }
    const size = cubeEvent(eventId)!.size;
    const seen = new Set<string>();
    const solves: NxSolve[] = [];
    for (const item of parsed.data as unknown[]) {
      const record = sanitizeNxSolve(item, size, parsed.v);
      if (!record || seen.has(record.id)) continue;
      seen.add(record.id);
      solves.push(record);
    }
    if (parsed.v < VERSION || solves.length !== parsed.data.length) store.setItem(`cubelab.backup.nxn.${eventId}.history`, raw);
    return solves.sort((a: NxSolve, b: NxSolve) => a.at - b.at).slice(-LIMIT);
  } catch {
    try { store.setItem(`cubelab.backup.nxn.${eventId}.history`, raw); } catch { /* quota */ }
    return [];
  }
}

export function saveNxHistory(store: KeyValueStore, eventId: CubeEventId, solves: readonly NxSolve[]): boolean {
  try {
    store.setItem(nxHistoryKey(eventId), JSON.stringify({ v: VERSION, data: solves.slice(-LIMIT) }));
    return true;
  } catch {
    return false;
  }
}
