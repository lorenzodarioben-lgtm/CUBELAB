import { EXPERIMENTAL_PUZZLES } from './features';
import { CUBE_EVENTS, cubeEvent } from './nxn/catalog';
import type { CubeEventId } from './nxn/catalog';
import { SHAPE_EVENTS, shapeEvent } from './shapes/catalog';
import type { ShapeEventId } from './shapes/catalog';

export const PUZZLE_EVENTS = [...CUBE_EVENTS, ...SHAPE_EVENTS];
export type PuzzleEventId = CubeEventId | ShapeEventId;

export function puzzleEvent(id: string) {
  return cubeEvent(id) ?? shapeEvent(id);
}

/** Events offered in the website UI. Expansion catalogs stay intact for tests and a future re-enable. */
export function publicPuzzleEvents() {
  return EXPERIMENTAL_PUZZLES ? PUZZLE_EVENTS : PUZZLE_EVENTS.filter((event) => event.id === '333');
}

/** Resolve a requested event for the website. Unknown or gated ids fall back to 3×3. */
export function publicPuzzleId(id: string): PuzzleEventId {
  if (!EXPERIMENTAL_PUZZLES) return '333';
  return puzzleEvent(id)?.id ?? '333';
}
