/**
 * Cube styles: the setting and its migration, the Classic Stickered model
 * (moulded black bodies + shaped stickers), and GPU-resource ownership of both
 * styles. (State preservation across
 * a style change is covered at controller level in studio.test.ts and in the
 * browser suite.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CUBIE_DEFS } from '../../src/core/puzzle/cubies';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/core/persistence/settings';
import { STORAGE_KEYS, createMemoryStore, loadSettings, saveSettings } from '../../src/core/persistence/storage';
import { ANCHOR_OFFSET, MAX_SURFACE_OFFSET, SURFACE_OFFSET } from '../../src/components/cube/cubeResources';
import {
  STICKERED_SHAPE,
  STICKER_HALF,
  STICKER_INSET,
  STICKER_OFFSET,
  TILE_SEATS,
  TILE_VARIANTS,
  createStickeredResources,
  stickerRadii,
} from '../../src/components/cube/stickeredResources';
import { PIECE_DETAIL, createStickerlessResources } from '../../src/components/cube/stickerlessResources';
import { CANONICAL_HOME, PIECE_HALF, STICKERLESS_SHAPE, pieceSdf } from '../../src/components/cube/pieceGeometry';
import { faceletFrame } from '../../src/components/cube/pieceFrames';
import { createPieceMaterial } from '../../src/components/cube/pieceMaterial';

describe('cube style setting', () => {
  it('defaults to Classic Stickered for new users', () => {
    expect(DEFAULT_SETTINGS.cubeStyle).toBe('stickered');
    expect(loadSettings(createMemoryStore()).cubeStyle).toBe('stickered');
  });

  it('migrates settings saved before styles existed without touching anything else', () => {
    const legacy = { ...DEFAULT_SETTINGS, finish: 'matte', turnSpeed: 'snappy', sound: true } as Record<string, unknown>;
    delete legacy.cubeStyle;
    const store = createMemoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ v: 1, data: legacy }) });
    const loaded = loadSettings(store);
    expect(loaded.cubeStyle).toBe('stickered');
    expect(loaded.finish).toBe('matte');
    expect(loaded.turnSpeed).toBe('snappy');
    expect(loaded.sound).toBe(true);
  });

  it('keeps an explicit choice and survives a save/load round trip', () => {
    const store = createMemoryStore();
    saveSettings(store, { ...DEFAULT_SETTINGS, cubeStyle: 'stickerless' });
    expect(loadSettings(store).cubeStyle).toBe('stickerless');
  });

  it('falls back safely on corrupted or unknown values', () => {
    for (const bad of ['STICKERED', 'glass', 42, null, { style: 'stickered' }]) {
      expect(sanitizeSettings({ cubeStyle: bad }).cubeStyle).toBe('stickered');
    }
  });
});

describe('Classic Stickered model', () => {
  it('seats exactly one sticker per facelet, on the right face of the right cubie, shaped like its piece', () => {
    let tiles = 0;
    for (const def of CUBIE_DEFS) {
      const seats = TILE_SEATS[def.id]!;
      expect(seats.map((s) => s.color)).toEqual(def.stickers.map((s) => s.color));
      seats.forEach((seat, i) => {
        tiles++;
        const n = def.stickers[i]!.normal;
        // On its face plane (offset only by the tiny hand-laid shift)…
        expect(seat.position.dot(new THREE.Vector3(...n))).toBeCloseTo(STICKER_OFFSET, 5);
        expect(seat.position.length()).toBeLessThan(STICKER_OFFSET + 0.004);
        // …facing exactly outward (laid flat, turned in-plane by well under a degree)…
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(seat.quaternion);
        expect(facing.angleTo(new THREE.Vector3(...n))).toBeLessThan(1e-6);
        const frame = faceletFrame(n, def.home);
        expect(seat.quaternion.angleTo(frame.quaternion)).toBeLessThan(0.006);
        // …with the outline of its own piece.
        expect(seat.shape).toBe(`${frame.kind}:${frame.mask}`);
        expect(seat.variant).toBeGreaterThanOrEqual(0);
        expect(seat.variant).toBeLessThan(TILE_VARIANTS);
      });
    }
    expect(tiles).toBe(54);
  });

  it('stickers follow the piece outlines: round centres, D-shaped edges, square corners', () => {
    const centre = stickerRadii('center', 0b1111);
    const edge = stickerRadii('edge', faceletFrame([0, 1, 0], [0, 1, 1]).mask);
    const corner = stickerRadii('corner', faceletFrame([0, 1, 0], [1, 1, 1]).mask);
    // Centre: every corner cut nearly to a circle.
    for (const r of centre) expect(r).toBeGreaterThan(STICKER_HALF * 0.9);
    // Edge: two large cuts toward the centre, two small corners at the cube edge.
    expect(edge.filter((r) => r > 0.25)).toHaveLength(2);
    expect(edge.filter((r) => r < 0.1)).toHaveLength(2);
    // Corner: all four nearly square.
    for (const r of corner) expect(r).toBeLessThan(0.1);
  });

  it('stickers sit on the flat of the body: inside its rounded rims, with a black border all round', () => {
    expect(STICKER_INSET).toBeGreaterThan(0.06);
    expect(STICKER_HALF).toBeLessThan(PIECE_HALF - STICKERED_SHAPE.rimRadius);
    // The cube's rounded outer edge starts no more than a hair inside the sticker (surface drop < base embed).
    const overhang = STICKER_HALF - (PIECE_HALF - STICKERED_SHAPE.cubeEdgeRadius);
    const r = STICKERED_SHAPE.cubeEdgeRadius;
    const drop = overhang > 0 ? r - Math.sqrt(r * r - overhang * overhang) : 0;
    expect(drop).toBeLessThan(PIECE_HALF - STICKER_OFFSET);
    // Every point under a sticker (inside its outline), just below its base, is solid body: no sticker floats.
    for (const kind of ['corner', 'edge', 'center'] as const) {
      const home = CANONICAL_HOME[kind];
      const sdf = pieceSdf(home, STICKERED_SHAPE);
      const frame = faceletFrame([0, 1, 0], home);
      const radii = stickerRadii(kind, frame.mask);
      // On the +Y face the facelet frame's x is world z and its y is world x.
      const insideSticker = (fx: number, fy: number) => {
        const r = radii[fx > 0 ? (fy > 0 ? 0 : 1) : fy > 0 ? 2 : 3]!;
        const qx = Math.abs(fx) - STICKER_HALF + r;
        const qy = Math.abs(fy) - STICKER_HALF + r;
        return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r < -0.002;
      };
      let checked = 0;
      for (let i = -10; i <= 10; i++) {
        for (let j = -10; j <= 10; j++) {
          const fx = (i / 10) * STICKER_HALF;
          const fy = (j / 10) * STICKER_HALF;
          if (!insideSticker(fx, fy)) continue;
          checked++;
          expect(sdf(fy, STICKER_OFFSET - 0.0005, fx), `${kind} ${fx} ${fy}`).toBeLessThan(0);
        }
      }
      expect(checked).toBeGreaterThan(250);
    }
    expect(SURFACE_OFFSET.stickered).toBeGreaterThan(PIECE_HALF);
    expect(MAX_SURFACE_OFFSET).toBe(Math.max(SURFACE_OFFSET.stickered, SURFACE_OFFSET.stickerless));
    expect(ANCHOR_OFFSET).toBe(0.5);
  });

  it('the stickered body design is its own: flat faces, rounder outer edges; stickerless is untouched', () => {
    expect(STICKERED_SHAPE.id).not.toBe(STICKERLESS_SHAPE.id);
    expect(STICKERED_SHAPE.pillow).toBe(0);
    expect(STICKERED_SHAPE.cubeEdgeRadius).toBeGreaterThan(STICKERLESS_SHAPE.cubeEdgeRadius);
    expect(STICKERLESS_SHAPE).toEqual({
      id: 'stickerless',
      innerRadius: { center: 0.37, edge: 0.37, corner: 0.08 },
      rimRadius: 0.055,
      pillow: 0.018,
      cubeEdgeRadius: 0.075,
    });
  });

  it('body material: honeycomb interior and turn-driven seam shading, stickerless defaults unchanged', () => {
    const shader = (material: THREE.Material) => {
      const lib = THREE.ShaderLib.physical;
      const s = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, { value: unknown }> };
      material.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      return s;
    };
    const res = createStickeredResources('high', 'gloss');
    const body = res.bodyMaterials.edge;
    expect(body.defines).toHaveProperty('PIECE_HONEYCOMB');
    const s = shader(body);
    expect(s.fragmentShader).toContain('pieceHex(');
    expect(s.fragmentShader).toContain('normal = pieceBump(');
    // Exposure is shared by every body and driven by the turn in flight.
    res.setExposure(0.7);
    expect(s.uniforms.uExposure!.value).toBe(0.7);
    expect((shader(res.bodyMaterials.corner).uniforms.uExposure!.value as number)).toBe(0.7);
    res.dispose();
    // A stickerless piece: no honeycomb, no exposure, the same occlusion as before.
    const piece = createPieceMaterial([new THREE.Color('#fff'), null, null, null, null, null], { tier: 'high', finish: 'gloss' }, 1);
    expect(piece.defines ?? {}).not.toHaveProperty('PIECE_HONEYCOMB');
    const u = shader(piece).uniforms;
    expect(u.uExposure!.value).toBe(0);
    expect(u.uCavityMin!.value).toBe(0.12);
    expect((u.uSeamFloor!.value as THREE.Vector4).toArray()).toEqual([0.6, 0.22, 0.45, 0.03]);
    expect((u.uSeamRange!.value as THREE.Vector2).toArray()).toEqual([0.08, 0.6]);
    piece.dispose();
  });
});

/** Counts `dispose` events on everything a resource set owns. */
function watchDisposals(objects: ReadonlyArray<{ addEventListener: (type: 'dispose', fn: () => void) => void }>): () => number {
  let count = 0;
  for (const o of objects) o.addEventListener('dispose', () => count++);
  return () => count;
}

