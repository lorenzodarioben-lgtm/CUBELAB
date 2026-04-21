import * as THREE from 'three';
import type { Vec3 } from '../../core/puzzle/geometry';
import { SURFACE_OFFSET } from './cubeResources';

/**
 * Mutable hover target shared between the pointer layer and the indicator mesh.
 *
 * Besides where the outline goes, it records the hovered piece's outline
 * shape: `shape` is a bitmask over the outline's quadrants — (+x,+y), (+x,−y),
 * (−x,+y), (−x,−y) in the indicator's own plane — with a bit set where that
 * corner points at the face centre and is therefore cut with the large radius.
 */
export class HoverState {
  visible = false;
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  shape = 0;
  #listeners = new Set<() => void>();
  #key = '';
  readonly #basis = new THREE.Matrix4();

  /** Points the outline at the facelet hit at `point` on the face with outward `normal`. */
  set(normal: Vec3, point: Vec3): void {
    const cubie = point.map((c, i) => (normal[i] !== 0 ? normal[i]! : Math.max(-1, Math.min(1, Math.round(c))))) as unknown as Vec3;
    const key = `${cubie.join(',')}|${normal.join(',')}`;
    if (this.visible && key === this.#key) return;
    this.#key = key;
    const axis = normal.findIndex((c) => c !== 0);
    const sign = normal[axis]!;
    // In-plane axes, ordered so that x × y points along the outward normal.
    const b = (axis + 1) % 3;
    const c = (axis + 2) % 3;
    const [xAxis, yAxis] = sign > 0 ? [b, c] : [c, b];
    const unit = (i: number) => new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
    const n = new THREE.Vector3(normal[0], normal[1], normal[2]);
    this.quaternion.setFromRotationMatrix(this.#basis.makeBasis(unit(xAxis), unit(yAxis), n));
    this.position.set(cubie[0], cubie[1], cubie[2]).addScaledVector(n, SURFACE_OFFSET + 0.004);
    let shape = 0;
    [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].forEach(([qx, qy], bit) => {
      if (Math.abs(cubie[xAxis]! + qx! / 2) === 0.5 && Math.abs(cubie[yAxis]! + qy! / 2) === 0.5) shape |= 1 << bit;
    });
    this.shape = shape;
    this.visible = true;
    this.#emit();
  }

  clear(): void {
    if (!this.visible) return;
    this.visible = false;
    this.#key = '';
    this.#emit();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
