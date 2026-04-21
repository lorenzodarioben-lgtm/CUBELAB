/**
 * Reads the facelets *as rendered*: from each facelet anchor's actual
 * transform in the three.js scene graph (anchors ride on the same cubie groups
 * as the piece meshes), relative to the cube's root (the view turns the
 * whole cube in front of the camera, which must not change what it reads).
 * This is independent of the integer model, so comparing it with the canonical
 * state proves the renderer agrees with the logic (used by the debug API and
 * the browser tests).
 */
import * as THREE from 'three';
import { faceletIndex } from '../../core/puzzle/facelets';
import { faceFromNormal } from '../../core/puzzle/geometry';
import { SPACING, SURFACE_OFFSET } from './cubeResources';

const normal = new THREE.Vector3();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const inverseRoot = new THREE.Matrix4();
const relative = new THREE.Matrix4();

export function readVisualFacelets(meshes: readonly THREE.Object3D[], root?: THREE.Object3D | null): string {
  const out = new Array<string>(54).fill('?');
  if (root) {
    root.updateWorldMatrix(true, false);
    inverseRoot.copy(root.matrixWorld).invert();
  } else {
    inverseRoot.identity();
  }
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    relative.multiplyMatrices(inverseRoot, mesh.matrixWorld).decompose(position, quaternion, scale);
    normal.set(0, 0, 1).applyQuaternion(quaternion);
    const n: [number, number, number] = [Math.round(normal.x), Math.round(normal.y), Math.round(normal.z)];
    position.addScaledVector(normal, -SURFACE_OFFSET).divideScalar(SPACING);
    const cubie: [number, number, number] = [Math.round(position.x) + 0, Math.round(position.y) + 0, Math.round(position.z) + 0];
    out[faceletIndex(faceFromNormal(n), cubie)] = String(mesh.userData.color);
  }
  return out.join('');
}
