/** Stickerless Gloss illumination; the Classic scene environment is untouched. */
import * as THREE from 'three';
import { HOME_POSE, sphericalPosition } from './orbitRig';

// Approved Open Product Studio (Candidate B): exact tested source parameters.
const WINDOW = { position: [-1, 2.5, 7], size: [8, 4.5], radiance: 3.6, room: 1.4 } as const;

export interface Panel {
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly radiance: number;
  /** Emitter colour (default the production studio's warm white). */
  readonly tint?: string;
  /**
   * Soft edge: the fraction of each half-size over which the panel fades out,
   * as a diffused softbox's front does. 0 or absent is a hard-edged panel.
   */
  readonly falloff?: number;
  /** Fraction by which the panel dims from its top edge to its bottom edge (a graded softbox). */
  readonly grade?: number;
}

/** The room the studio sits in: one colour per box side (+x, −x, +y, −y, +z, −z) and their radiance. */
export interface Room {
  readonly colors: readonly [string, string, string, string, string, string];
  readonly radiance: number;
}

/** Optional parts of a studio (Stickerless v2's studio only; v1 passes none). */
export interface StudioOptions {
  /** The key softbox, in the home view's camera frame, replacing the production window. */
  readonly key?: Panel;
  /** Whether the production fill strips are part of the studio (default true). */
  readonly fill?: boolean;
}

/** Production's room: grey walls, a lighter ceiling and a brown floor. */
export const PRODUCTION_ROOM: Room = { colors: ['#909494', '#777772', '#aaa9a3', '#665044', '#898780', '#757572'], radiance: WINDOW.room };

const FILL: readonly Panel[] = [
  { position: [-8, 0, 6], size: [2, 11], radiance: 4.2 },
  { position: [7, 0, -6], size: [2, 11], radiance: 3.8 },
  { position: [3, -5, 8], size: [9, 4], radiance: 0.7 },
];

/** How much of a soft panel's radiance reaches (u, v) on its front (1 everywhere on a hard panel). */
function softness(panel: Panel, u: number, v: number): number {
  const edge = (w: number) => {
    const t = Math.min(1, (1 - Math.abs(2 * w - 1)) / Math.max(panel.falloff ?? 0, 1e-3));
    return t * t * (3 - 2 * t);
  };
  return edge(u) * edge(v) * (1 - (panel.grade ?? 0) * (1 - v));
}

/** A soft panel's front as a texture (linear values, multiplied into its colour). */
function softTexture(panel: Panel): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const value = Math.round(255 * softness(panel, (x + 0.5) / n, (y + 0.5) / n));
      data.set([value, value, value, 255], (y * n + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Offscreen lighting emitters only; the cube's geometry and materials are unchanged. */
function emitter(panel: Panel, position = new THREE.Vector3(...panel.position)) {
  const soft = panel.falloff || panel.grade ? softTexture(panel) : null;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...panel.size),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(panel.tint ?? '#fffaf0').multiplyScalar(panel.radiance), map: soft, side: THREE.DoubleSide }));
  mesh.position.copy(position);
  mesh.lookAt(0, 0, 0);
  return mesh;
}

/** A point given in the home view's camera frame (right, up, toward the camera), in the studio's world frame. */
export function fromHomeCamera(position: readonly [number, number, number]): THREE.Vector3 {
  const forward = new THREE.Vector3(...sphericalPosition(1, HOME_POSE)).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(forward).normalize();
  const up = forward.clone().cross(right).normalize();
  return right.multiplyScalar(position[0]).addScaledVector(up, position[1]).addScaledVector(forward, position[2]);
}

/** The reviewed photographic source (or v2's key) is fixed in the home-view studio frame. */
export function stickerlessWindowPosition(key: Panel = WINDOW): THREE.Vector3 {
  return fromHomeCamera(key.position);
}

/** First angular moment of the finite window (or key), not an additional light source. */
export function stickerlessWindowIntensity(key: Panel = WINDOW): number {
  const d2 = key.position.reduce((sum, x) => sum + x * x, 0), n = 32;
  let sum = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = ((x + 0.5) / n - 0.5) * key.size[0], v = ((y + 0.5) / n - 0.5) * key.size[1];
    const weight = d2 / (d2 + u * u + v * v) ** 2;
    sum += key.falloff || key.grade ? weight * softness(key, (x + 0.5) / n, (y + 0.5) / n) : weight;
  }
  return key.radiance * key.size[0] * key.size[1] * sum / (n * n);
}

/**
 * Built once per active tier. No per-frame environment captures or new passes.
 * `extra` adds panels to both maps, `room` replaces the room and `options`
 * replace the window or drop the fill (all used only by Stickerless v2's
 * studio; v1 passes none of them).
 */
export function renderStickerlessEnvironment(renderer: THREE.WebGLRenderer, size: number, extra: readonly Panel[] = [], room: Room = PRODUCTION_ROOM, options: StudioOptions = {}) {
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(60, 60, 60),
    room.colors.map((color) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(room.radiance), side: THREE.BackSide })));
  scene.add(box);
  for (const panel of [...(options.fill === false ? [] : FILL), ...extra]) scene.add(emitter(panel));
  const pmrem = new THREE.PMREMGenerator(renderer);
  // Fill remains in both existing maps; the primary window keeps its existing shadow mask.
  const diffuse = pmrem.fromScene(scene, 0, 0.1, 80, { size });
  const key = options.key ?? WINDOW;
  scene.add(emitter(key, stickerlessWindowPosition(key)));
  const specular = pmrem.fromScene(scene, 0, 0.1, 80, { size });
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      }
    }
  });
  pmrem.dispose();
  return { diffuse, specular, dispose() { diffuse.dispose(); specular.dispose(); } };
}
