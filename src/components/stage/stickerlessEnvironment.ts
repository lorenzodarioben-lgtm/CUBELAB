/** Stickerless Gloss illumination; the Classic scene environment is untouched. */
import * as THREE from 'three';
import { HOME_POSE, sphericalPosition } from './orbitRig';

// Approved Open Product Studio (Candidate B): exact tested source parameters.
const WINDOW = { position: [-1, 2.5, 7], size: [8, 4.5], radiance: 3.6, room: 1.4 } as const;

interface Panel {
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number];
  readonly radiance: number;
}

const FILL: readonly Panel[] = [
  { position: [-8, 0, 6], size: [2, 11], radiance: 4.2 },
  { position: [7, 0, -6], size: [2, 11], radiance: 3.8 },
  { position: [3, -5, 8], size: [9, 4], radiance: 0.7 },
];

/** Offscreen lighting emitters only; the cube's geometry and materials are unchanged. */
function emitter(panel: Panel, position = new THREE.Vector3(...panel.position)) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...panel.size),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#fffaf0').multiplyScalar(panel.radiance), side: THREE.DoubleSide }));
  mesh.position.copy(position);
  mesh.lookAt(0, 0, 0);
  return mesh;
}

/** The reviewed photographic source is fixed in the home-view studio frame. */
export function stickerlessWindowPosition(): THREE.Vector3 {
  const forward = new THREE.Vector3(...sphericalPosition(1, HOME_POSE)).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(forward).normalize();
  const up = forward.clone().cross(right).normalize();
  return right.multiplyScalar(WINDOW.position[0]).addScaledVector(up, WINDOW.position[1]).addScaledVector(forward, WINDOW.position[2]);
}

/** First angular moment of the finite window, not an additional light source. */
export function stickerlessWindowIntensity(): number {
  const d2 = WINDOW.position.reduce((sum, x) => sum + x * x, 0), n = 32;
  let sum = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = ((x + 0.5) / n - 0.5) * WINDOW.size[0], v = ((y + 0.5) / n - 0.5) * WINDOW.size[1];
    sum += d2 / (d2 + u * u + v * v) ** 2;
  }
  return WINDOW.radiance * WINDOW.size[0] * WINDOW.size[1] * sum / (n * n);
}

/** Built once per active tier. No per-frame environment captures or new passes. */
export function renderStickerlessEnvironment(renderer: THREE.WebGLRenderer, size: number) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(60, 60, 60),
    ['#909494', '#777772', '#aaa9a3', '#665044', '#898780', '#757572'].map((color) =>
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(WINDOW.room), side: THREE.BackSide })));
  scene.add(room);
  for (const panel of FILL) scene.add(emitter(panel));
  const pmrem = new THREE.PMREMGenerator(renderer);
  // Fill remains in both existing maps; the primary window keeps its existing shadow mask.
  const diffuse = pmrem.fromScene(scene, 0, 0.1, 80, { size });
  scene.add(emitter(WINDOW, stickerlessWindowPosition()));
  const specular = pmrem.fromScene(scene, 0, 0.1, 80, { size });
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    }
  });
  pmrem.dispose();
  return { diffuse, specular, dispose() { diffuse.dispose(); specular.dispose(); } };
}
