/**
 * Classic Stickered style — recovered from the third-pass cube (commit
 * 65bf5ff) and kept as its own physical model: molded black plastic bodies
 * with softened edges and tight seams, carrying slightly raised, bevelled
 * colour tiles that sit inside the flat area of each face.
 *
 * Realism comes from imperfection as much as from shading: the tiles carry a
 * fine orange-peel surface under a smooth coat, each colour has a few barely
 * different moulding variants (tone and sheen), and every tile is seated with
 * a deterministic hair of tilt and offset, so a face reads as nine separate
 * parts catching the light slightly differently. All textures are generated
 * procedurally and deterministically at runtime (no image assets).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { CUBIE_DEFS } from '../../core/puzzle/cubies';
import { FACES } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import type { Finish } from '../../core/persistence/settings';
import type { RenderTier } from './renderTier';

/** Cubie body edge length; the remaining 2.5 % of the lattice spacing is the seam. */
export const BODY_SIZE = 0.975;
/** Edge roundover of each piece — small, like injection-moulded plastic. */
const BODY_RADIUS = 0.06;
/** Tile footprint (before bevel). Tiles stay inside the body's flat area. */
export const TILE_SIZE = 0.79;
const TILE_RADIUS = 0.1;
const TILE_DEPTH = 0.005;
const TILE_BEVEL = 0.009;
/** Distance from a cubie centre to the tile's base plane (seated a hair into the body). */
export const STICKER_OFFSET = BODY_SIZE / 2 - 0.0025;
/** Height of the tile's top surface above its base plane (bevel on both faces). */
export const TILE_TOP = TILE_DEPTH + 2 * TILE_BEVEL;
/** Distance from a cubie centre to the top of its tiles. */
export const STICKERED_SURFACE = STICKER_OFFSET + TILE_TOP;
/** Moulding variants per colour; each tile picks one deterministically. */
export const TILE_VARIANTS = 4;
/** Largest tile tilt (radians, ≈0.45°) and in-plane offset (world units). */
const TILT = 0.008;
const SHIFT = 0.0035;

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
  readonly variant: number;
}

const Z = new THREE.Vector3(0, 0, 1);

/** Every tile's deterministic seat on its piece: nominal pose plus a tiny tilt and shift. */
export const TILE_SEATS: readonly (readonly TileSeat[])[] = (() => {
  const rand = seededRandom(2024);
  return CUBIE_DEFS.map((def) =>
    def.stickers.map((s) => {
      const quaternion = new THREE.Quaternion().setFromUnitVectors(Z, new THREE.Vector3(s.normal[0], s.normal[1], s.normal[2]));
      const angle = rand() * Math.PI * 2;
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0), TILT * Math.sqrt(rand()));
      const shift = new THREE.Vector3((rand() - 0.5) * 2 * SHIFT, (rand() - 0.5) * 2 * SHIFT, 0).applyQuaternion(quaternion);
      return {
        color: s.color,
        position: new THREE.Vector3(s.normal[0], s.normal[1], s.normal[2]).multiplyScalar(STICKER_OFFSET).add(shift),
        quaternion: quaternion.multiply(tilt),
        variant: Math.floor(rand() * TILE_VARIANTS),
      };
    }),
  );
})();

function roundedSquare(size: number, radius: number): THREE.Shape {
  const h = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h + radius, -h);
  shape.lineTo(h - radius, -h);
  shape.absarc(h - radius, -h + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(h, h - radius);
  shape.absarc(h - radius, h - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-h + radius, h);
  shape.absarc(-h + radius, h - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-h, -h + radius);
  shape.absarc(-h + radius, -h + radius, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/**
 * Tileable value noise in [0, 1]: a soft mottling (`cells` per side) plus a
 * very fine grain. Wraps seamlessly, so it can repeat across a surface.
 */
function noiseField(size: number, cells: number, grain: number, seed: number): Float32Array {
  const rand = seededRandom(seed);
  const lattice = Array.from({ length: cells * cells }, rand);
  const at = (i: number, j: number) => lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const tx = smooth(gx - ix);
      const ty = smooth(gy - iy);
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
      const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
      out[y * size + x] = (top + (bottom - top) * ty) * (1 - grain) + rand() * grain;
    }
  }
  return out;
}

function dataTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Greyscale roughness map: `base` ± `amplitude` of mottled noise. */
function roughnessTexture(size: number, base: number, amplitude: number, seed: number): THREE.DataTexture {
  const field = noiseField(size, 16, 0.4, seed);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < field.length; i++) {
    const byte = Math.max(0, Math.min(255, Math.round((base + amplitude * (field[i]! - 0.5)) * 255)));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = byte;
    data[i * 4 + 3] = 255;
  }
  return dataTexture(data, size);
}

/**
 * Tangent-space normal map of a moulded surface: shallow, irregular "orange
 * peel" bumps with a fine grain, derived from a tileable height field.
 */
