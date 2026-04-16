/**
 * Shared, memoised geometry and materials for the 26 cubies. One body
 * geometry, one sticker geometry and one material per colour are reused by
 * every piece; everything is disposed when quality/finish changes or on unmount.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { FACES } from '../../core/puzzle/notation';
import type { Face } from '../../core/puzzle/notation';
import type { Finish } from '../../core/persistence/settings';

/** Lattice spacing between cubie centres (world units). */
export const SPACING = 1;
/** Cubie body edge length; the remainder of SPACING is the seam. */
export const BODY_SIZE = 0.955;
const STICKER_SIZE = 0.8;
const STICKER_RADIUS = 0.13;
/** Distance from a cubie centre to its sticker's base plane. */
export const STICKER_OFFSET = BODY_SIZE / 2 - 0.004;

export interface CubeResources {
  readonly body: THREE.BufferGeometry;
  readonly sticker: THREE.BufferGeometry;
  readonly label: THREE.BufferGeometry;
  readonly bodyMaterial: THREE.Material;
  readonly stickerMaterials: Readonly<Record<Face, THREE.Material>>;
  readonly labelMaterials: Readonly<Record<Face, THREE.Material>>;
  dispose(): void;
}

function roundedSquare(size: number, radius: number): THREE.Shape {
  const h = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h + radius, -h);
  shape.lineTo(h - radius, -h);
  shape.quadraticCurveTo(h, -h, h, -h + radius);
  shape.lineTo(h, h - radius);
  shape.quadraticCurveTo(h, h, h - radius, h);
  shape.lineTo(-h + radius, h);
  shape.quadraticCurveTo(-h, h, -h, h - radius);
  shape.lineTo(-h, -h + radius);
  shape.quadraticCurveTo(-h, -h, -h + radius, -h);
  return shape;
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
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = LABEL_INK[face];
    ctx.font = '600 78px "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(face, 64, 70);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createCubeResources(quality: 'high' | 'low', finish: Finish): CubeResources {
  const high = quality === 'high';
  const gloss = finish === 'gloss';

  const body = new RoundedBoxGeometry(BODY_SIZE, BODY_SIZE, BODY_SIZE, high ? 5 : 2, 0.065);

  const sticker = new THREE.ExtrudeGeometry(roundedSquare(STICKER_SIZE, STICKER_RADIUS), {
    depth: 0.008,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.012,
    bevelSegments: high ? 3 : 1,
    curveSegments: high ? 8 : 4,
  });
  sticker.computeVertexNormals();

  const label = new THREE.PlaneGeometry(0.46, 0.46);

  const Material = high ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;

  const bodyMaterial = new Material({
    color: '#101116',
    roughness: gloss ? 0.34 : 0.7,
    metalness: 0,
    ...(high ? { clearcoat: gloss ? 0.65 : 0.05, clearcoatRoughness: 0.4 } : {}),
  });

  const stickerMaterials = {} as Record<Face, THREE.Material>;
  const labelMaterials = {} as Record<Face, THREE.Material>;
  const textures: THREE.Texture[] = [];
  for (const face of FACES) {
    stickerMaterials[face] = new Material({
      color: FACE_COLORS[face].hex,
      roughness: gloss ? 0.22 : 0.52,
      metalness: 0,
      ...(high ? { clearcoat: gloss ? 1 : 0.12, clearcoatRoughness: gloss ? 0.1 : 0.45 } : {}),
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

  return {
    body,
    sticker,
    label,
    bodyMaterial,
    stickerMaterials,
    labelMaterials,
    dispose() {
      body.dispose();
      sticker.dispose();
      label.dispose();
      bodyMaterial.dispose();
      for (const face of FACES) {
        stickerMaterials[face].dispose();
        labelMaterials[face].dispose();
      }
      textures.forEach((t) => t.dispose());
    },
  };
}
