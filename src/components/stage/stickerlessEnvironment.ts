/** Stickerless Gloss illumination; the Classic scene environment is untouched. */
import * as THREE from 'three';
import { HOME_POSE, sphericalPosition } from './orbitRig';

const WINDOW = { position: [-3, 5, -4], size: [10, 6], radiance: 5.2, room: 1.2 } as const;

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
  const pmrem = new THREE.PMREMGenerator(renderer);
  const diffuse = pmrem.fromScene(scene, 0, 0.1, 80, { size });
  const window = new THREE.Mesh(new THREE.PlaneGeometry(...WINDOW.size),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#fffaf0').multiplyScalar(WINDOW.radiance), side: THREE.DoubleSide }));
  window.position.copy(stickerlessWindowPosition());
  window.lookAt(0, 0, 0);
  scene.add(window);
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
