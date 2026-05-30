import type { KPuzzle } from 'cubing/kpuzzle';
import type { ShapeEventId } from './catalog';
import type { ShapeSolve } from './session';
import { validShapeSolve } from './storage';

const FORMAT = 'cubelab-shape-history';

export function exportShapeHistory(eventId: ShapeEventId, solves: readonly ShapeSolve[], at = Date.now()): string {
  return JSON.stringify({ format: FORMAT, version: 1, eventId, exportedAt: at, solves }, null, 2);
}

export function importShapeHistory(text: string, eventId: ShapeEventId, kpuzzle: KPuzzle): ShapeSolve[] {
  if (text.length > 1_000_000) throw new Error('That results file is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Choose a valid Cubelab results JSON file.'); }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Choose a valid Cubelab results JSON file.');
  const bundle = parsed as Record<string, unknown>;
  if (bundle.format !== FORMAT || bundle.version !== 1 || !Array.isArray(bundle.solves)) throw new Error('This is not a supported Cubelab shape results file.');
  if (bundle.eventId !== eventId) throw new Error(`These results are for ${String(bundle.eventId)}, not ${eventId}.`);
  if (bundle.solves.length > 500) throw new Error('A results file can contain at most 500 solves.');
  const seen = new Set<string>();
  return bundle.solves.map((value: unknown) => {
    if (!validShapeSolve(value, kpuzzle) || seen.has(value.id)) throw new Error('The results file contains an invalid or duplicate solve.');
    seen.add(value.id);
    return value;
  });
}

export function mergeShapeHistory(local: readonly ShapeSolve[], incoming: readonly ShapeSolve[]): ShapeSolve[] {
  const byId = new Map(incoming.map((solve) => [solve.id, solve]));
  for (const solve of local) byId.set(solve.id, solve);
  return [...byId.values()].sort((a, b) => a.at - b.at).slice(-500);
}
