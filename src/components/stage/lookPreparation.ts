/**
 * Shader preparation for the stage's looks (cube style, finish and render
 * tier), so a new look never stalls the page while its shaders compile.
 *
 * three.js compiles a material on the frame that first draws it, and the
 * driver's compile then blocks the main thread: about 2 s for Stickerless v2's
 * piece shader on a laptop, plus about 0.4 s for each prefilter shader of a new
 * environment-map size. A shader variant depends on far more than the material:
 * the scene's lights, whether they cast shadows, the size of the reflection
 * map, the render target. So a look is prepared exactly as it will be drawn: its
 * own materials and geometry, in a compile-only scene with that look's light rig
 * and placeholder maps of that look's sizes, plus the prefilter shaders those
 * maps are built with. Nothing is drawn or uploaded.
 *
 * Compiling only issues the work. Where the driver reports progress
 * (KHR_parallel_shader_compile: Chromium, WebKit) it then runs off the main
 * thread, and a look is ready once every program has linked. Elsewhere (Firefox
 * today) a look is reported ready at once and the remaining compile, if any,
 * blocks its first frame, as it always did.
 *
 * Preparation only saves time: if it fails, or three.js (pinned at r182) no
 * longer offers what it reads, a look is shown at once and compiles as it is
 * drawn, as it always did.
 *
 * Programs are shared by every material with the same variant, so the prepared
 * sets are kept while a look may be shown (bounded by the caller: the look on
 * screen, the one requested, and the few prepared ahead), and freed after. A
 * set that has been drawn holds uploaded meshes and textures, so once it is off
 * screen it is freed even if wanted again: it is then prepared afresh, and only
 * the set on screen keeps anything on the GPU beyond compiled programs.
 */
import * as THREE from 'three';
import type { CubeStyle, Finish } from '../../core/persistence/settings';
import { CubeVisuals } from '../cube/cubeResources';
import type { RenderTier } from '../cube/cubeResources';

export interface StageLook {
  readonly style: CubeStyle;
  readonly finish: Finish;
  readonly tier: RenderTier;
}

export const lookKey = (look: StageLook): string => `${look.style}/${look.finish}/${look.tier}`;

export const sameLook = (a: StageLook, b: StageLook): boolean => lookKey(a) === lookKey(b);

/** Looks of one tier and finish share their cube resources (both styles live in one `CubeVisuals`). */
const visualsKey = (look: Pick<StageLook, 'tier' | 'finish'>): string => `${look.tier}/${look.finish}`;

/**
 * The light rig and environment maps a look is drawn with. Stickerless Gloss
 * (the hybrid) is lit by one key light and its own maps; everything else by the
 * studio lights and the scene environment, with Stickerless Matte's reflector
 * map at the scene size. The key light casts shadows on the high tier.
 */
export function lookLighting(look: StageLook): { hybrid: boolean; shadows: boolean; sceneSize: number; stickerlessSize: number } {
  const hybrid = look.style === 'stickerless' && look.finish === 'gloss';
  const shadows = look.tier === 'high';
  const sceneSize = look.tier === 'low' ? 128 : 256;
  return { hybrid, shadows, sceneSize, stickerlessSize: hybrid ? (shadows ? 512 : sceneSize) : sceneSize };
}

/**
 * The looks worth preparing while `shown` is on screen: the other cube style
 * (a Settings switch away), and on Auto the low tier a sustained frame drop
 * steps down to. Nothing else is compiled ahead.
 */
export function looksAhead(shown: StageLook, auto: boolean): StageLook[] {
  const looks: StageLook[] = [{ ...shown, style: shown.style === 'stickered' ? 'stickerless' : 'stickered' }];
  if (auto && shown.tier !== 'low') looks.push({ ...shown, tier: 'low' });
  return looks;
}

/** A program as three tracks it (only readiness is read). */
interface ProgramState {
  currentProgram?: { isReady(): boolean };
}

const POLL_MS = 10;
/** A driver that never reports a link (or a lost context) does not hold a look back for longer. */
const GIVE_UP_MS = 15_000;

/**
 * Compiles the materials of `scene` as `scene` lights them and resolves once
 * the driver has linked every program. A material freed or a context lost
 * meanwhile simply stops being waited for. Never rejects: where three.js does
 * not say what it compiled, or how far a program has got, there is nothing to
 * wait for.
 */
