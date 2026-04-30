/** The cube events supported by the shared NxN practice model. */
export const CUBE_EVENTS = [
  { id: '222', size: 2, label: '2×2×2', shortLabel: '2×2' },
  { id: '333', size: 3, label: '3×3×3', shortLabel: '3×3' },
  { id: '444', size: 4, label: '4×4×4', shortLabel: '4×4' },
  { id: '555', size: 5, label: '5×5×5', shortLabel: '5×5' },
  { id: '666', size: 6, label: '6×6×6', shortLabel: '6×6' },
  { id: '777', size: 7, label: '7×7×7', shortLabel: '7×7' },
] as const;

export type CubeEventId = (typeof CUBE_EVENTS)[number]['id'];

export function cubeEvent(id: string): (typeof CUBE_EVENTS)[number] | null {
  return CUBE_EVENTS.find((event) => event.id === id) ?? null;
}
