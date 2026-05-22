import { CUBE_EVENTS, cubeEvent } from './nxn/catalog';
import type { CubeEventId } from './nxn/catalog';
import { SHAPE_EVENTS, shapeEvent } from './shapes/catalog';
import type { ShapeEventId } from './shapes/catalog';

export const PUZZLE_EVENTS = [...CUBE_EVENTS, ...SHAPE_EVENTS];
export type PuzzleEventId = CubeEventId | ShapeEventId;

export function puzzleEvent(id: string) {
  return cubeEvent(id) ?? shapeEvent(id);
}
