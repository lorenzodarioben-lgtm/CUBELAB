import * as THREE from 'three';
import type { Vec3 } from '../../core/puzzle/geometry';
import { STICKER_OFFSET, TILE_TOP } from './cubeResources';

/** Mutable hover target shared between the pointer layer and the indicator mesh. */
export class HoverState {
  visible = false;
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  #listeners = new Set<() => void>();
  #key = '';

  /** Points the outline at the facelet hit at `point` on the face with outward `normal`. */
  set(normal: Vec3, point: Vec3): void {
    const cubie = point.map((c, i) => (normal[i] !== 0 ? normal[i]! : Math.max(-1, Math.min(1, Math.round(c))))) as unknown as Vec3;
    const key = `${cubie.join(',')}|${normal.join(',')}`;
    if (this.visible && key === this.#key) return;
    this.#key = key;
    const n = new THREE.Vector3(normal[0], normal[1], normal[2]);
    this.position.set(cubie[0], cubie[1], cubie[2]).addScaledVector(n, STICKER_OFFSET + TILE_TOP + 0.004);
    this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
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