function orangePeelTexture(size: number, cells: number, seed: number): THREE.DataTexture {
  const h = noiseField(size, cells, 0.35, seed);
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const n = new THREE.Vector3(-dx * 2.2, -dy * 2.2, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, size);
}

export interface StickeredResources {
  readonly body: THREE.BufferGeometry;
  readonly tile: THREE.BufferGeometry;
  readonly core: THREE.BufferGeometry;
  readonly bodyMaterial: THREE.Material;
  readonly coreMaterial: THREE.Material;
  /** `TILE_VARIANTS` materials per colour. */
  readonly tileMaterials: Readonly<Record<Face, readonly THREE.Material[]>>;
  dispose(): void;
}

export function createStickeredResources(tier: RenderTier, finish: Finish): StickeredResources {
  const high = tier !== 'low';
  const gloss = finish === 'gloss';

  const body = new RoundedBoxGeometry(BODY_SIZE, BODY_SIZE, BODY_SIZE, high ? 6 : 3, BODY_RADIUS);

  const tile = new THREE.ExtrudeGeometry(roundedSquare(TILE_SIZE, TILE_RADIUS), {
    depth: TILE_DEPTH,
    bevelEnabled: true,
    bevelThickness: TILE_BEVEL,
    bevelSize: TILE_BEVEL,
    bevelOffset: 0,
    bevelSegments: high ? 5 : 2,
    curveSegments: high ? 10 : 5,
  });
  // Seat the extrusion so its base sits on z = 0 (the bevel starts below by default).
  tile.translate(0, 0, TILE_BEVEL);
  tile.computeVertexNormals();

  // The mechanism's dark core, glimpsed through the seams mid-turn.
  const core = new THREE.SphereGeometry(0.62, high ? 32 : 16, high ? 24 : 12);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.9, metalness: 0 });

  const Material = high ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const textures: THREE.Texture[] = [];
  const track = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  // Molded black plastic: a fine frosted grain (normal map), mottled sheen
  // (roughness map) and a thin coat, so the rounded edges carry soft studio
  // reflections instead of reading as flat black.
  const bodyRoughness = track(roughnessTexture(high ? 256 : 128, gloss ? 0.36 : 0.6, 0.16, 7));
  const bodyNormal = high ? track(orangePeelTexture(256, 32, 11)) : null;
  if (bodyNormal) bodyNormal.repeat.set(3, 3);
  const bodyMaterial = new Material({
    color: '#0c0c0e',
    roughness: 1,
    roughnessMap: bodyRoughness,
    metalness: 0,
    ...(bodyNormal ? { normalMap: bodyNormal, normalScale: new THREE.Vector2(0.06, 0.06) } : {}),
    ...(high ? { clearcoat: gloss ? 0.42 : 0.12, clearcoatRoughness: gloss ? 0.32 : 0.6, specularIntensity: 0.7, ior: 1.49 } : {}),
  });

  // Tiles: an injection-moulded colour part with an orange-peel surface under
  // a smooth coat (gloss) or a satin texture (matte). Tile UVs are the shape's
  // own coordinates (about −0.4…0.4).
  const tileNormal = high ? track(orangePeelTexture(256, 32, 23)) : null;
  if (tileNormal) tileNormal.repeat.set(3.5, 3.5);
  const tileRoughness = track(roughnessTexture(high ? 256 : 128, 0.5, 0.16, 31));
  tileRoughness.repeat.set(1.25, 1.25);

  const rand = seededRandom(97);
  const tileMaterials = {} as Record<Face, THREE.Material[]>;
  const tint = new THREE.Color();
  for (const face of FACES) {
    const variants: THREE.Material[] = [];
    for (let v = 0; v < TILE_VARIANTS; v++) {
      // Tiny, deterministic batch-to-batch differences in tone and sheen.
      tint.set(FACE_COLORS[face].hex).offsetHSL((rand() - 0.5) * 0.008, (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.024);
      const sheen = (rand() - 0.5) * 0.08;
      variants.push(
        new Material({
          color: tint.clone(),
          // The roughness map is centred on 0.5, so this scales it around the finish's target.
          roughness: (gloss ? 0.5 : 1.08) + sheen,
          roughnessMap: tileRoughness,
          metalness: 0,
          ...(tileNormal ? { normalMap: tileNormal, normalScale: new THREE.Vector2(gloss ? 0.035 : 0.06, gloss ? 0.035 : 0.06) } : {}),
          ...(high
            ? { clearcoat: gloss ? 0.85 : 0.1, clearcoatRoughness: gloss ? 0.09 + sheen * 0.3 : 0.45, specularIntensity: 0.65, ior: 1.5 }
            : {}),
        }),
      );
    }
    tileMaterials[face] = variants;
  }

  return {
    body,
    tile,
    core,
    bodyMaterial,
    coreMaterial,
    tileMaterials,
    dispose() {
      body.dispose();
      tile.dispose();
      core.dispose();
      bodyMaterial.dispose();
      coreMaterial.dispose();
      for (const face of FACES) tileMaterials[face].forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
