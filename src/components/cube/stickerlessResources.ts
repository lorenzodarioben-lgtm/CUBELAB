/**
 * Premium Stickerless style: solid moulded pieces (`pieceGeometry.ts`,
 * `STICKERLESS_SHAPE`) whose colour is the plastic, decided per fragment by
 * `pieceMaterial.ts`. Piece meshes come from the shared, reference-counted
 * cache in `pieceMeshes.ts`.
 */
import * as THREE from 'three';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { FACES } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import type { Finish } from '../../core/persistence/settings';
import { PIECE_HALF, PILLOW, STICKERLESS_SHAPE } from './pieceGeometry';
import { createPieceMaterial } from './pieceMaterial';
import { PIECE_FRAMES } from './pieceFrames';
import { acquirePieceMeshes, releasePieceMeshes } from './pieceMeshes';
import type { PieceSet } from './pieceMeshes';
import type { RenderTier } from './renderTier';

/** Distance from a cubie centre to the middle of its outer face (the top of the pillow). */
export const STICKERLESS_SURFACE = PIECE_HALF + PILLOW;

/** Grid resolution per box face of each piece mesh, by tier (shared by both styles). */
export const PIECE_DETAIL: Readonly<Record<RenderTier, number>> = { high: 40, medium: 30, low: 24 };

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
  const pieces = acquirePieceMeshes(STICKERLESS_SHAPE, detail);
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
      releasePieceMeshes(STICKERLESS_SHAPE, detail);
      materials.forEach((m) => m.dispose());
      core.dispose();
      coreMaterial.dispose();
    },
  };
}
