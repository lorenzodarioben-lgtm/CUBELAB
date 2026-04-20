/**
 * Shared, memoised geometry and materials for the cube — modelled on a modern
 * premium speedcube: molded black plastic pieces with softened edges, tight
 * seams, and slightly raised, bevelled colour tiles sitting inside the flat
 * area of each face. One body geometry and one tile geometry are shared by
 * every piece; everything is disposed on change/unmount.
 *
 * Realism comes from imperfection as much as from shading: the tiles carry a
 * fine orange-peel surface under a smooth coat, and each colour has a few
 * barely different moulding variants (tone and sheen), so a face reads as nine
 * separate parts catching the light slightly differently rather than one
 * perfect CG plane. All textures are generated procedurally and
 * deterministically at runtime (no image assets).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { FACES } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import type { Finish } from '../../core/persistence/settings';

/** Lattice spacing between cubie centres (world units). */
export const SPACING = 1;
/** Cubie body edge length; the remaining 2.5 % of SPACING is the seam. */
export const BODY_SIZE = 0.975;
/** Edge roundover of each piece — small, like injection-moulded plastic. */
const BODY_RADIUS = 0.06;
/** Tile footprint (before bevel). Tiles stay inside the body's flat area. */
const TILE_SIZE = 0.79;
const TILE_RADIUS = 0.1;
const TILE_DEPTH = 0.005;
const TILE_BEVEL = 0.009;
/** Distance from a cubie centre to the tile's base plane (seated a hair into the body). */
export const STICKER_OFFSET = BODY_SIZE / 2 - 0.0025;
/** Height of the tile's top surface above its base plane (bevel on both faces). */
export const TILE_TOP = TILE_DEPTH + 2 * TILE_BEVEL;
/** Moulding variants per colour; each tile picks one deterministically. */
export const TILE_VARIANTS = 4;

export interface CubeResources {
  readonly body: THREE.BufferGeometry;
  readonly sticker: THREE.BufferGeometry;
  readonly label: THREE.BufferGeometry;
  readonly core: THREE.BufferGeometry;
  readonly bodyMaterial: THREE.Material;
  readonly coreMaterial: THREE.Material;
  /** `TILE_VARIANTS` materials per colour. */
  readonly stickerMaterials: Readonly<Record<Face, readonly THREE.Material[]>>;
  readonly labelMaterials: Readonly<Record<Face, THREE.Material>>;
  readonly shadows: boolean;
  dispose(): void;
}

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

/** Small deterministic PRNG (LCG) so every load renders the identical cube. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
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

function dataTexture(data: Uint8Array, size: number, colorSpace: THREE.ColorSpace = THREE.NoColorSpace): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = colorSpace;
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
 *  high   — physical materials, full geometry, real-time soft shadows (desktop).
 *  medium — same materials and geometry, no shadow passes (touch devices).
 *  low    — standard materials, coarser geometry, no shadows.
 */
export type RenderTier = 'high' | 'medium' | 'low';

export function createCubeResources(tier: RenderTier, finish: Finish): CubeResources {
  const high = tier !== 'low';
  const gloss = finish === 'gloss';

  const body = new RoundedBoxGeometry(BODY_SIZE, BODY_SIZE, BODY_SIZE, high ? 6 : 3, BODY_RADIUS);

  const sticker = new THREE.ExtrudeGeometry(roundedSquare(TILE_SIZE, TILE_RADIUS), {
    depth: TILE_DEPTH,
    bevelEnabled: true,
    bevelThickness: TILE_BEVEL,
    bevelSize: TILE_BEVEL,
    bevelOffset: 0,
    bevelSegments: high ? 5 : 2,
    curveSegments: high ? 10 : 5,
  });
  // Seat the extrusion so its base sits on z = 0 (the bevel starts below by default).
  sticker.translate(0, 0, TILE_BEVEL);
  sticker.computeVertexNormals();

  const label = new THREE.PlaneGeometry(0.46, 0.46);
  const core = new THREE.SphereGeometry(0.62, high ? 32 : 16, high ? 24 : 12);

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
    ...(high
      ? {
          clearcoat: gloss ? 0.42 : 0.12,
          clearcoatRoughness: gloss ? 0.32 : 0.6,
          specularIntensity: 0.7,
          ior: 1.49,
        }
      : {}),
  });

  const coreMaterial = new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.9, metalness: 0 });

  // Tiles: an injection-moulded colour part with an orange-peel surface under
  // a smooth coat (gloss) or a satin texture (matte). Tile UVs are the shape's
  // own coordinates (about −0.4…0.4), so a repeat of 1.6 spans ~1.3 tiles.
  const tileNormal = high ? track(orangePeelTexture(256, 32, 23)) : null;
  if (tileNormal) tileNormal.repeat.set(3.5, 3.5);
  const tileRoughness = track(roughnessTexture(high ? 256 : 128, 0.5, 0.16, 31));
  tileRoughness.repeat.set(1.25, 1.25);

  const rand = seededRandom(97);
  const stickerMaterials = {} as Record<Face, THREE.Material[]>;
  const labelMaterials = {} as Record<Face, THREE.Material>;
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
            ? {
                clearcoat: gloss ? 0.85 : 0.1,
                clearcoatRoughness: gloss ? 0.09 + sheen * 0.3 : 0.45,
                specularIntensity: 0.65,
                ior: 1.5,
              }
            : {}),
        }),
      );
    }
    stickerMaterials[face] = variants;
    labelMaterials[face] = new THREE.MeshBasicMaterial({
      map: track(labelTexture(face)),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }

  return {
    body,
    sticker,
    label,
    core,
    bodyMaterial,
    coreMaterial,
    stickerMaterials,
    labelMaterials,
    shadows: tier === 'high',
    dispose() {
      body.dispose();
      sticker.dispose();
      label.dispose();
      core.dispose();
      bodyMaterial.dispose();
      coreMaterial.dispose();
      for (const face of FACES) {
        stickerMaterials[face].forEach((m) => m.dispose());
        labelMaterials[face].dispose();
      }
      textures.forEach((t) => t.dispose());
    },
  };
}
