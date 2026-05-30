import type { KPuzzle } from 'cubing/kpuzzle';
import type { KeyValueStore } from '../persistence/storage';
import type { ShapeEventId } from './catalog';
import type { ShapeSolve } from './session';

export function shapeHistoryKey(eventId: ShapeEventId): string {
  return `cubelab.shape.${eventId}.history`;
}

export function validShapeSolve(value: unknown, kpuzzle: KPuzzle): value is ShapeSolve {
  if (typeof value !== 'object' || value === null) return false;
  const solve = value as Record<string, unknown>;
  if (typeof solve.id !== 'string' || !solve.id || solve.id.length > 80) return false;
  if (typeof solve.at !== 'number' || !Number.isFinite(solve.at) || solve.at <= 0) return false;
  if (typeof solve.durationMs !== 'number' || !Number.isFinite(solve.durationMs) || solve.durationMs < 0 || solve.durationMs > 86_400_000) return false;
  if (typeof solve.moves !== 'number' || !Number.isInteger(solve.moves) || solve.moves < 0 || solve.moves > 100_000) return false;
  if (typeof solve.assisted !== 'boolean') return false;
  if (solve.penalty !== 'none' && solve.penalty !== '+2' && solve.penalty !== 'DNF') return false;
  if (solve.source !== 'virtual' && solve.source !== 'manual') return false;
  if (typeof solve.scramble !== 'string' || (solve.source === 'virtual' && !solve.scramble) || solve.scramble.length > 3000) return false;
  try { if (solve.scramble) kpuzzle.defaultPattern().applyAlg(solve.scramble); } catch { return false; }
  return true;
}

export function loadShapeHistory(store: KeyValueStore, eventId: ShapeEventId, kpuzzle: KPuzzle): ShapeSolve[] {
  const raw = store.getItem(shapeHistoryKey(eventId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('v' in parsed) || parsed.v !== 1 || !('eventId' in parsed) || parsed.eventId !== eventId || !('data' in parsed) || !Array.isArray(parsed.data)) throw new Error('schema');
    const seen = new Set<string>();
    const solves = (parsed.data as unknown[]).filter((value): value is ShapeSolve => {
      if (!validShapeSolve(value, kpuzzle) || seen.has(value.id)) return false;
      seen.add(value.id);
      return true;
    });
    if (solves.length !== parsed.data.length) store.setItem(`cubelab.backup.shape.${eventId}.history`, raw);
    return solves.sort((a, b) => a.at - b.at).slice(-500);
  } catch {
    try { store.setItem(`cubelab.backup.shape.${eventId}.history`, raw); } catch { /* quota */ }
    return [];
  }
}

export function saveShapeHistory(store: KeyValueStore, eventId: ShapeEventId, solves: readonly ShapeSolve[]): boolean {
  try { store.setItem(shapeHistoryKey(eventId), JSON.stringify({ v: 1, eventId, data: solves.slice(-500) })); return true; }
  catch { return false; }
}