export function compileInBackground(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  let pending: Set<THREE.Material>;
  try {
    // three r182 returns the materials it compiled.
    const compiled: unknown = renderer.compile(scene, camera);
    if (!(compiled instanceof Set)) return Promise.resolve();
    pending = compiled as Set<THREE.Material>;
  } catch {
    return Promise.resolve();
  }
  const started = performance.now();
  return new Promise((resolve) => {
    const poll = () => {
      try {
        const lost = renderer.getContext().isContextLost();
        for (const material of pending) {
          const program = (renderer.properties.get(material) as ProgramState).currentProgram;
          if (lost || typeof program?.isReady !== 'function' || program.isReady()) pending.delete(material);
        }
      } catch {
        pending.clear();
      }
      if (pending.size === 0 || performance.now() - started > GIVE_UP_MS) resolve();
      else setTimeout(poll, POLL_MS);
    };
    poll();
  });
}

/** Stands in for a prefiltered map of `size` while compiling: three reads only its mapping and height. */
function placeholderMap(size: number): THREE.Texture {
  const texture = new THREE.Texture();
  texture.mapping = THREE.CubeUVReflectionMapping;
  texture.image = { width: 3 * Math.max(size, 112), height: 4 * size };
  return texture;
}

/** A compile-only scene with the lights `Lighting` shows for a look, and its scene environment. */
function lightRig(look: StageLook): THREE.Scene {
  const { hybrid, shadows, sceneSize } = lookLighting(look);
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight();
  key.castShadow = shadows;
  scene.add(key);
  if (!hybrid) scene.add(new THREE.HemisphereLight(), new THREE.DirectionalLight());
  scene.environment = placeholderMap(sceneSize);
  return scene;
}

/** PMREMGenerator internals (three r182) holding one map size's prefilter shaders. */
interface PmremInternals {
  _setSize?: (cubeSize: number) => void;
  _allocateTargets?: () => THREE.WebGLRenderTarget;
  _blurMaterial?: THREE.Material | null;
  _ggxMaterial?: THREE.Material | null;
}

const flatCamera = new THREE.OrthographicCamera();

/**
 * three's prefilter shaders for environment maps of each size (the blur the
 * studio maps are softened with, and the GGX convolution every map gets),
 * compiled in the background and kept while a look may need them, so building
 * maps never waits for a compile. They are PMREMGenerator's own materials,
 * reached through its internals; if a three.js upgrade removes those, nothing
 * is prepared and the maps compile as they are built, as before.
 */
class PrefilterPrograms {
  readonly #sizes = new Map<number, { generator: THREE.PMREMGenerator; ggx: Promise<void>; blur?: Promise<void> }>();

  prepare(renderer: THREE.WebGLRenderer, size: number, blur: boolean): Promise<void> {
    let entry = this.#sizes.get(size);
    if (!entry) {
      const generator = new THREE.PMREMGenerator(renderer);
      const internals = generator as unknown as PmremInternals;
      try {
        internals._setSize!(size);
        // Creates the shaders for this size; the targets are not allocated on the GPU until drawn into.
        internals._allocateTargets!().dispose();
      } catch {
        generator.dispose();
        return Promise.resolve();
      }
      entry = { generator, ggx: compileFiltering(renderer, internals._ggxMaterial) };
      this.#sizes.set(size, entry);
    }
    if (blur) entry.blur ??= compileFiltering(renderer, (entry.generator as unknown as PmremInternals)._blurMaterial);
    return Promise.all([entry.ggx, entry.blur]).then(() => undefined);
  }

  keep(sizes: ReadonlySet<number>): void {
    for (const [size, entry] of this.#sizes) {
      if (sizes.has(size)) continue;
      entry.generator.dispose();
      this.#sizes.delete(size);
    }
  }

  dispose(): void {
    this.keep(new Set());
  }
}

/** Prefilter passes draw into half-float targets (no tone mapping, linear output): compile that variant. */
function compileFiltering(renderer: THREE.WebGLRenderer, material: THREE.Material | null | undefined): Promise<void> {
  if (!material) return Promise.resolve();
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const previous = [renderer.getRenderTarget(), renderer.getActiveCubeFace(), renderer.getActiveMipmapLevel()] as const;
  renderer.setRenderTarget(target);
  try {
    return compileInBackground(renderer, scene, flatCamera);
  } finally {
    renderer.setRenderTarget(...previous);
    target.dispose();
  }
}

