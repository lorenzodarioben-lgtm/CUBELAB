export const SHAPE_EVENTS = [
  { id: 'pyram', puzzle: 'pyraminx', label: 'Pyraminx', shortLabel: 'Pyraminx', turns: [
    { label: 'U', cw: 'U', ccw: "U'", key: 'u' }, { label: 'L', cw: 'L', ccw: "L'", key: 'l' },
    { label: 'R', cw: 'R', ccw: "R'", key: 'r' }, { label: 'B', cw: 'B', ccw: "B'", key: 'b' },
    { label: 'u', cw: 'u', ccw: "u'", key: '' }, { label: 'l', cw: 'l', ccw: "l'", key: '' },
    { label: 'r', cw: 'r', ccw: "r'", key: '' }, { label: 'b', cw: 'b', ccw: "b'", key: '' },
  ] },
  { id: 'skewb', puzzle: 'skewb', label: 'Skewb', shortLabel: 'Skewb', turns: [
    { label: 'R', cw: 'R', ccw: "R'", key: 'r' }, { label: 'L', cw: 'L', ccw: "L'", key: 'l' },
    { label: 'U', cw: 'U', ccw: "U'", key: 'u' }, { label: 'B', cw: 'B', ccw: "B'", key: 'b' },
  ] },
] as const;

export type ShapeEventId = (typeof SHAPE_EVENTS)[number]['id'];
export type ShapeEvent = (typeof SHAPE_EVENTS)[number];

export function shapeEvent(id: string): ShapeEvent | null {
  return SHAPE_EVENTS.find((event) => event.id === id) ?? null;
}
