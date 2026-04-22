/**
 * Visual resources for both cube styles, behind one owner.
 *
 * The puzzle has a single state and a single cubie hierarchy; a cube style is
 * only the physical model hung on those cubies. `CubeVisuals` owns everything
 * GPU-backed for one render tier and finish:
 *
 *   - Classic Stickered (`stickeredResources.ts`): black bodies + raised tiles;
 *   - Premium Stickerless (`stickerlessResources.ts`): moulded coloured pieces;
 *   - the face-letter overlays, shared by both.
 *
 * Each style's set is created the first time it is shown and then kept until
 * the tier or finish changes (or the stage unmounts), so switching back and
 * forth is instant and never recompiles shaders; GPU memory is bounded by the
 * two sets and released in `dispose()`.
 */
import * as THREE from 'three';
import { FACES } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import type { CubeStyle, Finish } from '../../core/persistence/settings';
import { STICKERED_SURFACE, createStickeredResources } from './stickeredResources';
import type { StickeredResources } from './stickeredResources';
import { STICKERLESS_SURFACE, createStickerlessResources } from './stickerlessResources';
import type { StickerlessResources } from './stickerlessResources';
import type { RenderTier } from './renderTier';

export type { RenderTier } from './renderTier';

/** Lattice spacing between cubie centres (world units). */
export const SPACING = 1;
/** Where the invisible facelet anchors sit: the cubie's face plane (style-independent). */
export const ANCHOR_OFFSET = 0.5;
/** Distance from a cubie centre to the visible top of its outer face, per style. */
export const SURFACE_OFFSET: Readonly<Record<CubeStyle, number>> = {
  stickered: STICKERED_SURFACE,
  stickerless: STICKERLESS_SURFACE,
};
/** The outermost surface over both styles (for the floor and framing). */
export const MAX_SURFACE_OFFSET = Math.max(STICKERED_SURFACE, STICKERLESS_SURFACE);

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

export class CubeVisuals {
  readonly tier: RenderTier;
  readonly finish: Finish;
  /** Real-time shadows are cast on the high tier only. */
  readonly shadows: boolean;
  readonly label = new THREE.PlaneGeometry(0.46, 0.46);
  readonly labelMaterials: Readonly<Record<Face, THREE.Material>>;
  #stickered: StickeredResources | null = null;
  #stickerless: StickerlessResources | null = null;
  #textures: THREE.Texture[] = [];
  #disposed = false;

  constructor(tier: RenderTier, finish: Finish) {
    this.tier = tier;
    this.finish = finish;
    this.shadows = tier === 'high';
    const labelMaterials = {} as Record<Face, THREE.Material>;
    for (const face of FACES) {
      const map = labelTexture(face);
      this.#textures.push(map);
      labelMaterials[face] = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
    }
    this.labelMaterials = labelMaterials;
  }

  /** The Classic Stickered set, created on first use. */
  get stickered(): StickeredResources {
    this.#stickered ??= createStickeredResources(this.tier, this.finish);
    return this.#stickered;
  }

  /** The Premium Stickerless set, created on first use. */
  get stickerless(): StickerlessResources {
    this.#stickerless ??= createStickerlessResources(this.tier, this.finish);
    return this.#stickerless;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stickered?.dispose();
    this.#stickerless?.dispose();
    this.label.dispose();
    for (const face of FACES) this.labelMaterials[face].dispose();
    this.#textures.forEach((t) => t.dispose());
  }
}
