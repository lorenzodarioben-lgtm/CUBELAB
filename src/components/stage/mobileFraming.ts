import { Quaternion, Vector3 } from 'three';
import type { VisualTurn } from '../../core/engine/cubeEngine';
import { HOME_POSE, poseQuaternion } from './orbitRig';

const toView = poseQuaternion(HOME_POSE).invert();
const orientation = new Quaternion();
const point = new Vector3();
const axes = [new Vector3(1,0,0), new Vector3(0,1,0), new Vector3(0,0,1)];

/** Perspective fit of the actual cube/layer bounds, with a 12px interaction margin.
 * Camera orientation and the user's zoom remain owned by OrbitRig. This only
 * determines the base distance; desktop never uses it. */
export function mobileFitDistance(width: number, height: number, half: number, fov: number, cubeRotation: Quaternion, turn: VisualTurn | null): number {
  orientation.copy(toView).multiply(cubeRotation);
  const focal = height / (2 * Math.tan(fov * Math.PI / 360));
  const halfW = Math.max(24, width / 2 - 12), halfH = Math.max(24, height / 2 - 12);
  let distance = 0;
  const box = (low: number, high: number, moving: boolean) => {
    for (const x of [-half, half]) for (const y of [-half, half]) for (const z of [-half, half]) {
      point.set(x,y,z);
      if (turn && turn.layer !== null) point.setComponent(turn.axis, point.getComponent(turn.axis) < 0 ? low : high);
      if (moving && turn) point.applyAxisAngle(axes[turn.axis]!, turn.angle);
      point.applyQuaternion(orientation);
      distance = Math.max(distance, point.z + focal * Math.abs(point.x) / halfW, point.z + focal * Math.abs(point.y) / halfH);
    }
  };
  if (!turn || turn.layer === null) box(-half,half,!!turn);
  else {
    const pieceHalf = half - 1;
    const low = turn.layer - pieceHalf, high = turn.layer + pieceHalf;
    box(low, high, true);
    if (turn.layer > -1) box(-half,turn.layer - 1 + pieceHalf,false);
    if (turn.layer < 1) box(turn.layer + 1 - pieceHalf,half,false);
  }
  return distance;
}