/**
 * Owns the stage's cube resources (one `CubeVisuals` per tier and finish) and
 * prepares looks on them. One per stage.
 */
export class LookPreparer {
  #renderer: THREE.WebGLRenderer | null = null;
  #camera: THREE.Camera | null = null;
  readonly #visuals = new Map<string, CubeVisuals>();
  /** Sets that have been on screen (and so hold uploads). */
  readonly #drawn = new Set<string>();
  readonly #prepared = new Map<string, Promise<void>>();
  readonly #prefilter = new PrefilterPrograms();

  attach(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.#renderer = renderer;
    this.#camera = camera;
  }

  /** The resources for a tier and finish, created on first use. */
  visuals(tier: RenderTier, finish: Finish): CubeVisuals {
    const key = visualsKey({ tier, finish });
    let visuals = this.#visuals.get(key);
    if (!visuals) {
      visuals = new CubeVisuals(tier, finish);
      this.#visuals.set(key, visuals);
    }
    return visuals;
  }

  /** Resolves once `look` can be drawn without compiling (at once where that cannot be known). Never rejects. */
  prepare(look: StageLook): Promise<void> {
    const key = lookKey(look);
    const known = this.#prepared.get(key);
    if (known) return known;
    const renderer = this.#renderer;
    const camera = this.#camera;
    if (!renderer || !camera) return Promise.resolve();
    let ready: Promise<void>;
    try {
      ready = this.#compile(renderer, camera, look);
    } catch {
      ready = Promise.resolve();
    }
    this.#prepared.set(key, ready);
    return ready;
  }

  #compile(renderer: THREE.WebGLRenderer, camera: THREE.Camera, look: StageLook): Promise<void> {
    const lighting = lookLighting(look);
    const rig = lightRig(look);
    const { meshes, restore } = this.visuals(look.tier, look.finish).compileStandIns(look.style, placeholderMap(lighting.stickerlessSize));
    rig.add(...meshes);
    // Shadow maps are switched with the tier; the variant follows the renderer's setting.
    const shadowMap = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = lighting.shadows;
    let cube: Promise<void>;
    try {
      cube = compileInBackground(renderer, rig, camera);
    } finally {
      renderer.shadowMap.enabled = shadowMap;
      restore();
    }
    const maps = [this.#prefilter.prepare(renderer, lighting.sceneSize, true)];
    if (lighting.stickerlessSize !== lighting.sceneSize) maps.push(this.#prefilter.prepare(renderer, lighting.stickerlessSize, false));
    return Promise.all([cube, ...maps]).then(() => undefined);
  }

  /**
   * With `shown` on screen, frees the resources and prepared shaders that
   * neither it nor a look in `others` uses, and the sets drawn before but no
   * longer on screen.
   */
  keep(shown: StageLook | null, others: readonly StageLook[]): void {
    const looks = shown ? [shown, ...others] : others;
    const onScreen = shown ? visualsKey(shown) : null;
    if (onScreen) this.#drawn.add(onScreen);
    const wanted = new Set(looks.map(visualsKey));
    const freed = new Set<string>();
    for (const [key, set] of this.#visuals) {
      if (key === onScreen || (wanted.has(key) && !this.#drawn.has(key))) continue;
      set.dispose();
      this.#visuals.delete(key);
      this.#drawn.delete(key);
      freed.add(key);
    }
    const prepared = new Set(looks.map(lookKey));
    for (const key of this.#prepared.keys()) {
      const [, finish, tier] = key.split('/') as [CubeStyle, Finish, RenderTier];
      if (!prepared.has(key) || freed.has(visualsKey({ tier, finish }))) this.#prepared.delete(key);
    }
    const sizes = new Set<number>();
    for (const look of looks) {
      const { sceneSize, stickerlessSize } = lookLighting(look);
      sizes.add(sceneSize).add(stickerlessSize);
    }
    this.#prefilter.keep(sizes);
  }

  /** A restored context starts with no programs: prepare everything again. */
  forgetCompiled(): void {
    this.#prepared.clear();
    this.#prefilter.dispose();
  }

  dispose(): void {
    this.keep(null, []);
  }
}
