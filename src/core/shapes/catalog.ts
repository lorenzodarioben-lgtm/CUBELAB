export const SHAPE_EVENTS = [
  { id: 'pyram', puzzle: 'pyraminx', label: 'Pyraminx', shortLabel: 'Pyraminx', turns: ['U', 'L', 'R', 'B', 'u', 'l', 'r', 'b'] },
  { id: 'skewb', puzzle: 'skewb', label: 'Skewb', shortLabel: 'Skewb', turns: ['R', 'L', 'U', 'B'] },
] as const;

export type ShapeEventId = (typeof SHAPE_EVENTS)[number]['id'];
export type ShapeEvent = (typeof SHAPE_EVENTS)[number];

export function shapeEvent(id: string): ShapeEvent | null {
  return SHAPE_EVENTS.find((event) => event.id === id) ?? null;
}
