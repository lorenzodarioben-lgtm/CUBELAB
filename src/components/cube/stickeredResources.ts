/**
 * Classic Stickered style, modelled on a premium black-plastic stickered
 * speedcube (GAN 356 style):
 *
 *  - Bodies: deep, glossy black moulded pieces built by the same SDF mesher as
 *    the stickerless cube, with their own design (`STICKERED_SHAPE`): flat faces,
 *    a near-round centre, round-ended edges, a crisp inner corner on corner
 *    pieces, and a soft edge roll that carries bright studio highlights. Their
 *    material is the piece shader with every cap black: glossy outside, satin
 *    inside, with a moulded honeycomb on the internal faces a turn exposes.
 *  - Stickers: thin, shaped vinyl stickers that follow each piece's outline,
 *    inset by a thin black border — round on centres, D-shaped on edges, nearly
 *    square on corners — with softly rounded edges. Each colour has a few
 *    barely different print batches (tone and sheen), and every sticker is laid
 *    with a hair of rotation and offset, as by hand.
 *
 * Everything is procedural (no image assets) and deterministic.
 */
import * as THREE from 'three';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { CUBIE_DEFS } from '../../core/puzzle/cubies';
import type { CubieKind } from '../../core/puzzle/cubies';
import { FACES } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import type { Finish } from '../../core/persistence/settings';
import { PIECE_HALF, outlineCornerRadius } from './pieceGeometry';
import type { PieceKind, PieceShape } from './pieceGeometry';
import { createPieceMaterial } from './pieceMaterial';
import { PIECE_FRAMES, faceletFrame } from './pieceFrames';
import { acquirePieceMeshes, releasePieceMeshes } from './pieceMeshes';
import type { PieceSet } from './pieceMeshes';
import { PIECE_DETAIL } from './stickerlessResources';
import type { RenderTier } from './renderTier';

/** The black body design: flat faces, rounder centre and edge ends, a glossy edge roll. */
export const STICKERED_SHAPE: PieceShape = {
  id: 'stickered',
  innerRadius: { center: 0.48, edge: 0.4, corner: 0.08 },
  rimRadius: 0.07,
  pillow: 0,
  cubeEdgeRadius: 0.095,
};

/** Width of the black border between a sticker and its piece's edge. */
export const STICKER_INSET = 0.088;
/** Half-width of a sticker. */
export const STICKER_HALF = PIECE_HALF - STICKER_INSET;
/** Smallest corner radius of a sticker (die-cut stickers are never sharp). */
const STICKER_MIN_RADIUS = 0.07;
const STICKER_DEPTH = 0.003;
const STICKER_BEVEL = 0.003;
/** Distance from a cubie centre to a sticker's base (a hair into the body: no gap shows). */
export const STICKER_OFFSET = PIECE_HALF - 0.0008;
/** Thickness of a sticker above its base. */
export const TILE_TOP = STICKER_DEPTH + 2 * STICKER_BEVEL;
/** Distance from a cubie centre to the top of its stickers. */
export const STICKERED_SURFACE = STICKER_OFFSET + TILE_TOP;
/** Print batches per colour; each sticker picks one deterministically. */
export const TILE_VARIANTS = 4;
/** Largest hand-laid rotation (radians, ≈0.3°) and offset (world units) of a sticker. */
const LAY_ROTATION = 0.005;
const LAY_SHIFT = 0.0025;

/** Corner radii of a sticker, per quadrant of its facelet frame, following its piece's outline. */
export function stickerRadii(kind: PieceKind, mask: number): number[] {
  return [0, 1, 2, 3].map((i) =>
    Math.max(STICKER_MIN_RADIUS, outlineCornerRadius(kind, (mask & (1 << i)) !== 0, STICKERED_SHAPE) - STICKER_INSET),
  );
}

/** Small deterministic PRNG (LCG) so every load renders the identical cube. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface TileSeat {
  readonly color: Face;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Key of the sticker outline in `StickeredResources.tiles`. */
  readonly shape: string;
  readonly variant: number;
}

const tileShapeKey = (kind: PieceKind, mask: number) => `${kind}:${mask}`;

