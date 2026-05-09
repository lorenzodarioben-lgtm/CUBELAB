import type { Vec3 } from '../puzzle/geometry';
import type { Face } from '../puzzle/notation';
import type { NxMove } from './model';

const SIDES: readonly [readonly [Face, Face], readonly [Face, Face], readonly [Face, Face]] = [
  ['L', 'R'], ['D', 'U'], ['B', 'F'],
];

/**
 * Translate a sticker drag in the puzzle's world plane into the layer that
 * passes under the finger. `normal × drag` gives the physical rotation axis;
 * the sticker's position selects its outer or wide-turn depth.
 */
export function moveForNxDrag(size: number, position: Vec3, normal: Vec3, drag: Vec3, threshold: number): NxMove | null {
  const distance = Math.hypot(...drag);
  if (distance < threshold) return null;
  const cross: Vec3 = [
    normal[1] * drag[2] - normal[2] * drag[1],
    normal[2] * drag[0] - normal[0] * drag[2],
    normal[0] * drag[1] - normal[1] * drag[0],
  ];
  const axis = ([0, 1, 2] as const).reduce((best, candidate) => Math.abs(cross[candidate]) > Math.abs(cross[best]) ? candidate : best, 0);
  if (Math.abs(cross[axis]) < threshold * 0.5) return null;
  const side = position[axis] >= 0 ? 1 : 0;
  const face = SIDES[axis][side];
  const width = (size - 1 - Math.abs(position[axis])) / 2 + 1;
  const clockwiseSign = side ? -1 : 1;
  const turns = Math.sign(cross[axis]) === clockwiseSign ? 1 : 3;
  return { face, width, turns };
}
