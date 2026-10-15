/**
 * Premium Stickerless style: solid moulded pieces (`pieceGeometry.ts`,
 * `STICKERLESS_SHAPE`) whose colour is the plastic, decided per fragment by
 * `pieceMaterial.ts`. Piece meshes come from the shared, reference-counted
 * cache in `pieceMeshes.ts`.
 *
 * The plastic has a broad satin base under a restrained clear coat, so the
 * moulded rims catch crisp reflections without a prominent second sheen.
 * Very gentle moulding waviness and a deterministic per-piece
 * finish variation keep neighbouring pieces from reflecting identically. The
 * mechanism is charcoal plastic with a moulded honeycomb and a ring track,
 * the parting line where each coloured shell meets the black body is drawn,
 * and the faces a turn exposes are lit while it is open (as on the stickered
 * cube), while closed seams and openings stay deep black.
 */
import * as THREE from 'three';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { FACES } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import type { Finish } from '../../core/persistence/settings';
import { CANONICAL_HOME, PIECE_HALF, PILLOW, STICKERLESS_SHAPE } from './pieceGeometry';
import { createPieceMaterial } from './pieceMaterial';
import { PIECE_FRAMES } from './pieceFrames';
import { prng } from '../../core/audio/synth';
import { acquirePieceMeshes, releasePieceMeshes } from './pieceMeshes';
import type { PieceSet } from './pieceMeshes';
import type { RenderTier } from './renderTier';
import { STICKERLESS_CENTRE_MESH } from './stickerlessCenterGeometry';

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
  /** Tells the materials how far the turn in flight has opened the cube (0…1). */
  setExposure(value: number): void;
  /** Uses this reflection map (null: the scene environment). */
  setEnvironment(texture: THREE.Texture | null): void;
  dispose(): void;
}

export function createStickerlessResources(tier: RenderTier, finish: Finish): StickerlessResources {
  const detail = PIECE_DETAIL[tier];
  const pieces = acquirePieceMeshes(STICKERLESS_SHAPE, detail, STICKERLESS_CENTRE_MESH);
  const gloss = finish === 'gloss';
  const palette = Object.fromEntries(FACES.map((face) => [face, new THREE.Color(FACE_COLORS[face].hex)])) as Record<Face, THREE.Color>;
  // How far the turn in flight has opened the cube (shared by every piece).
  const exposure = { value: 0 };
  // Each piece's own moulding: stable for the life of the page, never per render.
  const vary = prng(4242);
  const materials = PIECE_FRAMES.map((frame, id) =>
    createPieceMaterial(
      frame.slots.map((face) => (face ? palette[face] : null)),
      { tier, finish },
      (id * 7.31) % 13,
      {
        capRoughness: gloss ? 0.26 : 0.42,
        capCoat: gloss ? 0.35 : 0.12,
        capCoatRoughness: gloss ? 0.07 : 0.4,
        // Applies with the stickerless reflection map (three.js uses the scene's
        // own intensity for materials that fall back to the scene environment).
        envIntensity: gloss ? 1 : 0.9,
        seamRange: [0.35, 0.9],
        rimNormals: { home: CANONICAL_HOME[frame.kind], shape: STICKERLESS_SHAPE, continuousCentre: frame.kind === 'center' },
        interiorColor: '#17171a',
        honeycomb: true,
        track: CANONICAL_HOME[frame.kind],
        capSeam: true,
        waviness: gloss ? 0.0009 : 0.0006,
        variation: { roughness: (vary() - 0.5) * 0.14, coat: (vary() - 0.5) * 0.4 },
        open: { cavityMin: 0.42, seamFloor: [0.85, 0.55, 0.8, 0.35] },
        exposure,
      },
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
    setExposure(value) {
      exposure.value = value;
    },
    setEnvironment(texture) {
      for (const m of materials) (m as THREE.MeshStandardMaterial).envMap = texture;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releasePieceMeshes(STICKERLESS_SHAPE, detail, STICKERLESS_CENTRE_MESH);
      materials.forEach((m) => m.dispose());
      core.dispose();
      coreMaterial.dispose();
    },
  };
}