describe('GPU resource ownership', () => {
  it('stickered: one set owns and frees its materials and stickers, and shares its body meshes', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      const res = createStickeredResources(tier, 'gloss');
      const materials = [...Object.values(res.bodyMaterials), res.coreMaterial, ...Object.values(res.tileMaterials).flat()];
      for (const m of materials) {
        for (const key of ['map', 'roughnessMap', 'normalMap'] as const) expect((m as THREE.MeshStandardMaterial)[key] ?? null).toBeNull();
      }
      // Nine sticker outlines: one centre, four edge and four corner orientations.
      expect(Object.keys(res.tiles)).toHaveLength(9);
      const owned = [...Object.values(res.tiles), res.core, ...materials];
      const disposed = watchDisposals(owned);
      const bodiesDisposed = watchDisposals(Object.values(res.bodies));
      res.dispose();
      expect(disposed()).toBe(owned.length);
      // The cached body meshes are released (GPU) by their last user.
      expect(bodiesDisposed()).toBe(3);
      res.dispose(); // idempotent
      expect(disposed()).toBe(owned.length);
    }
  });

  it('stickered and stickerless body meshes are distinct cache entries', () => {
    const a = createStickeredResources('low', 'gloss');
    const b = createStickerlessResources('low', 'gloss');
    expect(a.bodies.center).not.toBe(b.pieces.center);
    a.dispose();
    b.dispose();
  });

  it('stickerless: piece meshes are shared and freed only when the last user lets go', () => {
    const first = createStickerlessResources('medium', 'gloss');
    const second = createStickerlessResources('medium', 'matte');
    // Same tier → the very same canonical meshes (no second ~80 ms build).
    expect(second.pieces.corner).toBe(first.pieces.corner);
    const disposedPieces = watchDisposals(Object.values(first.pieces));
    const disposedMaterials = watchDisposals([...first.materials, first.core, first.coreMaterial]);
    first.dispose();
    expect(disposedMaterials()).toBe(first.materials.length + 2);
    expect(disposedPieces()).toBe(0); // still in use by `second`
    first.dispose(); // idempotent: must not release twice
    expect(disposedPieces()).toBe(0);
    second.dispose();
    expect(disposedPieces()).toBe(3);
    // A later set reuses the cached CPU meshes; they simply upload again.
    const third = createStickerlessResources('medium', 'gloss');
    expect(third.pieces.edge).toBe(first.pieces.edge);
    third.dispose();
  });

  it('stickerless meshes get finer with the tier', () => {
    expect(PIECE_DETAIL.high).toBeGreaterThan(PIECE_DETAIL.medium);
    expect(PIECE_DETAIL.medium).toBeGreaterThan(PIECE_DETAIL.low);
    const high = createStickerlessResources('high', 'gloss');
    const low = createStickerlessResources('low', 'gloss');
    expect(high.pieces.center.getAttribute('position').count).toBeGreaterThan(low.pieces.center.getAttribute('position').count);
    high.dispose();
    low.dispose();
  });
});

