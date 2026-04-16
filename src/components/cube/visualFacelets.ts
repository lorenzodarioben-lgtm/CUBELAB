/**
 * Reads the facelets *as rendered*: from each sticker mesh's actual world
 * transform in the three.js scene graph. This is independent of the integer
 * model, so comparing it with the canonical state proves the renderer agrees
 * with the logic (used by the debug API and the browser tests).
 */
import * as THREE from 'three';
import { faceletIndex } from '../../core/puzzle/facelets';
import { faceFromNormal } from '../../core/puzzle/geometry';
import { SPACING, STICKER_OFFSET } from './cubeResources';

const normal = new THREE.Vector3();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();

export function readVisualFacelets(meshes: readonly THREE.Mesh[]): string {
  const out = new Array<string>(54).fill('?');
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    mesh.getWorldQuaternion(quaternion);
    mesh.getWorldPosition(position);
    normal.set(0, 0, 1).applyQuaternion(quaternion);
    const n: [number, number, number] = [Math.round(normal.x), Math.round(normal.y), Math.round(normal.z)];
    position.addScaledVector(normal, -STICKER_OFFSET).divideScalar(SPACING);
    const cubie: [number, number, number] = [Math.round(position.x) + 0, Math.round(position.y) + 0, Math.round(position.z) + 0];
    out[faceletIndex(faceFromNormal(n), cubie)] = String(mesh.userData.color);
  }
  return out.join('');
}
