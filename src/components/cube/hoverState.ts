import * as THREE from 'three';
import type { Vec3 } from '../../core/puzzle/geometry';
import { ANCHOR_OFFSET } from './cubeResources';
import { faceletFrame } from './pieceFrames';
import type { PieceKind } from './pieceGeometry';

/**
 * Mutable hover target shared between the pointer layer and the indicator mesh.
 *
 * It records the hovered facelet in style-independent terms: the point on the
 * cubie's face plane, an orientation whose +Z is the outward normal, the piece
 * kind, and `shape` — a bitmask over the outline's quadrants (+x,+y), (+x,−y),
 * (−x,+y), (−x,−y) in that plane, set where the corner points at the face
 * centre. The indicator turns this into the outline of whichever cube style
 * is shown.
 */
export class HoverState {
  visible = false;
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  kind: PieceKind = 'center';
  shape = 0;
  #listeners = new Set<() => void>();
  #key = '';

  /** Points the outline at the facelet hit at `point` on the face with outward `normal`. */
  set(normal: Vec3, point: Vec3): void {
    const cubie = point.map((c, i) => (normal[i] !== 0 ? normal[i]! : Math.max(-1, Math.min(1, Math.round(c))))) as unknown as Vec3;
    const key = `${cubie.join(',')}|${normal.join(',')}`;
    if (this.visible && key === this.#key) return;
    this.#key = key;
    const frame = faceletFrame(normal, cubie);
    this.quaternion.copy(frame.quaternion);
    this.position.set(cubie[0], cubie[1], cubie[2]).addScaledVector(new THREE.Vector3(normal[0], normal[1], normal[2]), ANCHOR_OFFSET);
    this.kind = frame.kind;
    this.shape = frame.mask;
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
