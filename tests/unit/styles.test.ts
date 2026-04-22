/**
 * Cube styles: the setting and its migration, the recovered Classic Stickered
 * model, and GPU-resource ownership of both styles. (State preservation across
 * a style change is covered at controller level in studio.test.ts and in the
 * browser suite.)
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CUBIE_DEFS } from '../../src/core/puzzle/cubies';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/core/persistence/settings';
import { STORAGE_KEYS, createMemoryStore, loadSettings, saveSettings } from '../../src/core/persistence/storage';
import { ANCHOR_OFFSET, MAX_SURFACE_OFFSET, SURFACE_OFFSET } from '../../src/components/cube/cubeResources';
import { BODY_SIZE, STICKER_OFFSET, TILE_SEATS, TILE_SIZE, TILE_VARIANTS, createStickeredResources } from '../../src/components/cube/stickeredResources';
import { PIECE_DETAIL, createStickerlessResources } from '../../src/components/cube/stickerlessResources';

describe('cube style setting', () => {
  it('defaults to Premium Stickerless for new users', () => {
    expect(DEFAULT_SETTINGS.cubeStyle).toBe('stickerless');
    expect(loadSettings(createMemoryStore()).cubeStyle).toBe('stickerless');
  });

  it('migrates settings saved before styles existed without touching anything else', () => {
    const legacy = { ...DEFAULT_SETTINGS, finish: 'matte', turnSpeed: 'snappy', sound: true } as Record<string, unknown>;
    delete legacy.cubeStyle;
    const store = createMemoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ v: 1, data: legacy }) });
    const loaded = loadSettings(store);
    expect(loaded.cubeStyle).toBe('stickerless');
    expect(loaded.finish).toBe('matte');
    expect(loaded.turnSpeed).toBe('snappy');
    expect(loaded.sound).toBe(true);
  });

  it('keeps an explicit choice and survives a save/load round trip', () => {
    const store = createMemoryStore();
    saveSettings(store, { ...DEFAULT_SETTINGS, cubeStyle: 'stickered' });
    expect(loadSettings(store).cubeStyle).toBe('stickered');
  });

  it('falls back safely on corrupted or unknown values', () => {
    for (const bad of ['STICKERED', 'glass', 42, null, { style: 'stickered' }]) {
      expect(sanitizeSettings({ cubeStyle: bad }).cubeStyle).toBe('stickerless');
    }
  });
});

describe('Classic Stickered model (recovered)', () => {
  it('seats exactly one tile per facelet, on the right face of the right cubie', () => {
    let tiles = 0;
    for (const def of CUBIE_DEFS) {
      const seats = TILE_SEATS[def.id]!;
      expect(seats.map((s) => s.color)).toEqual(def.stickers.map((s) => s.color));
      seats.forEach((seat, i) => {
        tiles++;
        const n = def.stickers[i]!.normal;
        // On its face plane (offset only by the tiny in-plane shift)…
        expect(seat.position.dot(new THREE.Vector3(...n))).toBeCloseTo(STICKER_OFFSET, 5);
        expect(seat.position.length()).toBeLessThan(STICKER_OFFSET + 0.006);
        // …facing outward, tilted by well under a degree.
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(seat.quaternion);
        expect(facing.angleTo(new THREE.Vector3(...n))).toBeLessThan(0.0085);
        expect(seat.variant).toBeGreaterThanOrEqual(0);
        expect(seat.variant).toBeLessThan(TILE_VARIANTS);
      });
    }
    expect(tiles).toBe(54);
  });

  it('keeps tiles inside the body face and the seams open', () => {
    expect(TILE_SIZE).toBeLessThan(BODY_SIZE - 0.12);
    expect(BODY_SIZE).toBeLessThan(1);
    // Tiles sit on the body; the visible surface is just above the stickerless one.
    expect(SURFACE_OFFSET.stickered).toBeGreaterThan(BODY_SIZE / 2);
    expect(MAX_SURFACE_OFFSET).toBe(Math.max(SURFACE_OFFSET.stickered, SURFACE_OFFSET.stickerless));
    expect(ANCHOR_OFFSET).toBe(0.5);
  });
});

/** Counts `dispose` events on everything a resource set owns. */
function watchDisposals(objects: ReadonlyArray<{ addEventListener: (type: 'dispose', fn: () => void) => void }>): () => number {
  let count = 0;
  for (const o of objects) o.addEventListener('dispose', () => count++);
  return () => count;
}

describe('GPU resource ownership', () => {
  it('stickered: one set owns and frees all of its geometry, materials and textures', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      const res = createStickeredResources(tier, 'gloss');
      const materials = [res.bodyMaterial, res.coreMaterial, ...Object.values(res.tileMaterials).flat()];
      const textures = new Set<THREE.Texture>();
      for (const m of materials) {
        for (const key of ['map', 'roughnessMap', 'normalMap'] as const) {
          const t = (m as THREE.MeshStandardMaterial)[key];
          if (t) textures.add(t);
        }
      }
      const owned = [res.body, res.tile, res.core, ...materials, ...textures];
      const disposed = watchDisposals(owned);
      res.dispose();
      expect(disposed()).toBe(owned.length);
    }
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
