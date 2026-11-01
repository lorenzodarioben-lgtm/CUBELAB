/**
 * Stage look preparation (`src/components/stage/lookPreparation.ts`): the light
 * rig and map sizes each look compiles with, which looks are prepared ahead,
 * background compile readiness, and which resources are kept.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LookPreparer, compileInBackground, lookLighting, looksAhead } from '../../src/components/stage/lookPreparation';
import type { StageLook } from '../../src/components/stage/lookPreparation';

interface Compiled {
  readonly lights: string[];
  readonly shadowMap: boolean;
  readonly environment: number | null;
  readonly materials: THREE.Material[];
  readonly envMaps: Array<number | null>;
}

const height = (texture: THREE.Texture | null | undefined) => (texture ? (texture.image as { height: number }).height : null);

/** Just enough of a WebGLRenderer: `compile` gives each material a program whose readiness the test decides. */
function fakeRenderer() {
  const properties = new WeakMap<object, { currentProgram?: { isReady(): boolean } }>();
  const ready = new Set<THREE.Material>();
  const compiled: Compiled[] = [];
  let lost = false;
  const get = (object: object) => {
    let entry = properties.get(object);
    if (!entry) properties.set(object, (entry = {}));
    return entry;
  };
  const renderer = {
    shadowMap: { enabled: false },
    properties: { get },
    getContext: () => ({ isContextLost: () => lost }),
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: () => undefined,
    compile(scene: THREE.Scene) {
      const materials = new Set<THREE.Material>();
      const lights: string[] = [];
      scene.traverse((object) => {
        const light = object as THREE.DirectionalLight;
        if (light.isLight) lights.push(`${light.type}${light.castShadow ? ' (shadow)' : ''}`);
        const material = (object as THREE.Mesh).material as THREE.Material | undefined;
        if (material) materials.add(material);
      });
      for (const material of materials) get(material).currentProgram = { isReady: () => ready.has(material) };
      compiled.push({
        lights,
        shadowMap: renderer.shadowMap.enabled,
        environment: height(scene.environment),
        materials: [...materials],
        envMaps: [...materials].map((m) => height((m as THREE.MeshStandardMaterial).envMap)),
      });
      return materials;
    },
  };
  return {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    compiled,
    ready,
    readyAll: () => compiled.forEach((c) => c.materials.forEach((m) => ready.add(m))),
    lose: () => (lost = true),
  };
}

const look = (style: StageLook['style'], finish: StageLook['finish'], tier: StageLook['tier']): StageLook => ({ style, finish, tier });

describe('look lighting', () => {
  it('matches the stage: Stickerless Gloss has its own maps and key; the rest share the studio', () => {
    expect(lookLighting(look('stickerless', 'gloss', 'high'))).toEqual({ hybrid: true, shadows: true, sceneSize: 256, stickerlessSize: 512 });
    expect(lookLighting(look('stickerless', 'gloss', 'medium'))).toEqual({ hybrid: true, shadows: false, sceneSize: 256, stickerlessSize: 256 });
    expect(lookLighting(look('stickerless', 'gloss', 'low'))).toEqual({ hybrid: true, shadows: false, sceneSize: 128, stickerlessSize: 128 });
    expect(lookLighting(look('stickerless', 'matte', 'high'))).toEqual({ hybrid: false, shadows: true, sceneSize: 256, stickerlessSize: 256 });
    expect(lookLighting(look('stickered', 'gloss', 'low'))).toEqual({ hybrid: false, shadows: false, sceneSize: 128, stickerlessSize: 128 });
  });

  it('prepares only the other style, and on Auto the low tier', () => {
    const shown = look('stickered', 'gloss', 'high');
    expect(looksAhead(shown, false)).toEqual([look('stickerless', 'gloss', 'high')]);
    expect(looksAhead(shown, true)).toEqual([look('stickerless', 'gloss', 'high'), look('stickered', 'gloss', 'low')]);
    expect(looksAhead(look('stickerless', 'matte', 'low'), true)).toEqual([look('stickered', 'matte', 'low')]);
  });
});

