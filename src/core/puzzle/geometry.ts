/**
 * Exact integer geometry for the cube.
 *
 * Coordinate frame (fixed to the puzzle, identical to three.js world axes):
 *
 *   +X = R face   +Y = U face   +Z = F face        (right-handed)
 *
 * Cubie centres live on the integer lattice {-1, 0, 1}³ (the core at the origin
 * is never rendered). Orientations are 3×3 integer rotation matrices, so long
 * move sequences can never accumulate floating-point drift.
 *
 * Rotation sign convention: a positive angle about +axis follows the right-hand
 * rule, i.e. it is counter-clockwise when viewed from the +axis side. Turning a
 * face clockwise (viewed from outside that face) is therefore a *negative*
 * rotation for R/U/F (outward normal = +axis) and a *positive* rotation for
 * L/D/B (outward normal = −axis).
 *
 * Slices live at layer 0 and borrow the direction of their reference face:
 * M turns like L (+), E like D (+), S like F (−).
 */
import type { Face, Move, MoveFamily } from './notation';

export type Axis = 0 | 1 | 2;
export type Layer = -1 | 0 | 1;
export type Vec3 = readonly [number, number, number];
/** Row-major 3×3 matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Rotation axis and lattice layer turned by each move family. */
export const MOVE_AXIS: Readonly<Record<MoveFamily, { axis: Axis; layer: Layer }>> = {
  R: { axis: 0, layer: 1 },
  M: { axis: 0, layer: 0 },
  L: { axis: 0, layer: -1 },
  U: { axis: 1, layer: 1 },
  E: { axis: 1, layer: 0 },
  D: { axis: 1, layer: -1 },
  F: { axis: 2, layer: 1 },
  S: { axis: 2, layer: 0 },
  B: { axis: 2, layer: -1 },
};

/**
 * Signed quarter turns about +axis produced by one clockwise turn of each
 * family. Faces: −1 on the positive side, +1 on the negative side. Slices
 * follow their reference face (M→L, E→D, S→F).
 */
const CLOCKWISE_SIGN: Readonly<Record<MoveFamily, -1 | 1>> = {
  R: -1,
  U: -1,
  F: -1,
  L: 1,
  D: 1,
  B: 1,
  M: 1,
  E: 1,
  S: -1,
};

export const FACE_NORMAL: Readonly<Record<Face, Vec3>> = {
  R: [1, 0, 0],
  L: [-1, 0, 0],
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

/** The move family that turns `layer` about `axis` (layer 0 is the slice). */
export function familyForAxisLayer(axis: Axis, layer: Layer): MoveFamily {
  if (axis === 0) return layer === 1 ? 'R' : layer === -1 ? 'L' : 'M';
  if (axis === 1) return layer === 1 ? 'U' : layer === -1 ? 'D' : 'E';
  return layer === 1 ? 'F' : layer === -1 ? 'B' : 'S';
}

/** Face whose outward normal is the given axis-aligned unit vector. */
export function faceFromNormal(normal: Vec3): Face {
  const [x, y, z] = normal;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return x > 0 ? 'R' : 'L';
  if (ay >= ax && ay >= az) return y > 0 ? 'U' : 'D';
  return z > 0 ? 'F' : 'B';
}

/** Signed quarter turns about +axis produced by one clockwise turn of `family`. */
export function clockwiseQuarterSign(family: MoveFamily): -1 | 1 {
  return CLOCKWISE_SIGN[family];
}

/**
 * Signed quarter turns about the move's +axis. Double turns keep the sign of
 * the family's clockwise sense, purely so the default animation direction of
 * a half turn matches its clockwise direction.
 */
export function moveQuarterTurns(move: Move): number {
  const cw = clockwiseQuarterSign(move.family);
  if (move.turns === 1) return cw;
  if (move.turns === 3) return -cw;
  return 2 * cw;
}

/** Target rotation in radians about the move's +axis. */
export function moveAngle(move: Move): number {
  return (moveQuarterTurns(move) * Math.PI) / 2;
}

const COS = [1, 0, -1, 0];
const SIN = [0, 1, 0, -1];

/** Exact rotation matrix for `quarters` × 90° about +axis. */
export function quarterRotation(axis: Axis, quarters: number): Mat3 {
  const q = ((quarters % 4) + 4) % 4;
  const c = COS[q]!;
  const s = SIN[q]!;
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function determinant(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** True when `m` is one of the 24 proper rotations of the cube (signed permutation, det +1). */
export function isCubeRotation(m: Mat3): boolean {
  for (let row = 0; row < 3; row++) {
    let nonZero = 0;
    for (let col = 0; col < 3; col++) {
      const value = m[row * 3 + col]!;
      if (value !== 0 && value !== 1 && value !== -1) return false;
      if (value !== 0) nonZero++;
    }
    if (nonZero !== 1) return false;
  }
  for (let col = 0; col < 3; col++) {
    let nonZero = 0;
    for (let row = 0; row < 3; row++) if (m[row * 3 + col] !== 0) nonZero++;
    if (nonZero !== 1) return false;
  }
  return determinant(m) === 1;
}

export function matEquals(a: Mat3, b: Mat3): boolean {
  for (let i = 0; i < 9; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function vecEquals(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** All 24 cube rotations in a fixed order. Used for compact persistence. */
export const CUBE_ROTATIONS: readonly Mat3[] = (() => {
  const found: Mat3[] = [];
  const queue: Mat3[] = [IDENTITY];
  const generators = [quarterRotation(0, 1), quarterRotation(1, 1), quarterRotation(2, 1)];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (found.some((m) => matEquals(m, next))) continue;
    found.push(next);
    for (const g of generators) queue.push(mulMat(g, next));
  }
  return found;
})();

export function rotationIndex(m: Mat3): number {
  return CUBE_ROTATIONS.findIndex((r) => matEquals(r, m));
}
