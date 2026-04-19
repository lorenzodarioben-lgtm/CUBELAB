/**
 * Shared, memoised geometry and materials for the cube — modelled on a modern
 * premium speedcube: molded black plastic pieces with softened edges, tight
 * seams, and slightly raised, bevelled colour tiles sitting inside the flat
 * area of each face. One body geometry, one tile geometry and one material per
 * colour are shared by every piece; everything is disposed on change/unmount.
 *
 * All textures are generated procedurally at runtime (no image assets).
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

export interface CubeResources {
  readonly body: THREE.BufferGeometry;
  readonly sticker: THREE.BufferGeometry;
  readonly label: THREE.BufferGeometry;
  readonly core: THREE.BufferGeometry;
  readonly mark: THREE.BufferGeometry;
  readonly bodyMaterial: THREE.Material;
  readonly coreMaterial: THREE.Material;
  readonly markMaterial: THREE.Material;
  readonly stickerMaterials: Readonly<Record<Face, THREE.Material>>;
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

/** Deterministic value noise so the plastic's micro-roughness is identical on every load. */
function noiseTexture(size: number, base: number, amplitude: number, seed: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // Two octaves of smoothed noise: a soft mottling plus very fine grain.
  const coarse = Array.from({ length: 17 * 17 }, rand);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * (t * t * (3 - 2 * t));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * 16;
      const gy = (y / size) * 16;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const c = (i: number, j: number) => coarse[(j % 17) * 17 + (i % 17)]!;
      const smooth = lerp(lerp(c(ix, iy), c(ix + 1, iy), gx - ix), lerp(c(ix, iy + 1), c(ix + 1, iy + 1), gx - ix), gy - iy);
      const v = base + amplitude * ((smooth - 0.5) * 0.6 + (rand() - 0.5) * 0.4);
      const byte = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * size + x) * 4;
      data[i] = byte;
      data[i + 1] = byte;
      data[i + 2] = byte;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const LABEL_INK: Readonly<Record<Face, string>> = {
  U: 'rgba(20,20,26,0.62)',
  D: 'rgba(40,30,0,0.62)',
  F: 'rgba(255,255,255,0.86)',
  B: 'rgba(255,255,255,0.88)',
  R: 'rgba(255,255,255,0.88)',
  L: 'rgba(40,16,0,0.62)',
};

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function labelTexture(face: Face): THREE.Texture {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = LABEL_INK[face];
    ctx.font = `600 ${size * 0.6}px "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face, size / 2, size * 0.55);
  });
}

/** The CUBELAB mark, pad-printed in a pale grey on the white centre cap. */
function markTexture(): THREE.Texture {
  return canvasTexture((ctx, size) => {
    const k = size / 64;
    ctx.scale(k, k);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(70, 70, 76, 0.34)';
    ctx.beginPath();
    ctx.moveTo(32, 9);
    ctx.lineTo(52, 20.5);
    ctx.lineTo(52, 43.5);
    ctx.lineTo(32, 55);
    ctx.lineTo(12, 43.5);
    ctx.lineTo(12, 20.5);
    ctx.closePath();
    ctx.moveTo(12, 20.5);
    ctx.lineTo(32, 32);
    ctx.lineTo(52, 20.5);
    ctx.moveTo(32, 32);
    ctx.lineTo(32, 55);
    ctx.stroke();
  }, 256);
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
  const mark = new THREE.PlaneGeometry(0.42, 0.42);
  const core = new THREE.SphereGeometry(0.62, high ? 32 : 16, high ? 24 : 12);

  const Material = high ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const textures: THREE.Texture[] = [];

  // Molded plastic: dark, slightly satin, with a faint mottled micro-roughness.
  const roughnessMap = noiseTexture(high ? 256 : 128, gloss ? 0.56 : 0.8, 0.2, 7);
  textures.push(roughnessMap);
  const bodyMaterial = new Material({
    color: '#0b0b0d',
    roughness: 1,
    roughnessMap,
    metalness: 0,
    ...(high
      ? {
          clearcoat: gloss ? 0.32 : 0.06,
          clearcoatRoughness: gloss ? 0.42 : 0.7,
          specularIntensity: 0.55,
          ior: 1.49,
        }
      : {}),
  });

  const coreMaterial = new THREE.MeshStandardMaterial({ color: '#060607', roughness: 0.9, metalness: 0 });

  const stickerMaterials = {} as Record<Face, THREE.Material>;
  const labelMaterials = {} as Record<Face, THREE.Material>;
  for (const face of FACES) {
    stickerMaterials[face] = new Material({
      color: FACE_COLORS[face].hex,
      roughness: gloss ? 0.26 : 0.56,
      metalness: 0,
      ...(high
        ? {
            clearcoat: gloss ? 0.75 : 0.08,
            clearcoatRoughness: gloss ? 0.14 : 0.5,
            specularIntensity: 0.6,
            ior: 1.5,
          }
        : {}),
    });
    const texture = labelTexture(face);
    textures.push(texture);
    labelMaterials[face] = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }

  const markMap = markTexture();
  textures.push(markMap);
  const markMaterial = new THREE.MeshStandardMaterial({
    map: markMap,
    transparent: true,
    depthWrite: false,
    roughness: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  return {
    body,
    sticker,
    label,
    core,
    mark,
    bodyMaterial,
    coreMaterial,
    markMaterial,
    stickerMaterials,
    labelMaterials,
    shadows: tier === 'high',
    dispose() {
      body.dispose();
      sticker.dispose();
      label.dispose();
      core.dispose();
      mark.dispose();
      bodyMaterial.dispose();
      coreMaterial.dispose();
      markMaterial.dispose();
      for (const face of FACES) {
        stickerMaterials[face].dispose();
        labelMaterials[face].dispose();
      }
      textures.forEach((t) => t.dispose());
    },
  };
}