describe('background compile', () => {
  it('resolves once every program has linked', async () => {
    vi.useFakeTimers();
    try {
      const gl = fakeRenderer();
      const scene = new THREE.Scene();
      const [a, b] = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
      scene.add(new THREE.Mesh(new THREE.BufferGeometry(), a), new THREE.Mesh(new THREE.BufferGeometry(), b));
      let done = false;
      void compileInBackground(gl.renderer, scene, new THREE.PerspectiveCamera()).then(() => (done = true));
      gl.ready.add(a);
      await vi.advanceTimersByTimeAsync(50);
      expect(done).toBe(false);
      gl.ready.add(b);
      await vi.advanceTimersByTimeAsync(20);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops waiting for freed materials, a lost context, or a driver that never answers', async () => {
    vi.useFakeTimers();
    try {
      const freed = fakeRenderer();
      const scene = new THREE.Scene();
      const material = new THREE.MeshBasicMaterial();
      scene.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
      let done = false;
      void compileInBackground(freed.renderer, scene, new THREE.PerspectiveCamera()).then(() => (done = true));
      delete (freed.renderer.properties.get(material) as { currentProgram?: unknown }).currentProgram;
      await vi.advanceTimersByTimeAsync(20);
      expect(done).toBe(true);

      const lost = fakeRenderer();
      done = false;
      void compileInBackground(lost.renderer, scene, new THREE.PerspectiveCamera()).then(() => (done = true));
      lost.lose();
      await vi.advanceTimersByTimeAsync(20);
      expect(done).toBe(true);

      const silent = fakeRenderer();
      done = false;
      void compileInBackground(silent.renderer, scene, new THREE.PerspectiveCamera()).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(14_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for nothing where three.js does not report what it compiled or how far it got', async () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    const camera = new THREE.PerspectiveCamera();
    const noSet = fakeRenderer();
    (noSet.renderer as unknown as { compile: () => void }).compile = () => undefined;
    await expect(compileInBackground(noSet.renderer, scene, camera)).resolves.toBeUndefined();
    const throws = fakeRenderer();
    (throws.renderer as unknown as { compile: () => never }).compile = () => {
      throw new Error('compile failed');
    };
    await expect(compileInBackground(throws.renderer, scene, camera)).resolves.toBeUndefined();
    // A program without a readiness query: nothing to wait for.
    const noQuery = fakeRenderer();
    const compile = noQuery.renderer.compile.bind(noQuery.renderer);
    (noQuery.renderer as unknown as { compile: typeof compile }).compile = (...args) => {
      const compiled = compile(...args);
      for (const m of compiled) (noQuery.renderer.properties.get(m) as { currentProgram?: object }).currentProgram = {};
      return compiled;
    };
    await expect(compileInBackground(noQuery.renderer, scene, camera)).resolves.toBeUndefined();
  });
});

describe('look preparation', () => {
  // The face-letter textures draw on a canvas; a context-less stub is enough here.
  beforeAll(() => {
    (globalThis as Record<string, unknown>).document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  });
  afterAll(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  const prefilters = (gl: ReturnType<typeof fakeRenderer>) =>
    gl.compiled
      .flatMap((c) => c.materials)
      .filter((m): m is THREE.ShaderMaterial => (m as THREE.ShaderMaterial).isShaderMaterial === true)
      .map((m) => `${m.name} ${m.defines.CUBEUV_MAX_MIP}`)
      .sort();

  it('compiles Stickerless Gloss High under its key light, with shadows and maps of its sizes', async () => {
    const gl = fakeRenderer();
    const preparer = new LookPreparer();
    preparer.attach(gl.renderer, new THREE.PerspectiveCamera());
    const ready = preparer.prepare(look('stickerless', 'gloss', 'high'));
    const cube = gl.compiled[0]!;
    expect(cube.lights).toEqual(['DirectionalLight (shadow)']);
    expect(cube.shadowMap).toBe(true);
    expect(gl.renderer.shadowMap.enabled).toBe(false);
    expect(cube.environment).toBe(4 * 256);
    const visuals = preparer.visuals('high', 'gloss');
    const pieces = new Set<THREE.Material>([...visuals.stickerless.materials, visuals.stickerless.coreMaterial]);
    cube.materials.forEach((m, i) => {
      if (pieces.has(m)) expect(cube.envMaps[i]).toBe(4 * 512);
    });
    // The placeholder is gone again: the stage sets the real maps.
    for (const m of pieces) expect((m as THREE.MeshStandardMaterial).envMap).toBeNull();
    // Studio maps at 256 are blurred and convolved; Stickerless's own 512 maps are only convolved.
    expect(prefilters(gl)).toEqual(['PMREMGGXConvolution 8.0', 'PMREMGGXConvolution 9.0', 'SphericalGaussianBlur 8.0']);
    let done = false;
    void ready.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 30));
    expect(done).toBe(false);
    gl.readyAll();
    await ready;
    // Prepared once.
    const compiles = gl.compiled.length;
    await preparer.prepare(look('stickerless', 'gloss', 'high'));
    expect(gl.compiled.length).toBe(compiles);
    preparer.dispose();
  });

  it('compiles Classic Low under the studio lights without shadows', async () => {
    const gl = fakeRenderer();
    const preparer = new LookPreparer();
    preparer.attach(gl.renderer, new THREE.PerspectiveCamera());
    gl.renderer.shadowMap.enabled = true;
    const ready = preparer.prepare(look('stickered', 'matte', 'low'));
    const cube = gl.compiled[0]!;
    expect(cube.lights.sort()).toEqual(['DirectionalLight', 'DirectionalLight', 'HemisphereLight']);
    expect(cube.shadowMap).toBe(false);
    expect(gl.renderer.shadowMap.enabled).toBe(true);
    expect(cube.environment).toBe(4 * 128);
    expect(prefilters(gl)).toEqual(['PMREMGGXConvolution 7.0', 'SphericalGaussianBlur 7.0']);
    gl.readyAll();
    await ready;
    preparer.dispose();
  });

  it('shows a look at once, with the renderer as it was, if preparing it fails', async () => {
    const gl = fakeRenderer();
    const preparer = new LookPreparer();
    preparer.attach(gl.renderer, new THREE.PerspectiveCamera());
    const visuals = preparer.visuals('high', 'gloss');
    visuals.compileStandIns = () => {
      throw new Error('no stand-ins');
    };
    await expect(preparer.prepare(look('stickerless', 'gloss', 'high'))).resolves.toBeUndefined();
    (gl.renderer as unknown as { compile: () => never }).compile = () => {
      throw new Error('compile failed');
    };
    await expect(preparer.prepare(look('stickered', 'matte', 'low'))).resolves.toBeUndefined();
    expect(gl.renderer.shadowMap.enabled).toBe(false);
    preparer.dispose();
  });

  it('prepares no prefilter shaders, and still the cube, without PMREMGenerator internals', async () => {
    const proto = THREE.PMREMGenerator.prototype as unknown as Record<string, unknown>;
    const setSize = proto._setSize;
    delete proto._setSize;
    try {
      const gl = fakeRenderer();
      const preparer = new LookPreparer();
      preparer.attach(gl.renderer, new THREE.PerspectiveCamera());
      const ready = preparer.prepare(look('stickerless', 'gloss', 'high'));
      expect(prefilters(gl)).toEqual([]);
      expect(gl.compiled).toHaveLength(1);
      gl.readyAll();
      await ready;
      preparer.dispose();
    } finally {
      proto._setSize = setSize;
    }
  });

  it('keeps only what nearby looks use', () => {
    const gl = fakeRenderer();
    const preparer = new LookPreparer();
    preparer.attach(gl.renderer, new THREE.PerspectiveCamera());
    const high = look('stickerless', 'gloss', 'high');
    const low = look('stickerless', 'gloss', 'low');
    void preparer.prepare(high);
    void preparer.prepare(low);
    const lowVisuals = preparer.visuals('low', 'gloss');
    const highVisuals = preparer.visuals('high', 'gloss');
    let freed = 0;
    lowVisuals.stickerless.materials[0]!.addEventListener('dispose', () => freed++);
    const filters = gl.compiled.flatMap((c) => c.materials).filter((m) => (m as THREE.ShaderMaterial).isShaderMaterial);
    let filtersFreed = 0;
    for (const m of filters) m.addEventListener('dispose', () => filtersFreed++);
    preparer.keep(high, [look('stickered', 'gloss', 'high')]);
    expect(freed).toBe(1);
    expect(preparer.visuals('high', 'gloss')).toBe(highVisuals);
    expect(preparer.visuals('low', 'gloss')).not.toBe(lowVisuals);
    // The 128 prefilters (blur and GGX) are freed; 256 and 512 stay.
    expect(filtersFreed).toBe(2);
    preparer.dispose();
  });

  it('frees a set once it has been drawn and left, even if it is wanted ahead', () => {
    const gl = fakeRenderer();
    const preparer = new LookPreparer();
    preparer.attach(gl.renderer, new THREE.PerspectiveCamera());
    const high = look('stickered', 'gloss', 'high');
    const low = look('stickered', 'gloss', 'low');
    void preparer.prepare(low);
    const ahead = preparer.visuals('low', 'gloss');
    // Prepared ahead, never drawn: kept.
    preparer.keep(high, [low]);
    expect(preparer.visuals('low', 'gloss')).toBe(ahead);
    // Drawn, then left: freed, so its uploads go; wanted ahead again, it is prepared afresh.
    preparer.keep(low, []);
    let freed = false;
    ahead.stickered.bodyMaterials.edge.addEventListener('dispose', () => (freed = true));
    preparer.keep(high, [low]);
    expect(freed).toBe(true);
    const compiles = gl.compiled.length;
    void preparer.prepare(low);
    expect(gl.compiled.length).toBeGreaterThan(compiles);
    expect(preparer.visuals('low', 'gloss')).not.toBe(ahead);
    preparer.dispose();
  });
});
