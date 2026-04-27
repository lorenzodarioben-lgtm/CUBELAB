/**
 * Frames shared by both cube styles.
 *
 *  - `PIECE_FRAMES`: how each cubie's canonical piece mesh (corner, edge or
 *    centre, built once per design) is turned to the cubie's home pose, and
 *    which colour belongs to each of the canonical face slots.
 *  - `faceletFrame`: a facelet's own 2D frame on its face — in-plane axes
 *    ordered so x × y is the outward normal — and which corners of the piece's
 *    outline point at the face centre (the corners that carry the GAN cut).
 *    Stickers and the hover outline are drawn in this frame.
 */
import * as THREE from 'three';
import { CUBE_ROTATIONS, mulVec, vecEquals } from '../../core/puzzle/geometry';
import type { Vec3 } from '../../core/puzzle/geometry';
import { CUBIE_DEFS } from '../../core/puzzle/cubies';
import type { CubieKind } from '../../core/puzzle/cubies';
import type { Face } from '../../core/puzzle/notation';
import { CANONICAL_HOME, pieceKind } from './pieceGeometry';
import type { PieceKind } from './pieceGeometry';
import { FACE_SLOTS } from './pieceMaterial';

export interface PieceFrame {
  readonly kind: CubieKind;
  /** Rotation taking the canonical piece of this kind to this cubie's home pose. */
  readonly quaternion: THREE.Quaternion;
  /** Face colour for each canonical slot (null = no visible face there). */
  readonly slots: readonly (Face | null)[];
}

/** Per-cubie placement of the canonical piece meshes, derived from the cubie definitions. */
export const PIECE_FRAMES: readonly PieceFrame[] = CUBIE_DEFS.map((def) => {
  const rotation = CUBE_ROTATIONS.find((m) => vecEquals(mulVec(m, CANONICAL_HOME[def.kind]), def.home))!;
  const slots = FACE_SLOTS.map((slot) => {
    const homeNormal = mulVec(rotation, slot);
    return def.stickers.find((s) => vecEquals(s.normal, homeNormal))?.color ?? null;
  });
  const m = rotation;
  const matrix = new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  return { kind: def.kind, quaternion: new THREE.Quaternion().setFromRotationMatrix(matrix), slots };
});

export interface FaceletFrame {
  /** Orientation whose local x, y lie in the face and whose +z is the outward normal. */
  readonly quaternion: THREE.Quaternion;
  readonly kind: PieceKind;
  /**
   * Outline corners that point at the face centre, as a bitmask over the
   * quadrants (+x,+y), (+x,−y), (−x,+y), (−x,−y) of the local frame.
   */
  readonly mask: number;
}

const QUADRANTS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** The frame of the facelet on the face with outward `normal` of the cubie at lattice position `cubie`. */
export function faceletFrame(normal: Vec3, cubie: Vec3): FaceletFrame {
  const axis = normal.findIndex((c) => c !== 0);
  const sign = normal[axis]!;
  const b = (axis + 1) % 3;
  const c = (axis + 2) % 3;
  const [xAxis, yAxis] = sign > 0 ? [b, c] : [c, b];
  const unit = (i: number) => new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(unit(xAxis), unit(yAxis), n));
  let mask = 0;
  QUADRANTS.forEach(([qx, qy], bit) => {
    if (Math.abs(cubie[xAxis]! + qx / 2) === 0.5 && Math.abs(cubie[yAxis]! + qy / 2) === 0.5) mask |= 1 << bit;
  });
  return { quaternion, kind: pieceKind(cubie), mask };
}
