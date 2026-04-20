/**
 * The view — a free trackball. Purely visual: it never touches the puzzle, so
 * view gestures can never change notation, turn counts or the timer.
 *
 * The view is a quaternion with no fixed "up", so it can tumble in any
 * direction: keep dragging upward and the cube rolls over until white faces
 * the floor, exactly as if it were turned in the hand. A drag rotates about
 * the screen's own vertical and horizontal axes, so the cube always follows
 * the pointer. Input moves the *target*; the rendered view eases toward it
 * each frame (spherical interpolation).
 *
 * The stage applies the view by turning the cube in front of a fixed studio
 * camera rather than flying the camera around it, so the lights, reflections
 * and floor shadow stay where they physically belong — above and below — when
 * the cube is upside down.
 */
import * as THREE from 'three';

export interface OrbitPose {
  /** Angle around world +Y, 0 = looking at F from the front. */
  readonly azimuth: number;
  /** Angle from world +Y: 0 = looking straight down onto U, π = straight up at D. */
  readonly polar: number;
  readonly zoom: number;
}

/** Classic three-quarter view showing U, F and R. */
export const HOME_POSE: OrbitPose = { azimuth: 0.64, polar: 1.0, zoom: 1 };

const ZOOM_MIN = 0.72;
const ZOOM_MAX = 1.65;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/** Camera position for a spherical pose (the home view; also used by tests). */
export function sphericalPosition(distance: number, pose: OrbitPose): [number, number, number] {
  const r = distance * pose.zoom;
  const s = Math.sin(pose.polar);
  return [r * s * Math.sin(pose.azimuth), r * Math.cos(pose.polar), r * s * Math.cos(pose.azimuth)];
}

/** Camera orientation (local +Z = cube → camera) for an upright spherical pose. */
export function poseQuaternion(pose: OrbitPose): THREE.Quaternion {
  const back = new THREE.Vector3(...sphericalPosition(1, { ...pose, zoom: 1 })).normalize();
  const right = new THREE.Vector3().crossVectors(AXIS_Y, back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
}

/** The studio camera's fixed orientation; the cube sits square to the world at the home view. */
const STUDIO = poseQuaternion(HOME_POSE);

function poseOf(q: THREE.Quaternion, zoom: number): OrbitPose {
  const dir = AXIS_Z.clone().applyQuaternion(q);
  return { azimuth: Math.atan2(dir.x, dir.z), polar: Math.acos(Math.max(-1, Math.min(1, dir.y))), zoom };
}

export class OrbitRig {
  /** Orientation of the camera relative to the cube (what a free-flying camera would do). */
  #target = STUDIO.clone();
  #current = this.#target.clone();
  #zoomTarget = HOME_POSE.zoom;
  #zoom = HOME_POSE.zoom;
  #sensitivity = 1;
  #listeners = new Set<() => void>();
  readonly #step = new THREE.Quaternion();

  /** Equivalent camera pose relative to the cube. */
  get target(): OrbitPose {
    return poseOf(this.#target, this.#zoomTarget);
  }

  get current(): OrbitPose {
    return poseOf(this.#current, this.#zoom);
  }

  /** The rendered view's up direction in cube coordinates; negative y means U is at the bottom of the screen. */
  up(): [number, number, number] {
    const v = AXIS_Y.clone().applyQuaternion(this.#current);
    return [v.x, v.y, v.z];
  }

  setSensitivity(value: number): void {
    this.#sensitivity = Math.min(2, Math.max(0.4, value));
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Drag in pixels → rotation; `viewport` is the stage height for scale invariance. */
  rotateBy(dx: number, dy: number, viewport: number): void {
    const k = (Math.PI / Math.max(320, viewport)) * 1.15 * this.#sensitivity;
    this.#rotateLocal(-dx * k, -dy * k);
  }

  /**
   * Discrete nudge in radians (keyboard): `dYaw` about the camera's up axis
   * (positive swings the camera to its right), `dPitch` about its right axis
   * (positive swings it down).
   */
  nudge(dYaw: number, dPitch: number): void {
    this.#rotateLocal(dYaw, dPitch);
  }

  zoomBy(factor: number): void {
    this.#zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.#zoomTarget * factor));
    this.#emit();
  }

  reset(): void {
    this.#target.copy(STUDIO);
    this.#zoomTarget = HOME_POSE.zoom;
    this.#emit();
  }

  /** Eases the rendered pose toward the target. Returns true while still moving. */
  step(dtSeconds: number, instant: boolean): boolean {
    if (!instant) {
      const alpha = 1 - Math.exp(-dtSeconds * 14);
      this.#current.slerp(this.#target, alpha);
      this.#zoom += (this.#zoomTarget - this.#zoom) * alpha;
      if (this.#current.angleTo(this.#target) > 1e-4 || Math.abs(this.#zoom - this.#zoomTarget) > 1e-4) return true;
    }
    this.#current.copy(this.#target);
    this.#zoom = this.#zoomTarget;
    return false;
  }

  isMoving(): boolean {
    return !this.#current.equals(this.#target) || this.#zoom !== this.#zoomTarget;
  }

  /** Studio camera position for a fitted base distance (fixed direction; zoom moves it in and out). */
  cameraPosition(baseDistance: number): [number, number, number] {
    return sphericalPosition(baseDistance * this.#zoom, HOME_POSE);
  }

  /** How the cube must be turned in front of the studio camera to show the current view. */
  cubeQuaternion(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.#current).invert().premultiply(STUDIO);
  }

  #rotateLocal(yaw: number, pitch: number): void {
    // Post-multiplying applies the rotation about the camera's own axes.
    this.#target.multiply(this.#step.setFromAxisAngle(AXIS_Y, yaw));
    this.#target.multiply(this.#step.setFromAxisAngle(AXIS_X, pitch)).normalize();
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