/** Every sticker's deterministic seat on its piece: the facelet frame plus a hand-laid rotation and offset. */
export const TILE_SEATS: readonly (readonly TileSeat[])[] = (() => {
  const rand = seededRandom(2024);
  return CUBIE_DEFS.map((def) =>
    def.stickers.map((s) => {
      const frame = faceletFrame(s.normal, def.home);
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (rand() - 0.5) * 2 * LAY_ROTATION);
      const quaternion = frame.quaternion.clone().multiply(turn);
      const shift = new THREE.Vector3((rand() - 0.5) * 2 * LAY_SHIFT, (rand() - 0.5) * 2 * LAY_SHIFT, 0).applyQuaternion(frame.quaternion);
      return {
        color: s.color,
        position: new THREE.Vector3(s.normal[0], s.normal[1], s.normal[2]).multiplyScalar(STICKER_OFFSET).add(shift),
        quaternion,
        shape: tileShapeKey(frame.kind, frame.mask),
        variant: Math.floor(rand() * TILE_VARIANTS),
      };
    }),
  );
})();

/** Rounded rectangle (half-size h) with a radius per quadrant (+,+), (+,−), (−,+), (−,−), counter-clockwise. */
function roundedRect(path: THREE.Path, h: number, radii: readonly number[]): void {
  const [pp, pm, mp, mm] = radii as [number, number, number, number];
  path.moveTo(-h + mm, -h);
  path.lineTo(h - pm, -h);
  path.absarc(h - pm, -h + pm, pm, -Math.PI / 2, 0, false);
  path.lineTo(h, h - pp);
  path.absarc(h - pp, h - pp, pp, 0, Math.PI / 2, false);
  path.lineTo(-h + mp, h);
  path.absarc(-h + mp, h - mp, mp, Math.PI / 2, Math.PI, false);
  path.lineTo(-h, -h + mm);
  path.absarc(-h + mm, -h + mm, mm, Math.PI, Math.PI * 1.5, false);
}

/** A sticker: a thin extrusion of its outline with softly rounded edges, base on z = 0. */
function stickerGeometry(kind: PieceKind, mask: number, detailed: boolean): THREE.BufferGeometry {
  // The bevel grows the outline by STICKER_BEVEL, so build it that much smaller.
  const shape = new THREE.Shape();
  roundedRect(
    shape,
    STICKER_HALF - STICKER_BEVEL,
    stickerRadii(kind, mask).map((r) => Math.max(0.01, r - STICKER_BEVEL)),
  );
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: STICKER_DEPTH,
    bevelEnabled: true,
    bevelThickness: STICKER_BEVEL,
    bevelSize: STICKER_BEVEL,
    bevelOffset: 0,
    bevelSegments: detailed ? 4 : 2,
    curveSegments: detailed ? 14 : 7,
  });
  geometry.translate(0, 0, STICKER_BEVEL);
  geometry.computeVertexNormals();
  return geometry;
}

/** Every sticker outline used on a 3×3: one centre, four edge and four corner orientations. */
const TILE_SHAPES: ReadonlyArray<{ kind: PieceKind; mask: number }> = (() => {
  const seen = new Map<string, { kind: PieceKind; mask: number }>();
  for (const def of CUBIE_DEFS) {
    for (const s of def.stickers) {
      const frame = faceletFrame(s.normal, def.home);
      seen.set(tileShapeKey(frame.kind, frame.mask), { kind: frame.kind, mask: frame.mask });
    }
  }
  return [...seen.values()];
})();

export interface StickeredResources {
  /** Canonical black bodies (turned per cubie by `PIECE_FRAMES`). */
  readonly bodies: PieceSet;
  /** One body material per piece kind (all caps black, honeycomb inside). */
  readonly bodyMaterials: Readonly<Record<CubieKind, THREE.Material>>;
  /** Sticker meshes by outline key (see `TileSeat.shape`). */
  readonly tiles: Readonly<Record<string, THREE.BufferGeometry>>;
  /** `TILE_VARIANTS` materials per colour. */
  readonly tileMaterials: Readonly<Record<Face, readonly THREE.Material[]>>;
  readonly core: THREE.BufferGeometry;
  readonly coreMaterial: THREE.Material;
  /** Tells the body materials how far the turn in flight has opened the cube (0…1). */
  setExposure(value: number): void;
  dispose(): void;
}