describe('Premium Stickerless realism', () => {
  const definesOf = (m: THREE.Material) =>
    Object.keys((m as THREE.MeshStandardMaterial).defines ?? {})
      .filter((d) => d.startsWith('PIECE_'))
      .sort();

  it('stickerless pieces get the parting line, track, waviness and honeycomb; the stickered bodies only their honeycomb', () => {
    const high = createStickerlessResources('high', 'gloss');
    high.materials.forEach((m, id) => expect(definesOf(m)).toEqual([
      'PIECE_CAP_SEAM', ...(CUBIE_DEFS[id]!.kind === 'center' ? ['PIECE_CONTINUOUS_CENTRE'] : []),
      'PIECE_HONEYCOMB', 'PIECE_RIM_NORMALS', 'PIECE_TRACK', 'PIECE_WAVY',
    ]));
    // Low tier keeps the cheap parting line only (bump details need the physical tiers).
    const low = createStickerlessResources('low', 'gloss');
    for (const m of low.materials) expect(definesOf(m)).toEqual(['PIECE_CAP_SEAM']);
    const stickered = createStickeredResources('high', 'gloss');
    for (const m of Object.values(stickered.bodyMaterials)) {
      expect(definesOf(m)).toEqual(['PIECE_HONEYCOMB']);
      // No per-material reflection strength: it rides on the scene environment exactly as before.
      expect((m as THREE.MeshStandardMaterial).envMapIntensity).toBe(1);
    }
    for (const r of [high, low, stickered]) r.dispose();
  });

  it('isolates rim-normal shaders and uniforms to opted-in physical materials', () => {
    const slots = [new THREE.Color('#ffffff'), null, null, null, null, null];
    const look = { tier: 'high', finish: 'gloss' } as const;
    const rimNormals = { home: CANONICAL_HOME.center, shape: STICKERLESS_SHAPE };
    const legacy = createPieceMaterial(slots, look, 1);
    const corrected = createPieceMaterial(slots, look, 1, { rimNormals });
    const low = createPieceMaterial(slots, { ...look, tier: 'low' }, 1, { rimNormals });
    const compile = (m: THREE.Material) => {
      const shader = {
        vertexShader: THREE.ShaderLib.physical.vertexShader,
        fragmentShader: THREE.ShaderLib.physical.fragmentShader,
        uniforms: {} as Record<string, { value: unknown }>,
      };
      m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      return shader;
    };
    const oldShader = compile(legacy);
    const newShader = compile(corrected);
    expect(legacy.customProgramCacheKey()).toBe('cubelab-piece-physical');
    expect(corrected.customProgramCacheKey()).not.toBe(legacy.customProgramCacheKey());
    expect(newShader.vertexShader).toBe(oldShader.vertexShader);
    expect(oldShader.fragmentShader).not.toContain('pieceAnalyticRimNormal');
    expect(oldShader.uniforms).not.toHaveProperty('uRimProfile');
    expect(compile(low).fragmentShader).not.toContain('pieceAnalyticRimNormal');
    expect((newShader.uniforms.uRimProfile!.value as THREE.Vector4).toArray()).toEqual([
      PIECE_HALF, STICKERLESS_SHAPE.rimRadius, STICKERLESS_SHAPE.innerRadius.center, STICKERLESS_SHAPE.pillow,
    ]);
    expect(newShader.fragmentShader).toContain('normalMatrix * pieceAnalyticRimNormal');
    expect(newShader.fragmentShader).toContain('nonPerturbedNormal = normal;');
    for (const m of [legacy, corrected, low]) m.dispose();
  });

  it('every piece has its own, stable finish (tiny deterministic variation)', () => {
    const a = createStickerlessResources('medium', 'gloss');
    const b = createStickerlessResources('medium', 'gloss');
    const rough = (r: typeof a) => r.materials.map((m) => (m as THREE.MeshPhysicalMaterial).roughness);
    const coat = (r: typeof a) => r.materials.map((m) => (m as THREE.MeshPhysicalMaterial).clearcoatRoughness);
    expect(rough(a)).toEqual(rough(b)); // never changes between builds or renders
    expect(new Set(rough(a)).size).toBeGreaterThan(20); // but differs piece to piece
    for (const r of rough(a)) expect(Math.abs(r / 0.13 - 1)).toBeLessThanOrEqual(0.07 + 1e-9);
    for (const c of coat(a)) expect(Math.abs(c / 0.14 - 1)).toBeLessThanOrEqual(0.2 + 1e-9);
    a.dispose();
    b.dispose();
  });

  it('uses its own reflection map when the stage provides one, and shares the turn exposure', () => {
    const res = createStickerlessResources('high', 'gloss');
    const texture = new THREE.Texture();
    res.setEnvironment(texture);
    for (const m of res.materials) expect((m as THREE.MeshStandardMaterial).envMap).toBe(texture);
    res.setEnvironment(null);
    for (const m of res.materials) expect((m as THREE.MeshStandardMaterial).envMap).toBeNull();
    const lib = THREE.ShaderLib.physical;
    const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, { value: unknown }> };
    res.materials[4]!.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('uPieceHome');
    expect(shader.fragmentShader).toContain('pieceTop');
    res.setExposure(0.6);
    expect(shader.uniforms.uExposure!.value).toBe(0.6);
    res.dispose();
  });
});

