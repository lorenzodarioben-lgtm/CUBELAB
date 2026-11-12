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
 * Each style's set is created the first time it is shown or prepared and then
 * kept until the stage no longer needs this tier and finish, so switching back
 * and forth is instant and never recompiles shaders; GPU memory is bounded by
 * the two sets and released in `dispose()`.
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
import type { VisualTurn } from '../../core/engine/cubeEngine';
import { CUBIE_DEFS } from '../../core/puzzle/cubies';
import type { CubieOrientations } from '../../core/puzzle/cubies';
import { STICKERLESS_RENDERER } from './stickerless2/flag';
import type { StickerlessRenderer } from './stickerless2/flag';
import { createStickerlessV2Resources } from './stickerless2/resources';

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
  /** Which Stickerless renderer this set builds (v2 is the opt-in experiment). */
  readonly stickerlessRenderer: StickerlessRenderer;
  /** Real-time shadows are cast on the high tier only. */
  readonly shadows: boolean;
  readonly label = new THREE.PlaneGeometry(0.46, 0.46);
  readonly labelMaterials: Readonly<Record<Face, THREE.Material>>;
  #stickered: StickeredResources | null = null;
  #stickerless: StickerlessResources | null = null;
  #cells: CubieOrientations | null = null;
  #stickerlessEnv: THREE.Texture | null = null;
  #stickerlessDiffuse: THREE.Texture | null = null;
  #textures: THREE.Texture[] = [];
  #disposed = false;

  constructor(tier: RenderTier, finish: Finish, stickerlessRenderer: StickerlessRenderer = STICKERLESS_RENDERER) {
    this.tier = tier;
    this.finish = finish;
    this.stickerlessRenderer = stickerlessRenderer;
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

  /** The Premium Stickerless set (v1, or the experimental v2 when selected), created on first use. */
  get stickerless(): StickerlessResources {
    if (!this.#stickerless) {
      this.#stickerless =
        this.stickerlessRenderer === 'v2' ? createStickerlessV2Resources(this.tier, this.finish) : createStickerlessResources(this.tier, this.finish);
      this.#stickerless.setEnvironment(this.#stickerlessEnv, this.#stickerlessDiffuse);
      if (this.#cells) this.#stickerless.setCells?.(this.#cells);
    }
    return this.#stickerless;
  }

  /**
   * How far the layer turn in flight has opened the cube: 0 when every layer
   * is aligned, 1 at 45°. Both styles light the faces a turn exposes by it.
   */
  /** The stickerless cube's own reflection map (null: use the scene environment). */
  setStickerlessEnvironment(texture: THREE.Texture | null, diffuse: THREE.Texture | null = null): void {
    if (texture === this.#stickerlessEnv && diffuse === this.#stickerlessDiffuse) return;
    this.#stickerlessEnv = texture;
    this.#stickerlessDiffuse = diffuse;
    this.#stickerless?.setEnvironment(texture, diffuse);
  }

  setTurnExposure(value: number): void {
    this.#stickered?.setExposure(value);
    this.#stickerless?.setExposure(value);
  }

  /** The layer turn in flight (only the experimental Stickerless v2 uses it). */
  setTurnState(visual: VisualTurn | null): void {
    this.#stickerless?.setTurn?.(visual);
  }

  /** The puzzle state (only the experimental Stickerless v2 uses it), kept for a set created later. */
  setCubeCells(cubies: CubieOrientations): void {
    this.#cells = cubies;
    this.#stickerless?.setCells?.(cubies);
  }

  /**
   * Stand-ins for `style`'s pieces, core and face letters in a compile-only
   * scene: they share the real geometry and materials, which together decide
   * the shader variant. Until `restore()`, Stickerless reflects `environment`
   * (a placeholder the size of the map it will be drawn with).
   */
  compileStandIns(style: CubeStyle, environment: THREE.Texture): { meshes: THREE.Mesh[]; restore: () => void } {
    const meshes: THREE.Mesh[] = [];
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => meshes.push(new THREE.Mesh(geometry, material));
    let restore = () => {};
    if (style === 'stickered') {
      const res = this.stickered;
      (['corner', 'edge', 'center'] as const).forEach((kind) => add(res.bodies[kind], res.bodyMaterials[kind]));
      const tile = Object.values(res.tiles)[0]!;
      Object.values(res.tileMaterials).flat().forEach((m) => add(tile, m));
      add(res.core, res.coreMaterial);
    } else {
      const res = this.stickerless;
      res.materials.forEach((m, id) => add(res.pieces[CUBIE_DEFS[id]!.kind], m));
      add(res.core, res.coreMaterial);
      res.setEnvironment(environment, environment);
      restore = () => res.setEnvironment(this.#stickerlessEnv, this.#stickerlessDiffuse);
    }
    for (const face of FACES) add(this.label, this.labelMaterials[face]);
    return { meshes, restore };
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
