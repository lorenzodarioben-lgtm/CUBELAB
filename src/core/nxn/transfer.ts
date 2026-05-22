import { cubeEvent } from './catalog';
import type { CubeEventId } from './catalog';
import type { NxSolve } from './session';
import { sanitizeNxSolve } from './storage';

const FORMAT = 'cubelab-nxn-history';
const MAX_FILE_BYTES = 1_000_000;

export function exportNxHistory(eventId: CubeEventId, solves: readonly NxSolve[], at = Date.now()): string {
  return JSON.stringify({ format: FORMAT, version: 1, eventId, exportedAt: at, solves }, null, 2);
}

export function importNxHistory(text: string, eventId: CubeEventId): NxSolve[] {
  if (text.length > MAX_FILE_BYTES) throw new Error('That results file is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Choose a valid Cubelab results JSON file.'); }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Choose a valid Cubelab results JSON file.');
  const bundle = parsed as Record<string, unknown>;
  if (bundle.format !== FORMAT || bundle.version !== 1 || !Array.isArray(bundle.solves)) {
    throw new Error('This is not a supported Cubelab results file.');
  }
  if (bundle.eventId !== eventId) throw new Error(`These results are for ${String(bundle.eventId)}, not ${eventId}.`);
  if (bundle.solves.length > 500) throw new Error('A results file can contain at most 500 solves.');
  const size = cubeEvent(eventId)!.size;
  const seen = new Set<string>();
  return bundle.solves.map((value: unknown) => {
    const solve = sanitizeNxSolve(value, size);
    if (!solve || seen.has(solve.id)) throw new Error('The results file contains an invalid or duplicate solve.');
    seen.add(solve.id);
    return solve;
  });
}

/** Keep local edits when IDs overlap; import only genuinely new records. */
export function mergeNxHistory(local: readonly NxSolve[], incoming: readonly NxSolve[]): NxSolve[] {
  const byId = new Map(incoming.map((solve) => [solve.id, solve]));
  for (const solve of local) byId.set(solve.id, solve);
  return [...byId.values()].sort((a, b) => a.at - b.at).slice(-500);
}