/** Deep glossy black of the body plastic. */
const BODY_BLACK = new THREE.Color('#09090b');

export function createStickeredResources(tier: RenderTier, finish: Finish): StickeredResources {
  const physical = tier !== 'low';
  const gloss = finish === 'gloss';
  const detail = PIECE_DETAIL[tier];
  const bodies = acquirePieceMeshes(STICKERED_SHAPE, detail);
  // How far the turn in flight has opened the cube (shared by all body materials).
  const exposure = { value: 0 };

  // Visible faces of each canonical piece are the same for every cubie of a kind,
  // so one material per kind (the caps are all black anyway).
  const kindSlots = (kind: CubieKind) => PIECE_FRAMES.find((f) => f.kind === kind)!.slots.map((face) => (face ? BODY_BLACK : null));
  const bodyMaterial = (kind: CubieKind, seed: number) =>
    createPieceMaterial(kindSlots(kind), { tier, finish }, seed, {
      // A broad sheen under a sharp coat: flat black reads as polished plastic, not a void.
      capRoughness: gloss ? 0.3 : 0.45,
      capCoat: gloss ? 0.85 : 0.2,
      capCoatRoughness: gloss ? 0.06 : 0.35,
      blackRoughness: gloss ? 0.32 : 0.48,
      // Let the glossy edge roll keep its highlight further into the seam; keep
      // seams fully shaded while the cube is closed (no glints), and the faces a
      // turn exposes lit enough to show their form while it is open.
      seamRange: [0.6, 0.97],
      cavityMin: 0.2,
      seamFloor: [0.6, 0.22, 0.45, 0.03],
      open: { cavityMin: 0.42, seamFloor: [0.85, 0.55, 0.8, 0.35] },
      exposure,
      // Mechanism plastic: the same black, rendered a deep charcoal so its moulding reads in the dark studio.
      interiorColor: '#1a1a1e',
      honeycomb: true,
    });
  const bodyMaterials = { corner: bodyMaterial('corner', 3), edge: bodyMaterial('edge', 7), center: bodyMaterial('center', 11) };

  const tiles = Object.fromEntries(TILE_SHAPES.map(({ kind, mask }) => [tileShapeKey(kind, mask), stickerGeometry(kind, mask, physical)]));

  // The mechanism's core, glimpsed between layers mid-turn.
  const core = new THREE.SphereGeometry(0.5, physical ? 32 : 16, physical ? 24 : 12);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.6, metalness: 0 });

  // Vinyl stickers: smooth and glossy (gloss) or satin (matte), a touch less
  // glossy than the black body so the two plastics read as different parts.
  const Material = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const rand = seededRandom(97);
  const tileMaterials = {} as Record<Face, THREE.Material[]>;
  const tint = new THREE.Color();
  for (const face of FACES) {
    const variants: THREE.Material[] = [];
    for (let v = 0; v < TILE_VARIANTS; v++) {
      tint.set(FACE_COLORS[face].hex).offsetHSL((rand() - 0.5) * 0.006, (rand() - 0.5) * 0.03, (rand() - 0.5) * 0.02);
      const sheen = (rand() - 0.5) * 0.06;
      variants.push(
        new Material({
          color: tint.clone(),
          roughness: (gloss ? 0.24 : 0.52) + sheen,
          metalness: 0,
          ...(physical
            ? { clearcoat: gloss ? 0.55 : 0.08, clearcoatRoughness: gloss ? 0.14 + sheen * 0.3 : 0.45, specularIntensity: 0.6, ior: 1.5 }
            : {}),
        }),
      );
    }
    tileMaterials[face] = variants;
  }

  let disposed = false;
  return {
    bodies,
    bodyMaterials,
    tiles,
    tileMaterials,
    core,
    coreMaterial,
    setExposure(value) {
      exposure.value = value;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releasePieceMeshes(STICKERED_SHAPE, detail);
      Object.values(bodyMaterials).forEach((m) => m.dispose());
      Object.values(tiles).forEach((g) => g.dispose());
      for (const face of FACES) tileMaterials[face].forEach((m) => m.dispose());
      core.dispose();
      coreMaterial.dispose();
    },
  };
}
