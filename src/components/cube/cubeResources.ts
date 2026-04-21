/**
 * Shared resources for the cube, modelled on a premium stickerless speedcube:
 * solid moulded pieces whose visible faces are coloured plastic caps over
 * black mechanism plastic (see `pieceGeometry.ts` and `pieceMaterial.ts`).
 *
 * Piece meshes are per tier (three canonical shapes, oriented per cubie);
 * materials are per cubie and per finish. Everything here is disposed on
 * change/unmount. All textures are generated at runtime (no image assets).
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
import type { RenderTier } from './pieceMaterial';

export type { RenderTier } from './pieceMaterial';

/** Lattice spacing between cubie centres (world units). */
export const SPACING = 1;
/** Distance from a cubie centre to the middle of its outer face (the top of the pillow). */
export const SURFACE_OFFSET = PIECE_HALF + PILLOW;

/** Grid resolution per box face of each piece mesh, by tier. */
const PIECE_DETAIL: Readonly<Record<RenderTier, number>> = { high: 40, medium: 30, low: 24 };

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

export interface CubeResources {
  readonly pieces: Readonly<Record<CubieKind, THREE.BufferGeometry>>;
  /** One material per cubie id. */
  readonly pieceMaterials: readonly THREE.Material[];
  readonly label: THREE.BufferGeometry;
  readonly core: THREE.BufferGeometry;
  readonly coreMaterial: THREE.Material;
  readonly labelMaterials: Readonly<Record<Face, THREE.Material>>;
  readonly shadows: boolean;
  dispose(): void;
}

const LABEL_INK: Readonly<Record<Face, string>> = {
  U: 'rgba(20,20,26,0.62)',
  D: 'rgba(40,30,0,0.62)',
  F: 'rgba(255,255,255,0.86)',
  B: 'rgba(255,255,255,0.88)',
  R: 'rgba(255,255,255,0.88)',
  L: 'rgba(40,16,0,0.62)',
};

function labelTexture(face: Face): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = LABEL_INK[face];
    ctx.font = `600 ${size * 0.6}px "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face, size / 2, size * 0.55);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Render tiers.
 *  high   — physical materials, finest piece meshes, real-time soft shadows (desktop).
 *  medium — same materials, lighter meshes, no shadow passes (touch devices).
 *  low    — standard materials, coarser meshes, no shadows.
 */
export function createCubeResources(tier: RenderTier, finish: Finish): CubeResources {
  const detail = PIECE_DETAIL[tier];
  const pieces = {
    corner: buildPieceGeometry(CANONICAL_HOME.corner, detail),
    edge: buildPieceGeometry(CANONICAL_HOME.edge, detail),
    center: buildPieceGeometry(CANONICAL_HOME.center, detail),
  };

  const palette = Object.fromEntries(FACES.map((face) => [face, new THREE.Color(FACE_COLORS[face].hex)])) as Record<Face, THREE.Color>;
  const pieceMaterials = PIECE_FRAMES.map((frame, id) =>
    createPieceMaterial(
      frame.slots.map((face) => (face ? palette[face] : null)),
      { tier, finish },
      (id * 7.31) % 13,
    ),
  );

  const label = new THREE.PlaneGeometry(0.46, 0.46);
  // The mechanism's core: fills the central cell, glimpsed only between layers mid-turn.
  const core = new THREE.SphereGeometry(0.5, tier === 'low' ? 16 : 32, tier === 'low' ? 12 : 24);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.7, metalness: 0 });

  const textures: THREE.Texture[] = [];
  const labelMaterials = {} as Record<Face, THREE.Material>;
  for (const face of FACES) {
    const map = labelTexture(face);
    textures.push(map);
    labelMaterials[face] = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }

  return {
    pieces,
    pieceMaterials,
    label,
    core,
    coreMaterial,
    labelMaterials,
    shadows: tier === 'high',
    dispose() {
      Object.values(pieces).forEach((g) => g.dispose());
      pieceMaterials.forEach((m) => m.dispose());
      label.dispose();
      core.dispose();
      coreMaterial.dispose();
      for (const face of FACES) labelMaterials[face].dispose();
      textures.forEach((t) => t.dispose());
    },
  };
}
