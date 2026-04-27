/**
 * Canonical piece meshes (corner, edge, centre) per piece design and
 * resolution. They take ~80 ms to build at the high tier, so they are kept
 * CPU-side in a reference-counted cache: switching style, finish or back to a
 * tier never rebuilds them, while their GPU buffers are released as soon as no
 * live resource set uses them (a released geometry re-uploads on next use).
 */
import type * as THREE from 'three';
import type { CubieKind } from '../../core/puzzle/cubies';
import { CANONICAL_HOME, buildPieceGeometry } from './pieceGeometry';
import type { PieceShape } from './pieceGeometry';

export type PieceSet = Readonly<Record<CubieKind, THREE.BufferGeometry>>;

const cache = new Map<string, { set: PieceSet; users: number }>();
const keyOf = (shape: PieceShape, detail: number) => `${shape.id}@${detail}`;

/** Borrows the canonical meshes of a design at a resolution (built on first use). */
export function acquirePieceMeshes(shape: PieceShape, detail: number): PieceSet {
  const key = keyOf(shape, detail);
  let entry = cache.get(key);
  if (!entry) {
    entry = {
      set: {
        corner: buildPieceGeometry(CANONICAL_HOME.corner, detail, shape),
        edge: buildPieceGeometry(CANONICAL_HOME.edge, detail, shape),
        center: buildPieceGeometry(CANONICAL_HOME.center, detail, shape),
      },
      users: 0,
    };
    cache.set(key, entry);
  }
  entry.users++;
  return entry.set;
}

/** Returns borrowed meshes; the last user frees their GPU buffers (CPU data stays cached). */
export function releasePieceMeshes(shape: PieceShape, detail: number): void {
  const entry = cache.get(keyOf(shape, detail));
  if (!entry) return;
  entry.users = Math.max(0, entry.users - 1);
  if (entry.users === 0) Object.values(entry.set).forEach((g) => g.dispose());
}
