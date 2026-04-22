/**
 * Premium Stickerless style: solid moulded pieces (`pieceGeometry.ts`) whose
 * colour is the plastic, decided per fragment by `pieceMaterial.ts`.
 *
 * Piece meshes take ~80 ms to build at the high tier, so they are kept
 * CPU-side in a reference-counted cache per resolution: switching style or
 * finish never rebuilds them, while their GPU buffers are released as soon as
 * no live resource set uses them (a released geometry re-uploads on next use).
 */
import * as THREE from 'three';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { CUBE_ROTATIONS, mulVec, vecEquals } from '../../core/puzzle/geometry';
import { CUBIE_DEFS } from '../../core/puzzle/cubies';
import type { CubieKind } from '../../core/puzzle/cubies';
import { FACES } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import type { Finish } from '../../core/persistence/settings';
import { CANONICAL_HOME, PIECE_HALF, PILLOW, buildPieceGeometry } from './pieceGeometry';
import { FACE_SLOTS, createPieceMaterial } from './pieceMaterial';
import type { RenderTier } from './renderTier';

/** Distance from a cubie centre to the middle of its outer face (the top of the pillow). */
export const STICKERLESS_SURFACE = PIECE_HALF + PILLOW;

/** Grid resolution per box face of each piece mesh, by tier. */
export const PIECE_DETAIL: Readonly<Record<RenderTier, number>> = { high: 40, medium: 30, low: 24 };

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

type PieceSet = Readonly<Record<CubieKind, THREE.BufferGeometry>>;

const pieceCache = new Map<number, { set: PieceSet; users: number }>();

/** Borrows the canonical piece meshes at a resolution (built on first use). */
function acquirePieces(detail: number): PieceSet {
  let entry = pieceCache.get(detail);
  if (!entry) {
    entry = {
      set: {
        corner: buildPieceGeometry(CANONICAL_HOME.corner, detail),
        edge: buildPieceGeometry(CANONICAL_HOME.edge, detail),
        center: buildPieceGeometry(CANONICAL_HOME.center, detail),
      },
      users: 0,
    };
    pieceCache.set(detail, entry);
  }
  entry.users++;
  return entry.set;
}

/** Returns borrowed meshes; the last user frees their GPU buffers (CPU data stays cached). */
function releasePieces(detail: number): void {
  const entry = pieceCache.get(detail);
  if (!entry) return;
  entry.users = Math.max(0, entry.users - 1);
  if (entry.users === 0) Object.values(entry.set).forEach((g) => g.dispose());
}

export interface StickerlessResources {
  readonly pieces: PieceSet;
  /** One material per cubie id. */
  readonly materials: readonly THREE.Material[];
  readonly core: THREE.BufferGeometry;
  readonly coreMaterial: THREE.Material;
  dispose(): void;
}

export function createStickerlessResources(tier: RenderTier, finish: Finish): StickerlessResources {
  const detail = PIECE_DETAIL[tier];
  const pieces = acquirePieces(detail);
  const palette = Object.fromEntries(FACES.map((face) => [face, new THREE.Color(FACE_COLORS[face].hex)])) as Record<Face, THREE.Color>;
  const materials = PIECE_FRAMES.map((frame, id) =>
    createPieceMaterial(
      frame.slots.map((face) => (face ? palette[face] : null)),
      { tier, finish },
      (id * 7.31) % 13,
    ),
  );
  // The mechanism's core: fills the central cell, glimpsed only between layers mid-turn.
  const core = new THREE.SphereGeometry(0.5, tier === 'low' ? 16 : 32, tier === 'low' ? 12 : 24);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.7, metalness: 0 });
  let disposed = false;
  return {
    pieces,
    materials,
    core,
    coreMaterial,
    dispose() {
      if (disposed) return;
      disposed = true;
      releasePieces(detail);
      materials.forEach((m) => m.dispose());
      core.dispose();
      coreMaterial.dispose();
    },
  };
}