describe('resource disposal never races background shader compilation', () => {
  // The face-letter textures draw on a canvas; a context-less stub is enough here.
  beforeAll(() => {
    (globalThis as Record<string, unknown>).document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  });
  afterAll(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it('waits for an in-flight compile before freeing anything, then frees everything once', async () => {
    const { CubeVisuals } = await import('../../src/components/cube/cubeResources');
    const visuals = new CubeVisuals('medium', 'gloss');
    const materials = visuals.stickerless.materials;
    let disposed = 0;
    for (const m of materials) m.addEventListener('dispose', () => disposed++);
    let finish!: () => void;
    visuals.trackCompile(new Promise<void>((resolve) => (finish = resolve)));
    visuals.dispose();
    await Promise.resolve();
    expect(disposed).toBe(0); // still compiling: nothing freed yet
    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(disposed).toBe(materials.length);
    visuals.dispose(); // idempotent
    await new Promise((r) => setTimeout(r, 0));
    expect(disposed).toBe(materials.length);
  });

  it('a failed compile still lets disposal happen', async () => {
    const { CubeVisuals } = await import('../../src/components/cube/cubeResources');
    const visuals = new CubeVisuals('low', 'matte');
    const material = visuals.stickered.bodyMaterials.edge;
    let freed = false;
    material.addEventListener('dispose', () => (freed = true));
    visuals.trackCompile(Promise.reject(new Error('lost context')));
    visuals.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(freed).toBe(true);
  });
});
