/**
 * Camera orbit state. Purely visual: it never touches the puzzle, so camera
 * gestures can never change notation, turn counts or the timer.
 *
 * Spherical coordinates around the cube centre: azimuth (around +Y, 0 = looking
 * at F), polar (from +Y) and a zoom multiplier on the auto-fitted distance.
 * Input moves the *target*; the rendered pose eases toward it each frame.
 */
export interface OrbitPose {
  readonly azimuth: number;
  readonly polar: number;
  readonly zoom: number;
}

/** Classic three-quarter view showing U, F and R. */
export const HOME_POSE: OrbitPose = { azimuth: 0.64, polar: 1.0, zoom: 1 };

const POLAR_MIN = 0.16;
const POLAR_MAX = Math.PI - 0.16;
const ZOOM_MIN = 0.72;
const ZOOM_MAX = 1.65;

export class OrbitRig {
  #target: OrbitPose = HOME_POSE;
  #current: OrbitPose = HOME_POSE;
  #listeners = new Set<() => void>();
  #sensitivity = 1;

  get target(): OrbitPose {
    return this.#target;
  }

  get current(): OrbitPose {
    return this.#current;
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
    this.#setTarget({ ...this.#target, azimuth: this.#target.azimuth - dx * k, polar: this.#target.polar - dy * k });
  }

  /** Discrete nudge in radians (keyboard). */
  nudge(dAzimuth: number, dPolar: number): void {
    this.#setTarget({ ...this.#target, azimuth: this.#target.azimuth + dAzimuth, polar: this.#target.polar + dPolar });
  }

  zoomBy(factor: number): void {
    this.#setTarget({ ...this.#target, zoom: this.#target.zoom * factor });
  }

  reset(): void {
    // Unwind azimuth to the nearest equivalent angle so the camera takes the short way home.
    const tau = Math.PI * 2;
    const turns = Math.round((this.#current.azimuth - HOME_POSE.azimuth) / tau);
    this.#setTarget({ ...HOME_POSE, azimuth: HOME_POSE.azimuth + turns * tau });
  }

  /** Eases the rendered pose toward the target. Returns true while still moving. */
  step(dtSeconds: number, instant: boolean): boolean {
    const c = this.#current;
    const t = this.#target;
    if (instant) {
      this.#current = t;
      return false;
    }
    const alpha = 1 - Math.exp(-dtSeconds * 14);
    const next: OrbitPose = {
      azimuth: c.azimuth + (t.azimuth - c.azimuth) * alpha,
      polar: c.polar + (t.polar - c.polar) * alpha,
      zoom: c.zoom + (t.zoom - c.zoom) * alpha,
    };
    const settled =
      Math.abs(next.azimuth - t.azimuth) < 1e-4 && Math.abs(next.polar - t.polar) < 1e-4 && Math.abs(next.zoom - t.zoom) < 1e-4;
    this.#current = settled ? t : next;
    return !settled;
  }

  isMoving(): boolean {
    const c = this.#current;
    const t = this.#target;
    return c.azimuth !== t.azimuth || c.polar !== t.polar || c.zoom !== t.zoom;
  }

  /** Camera position for a fitted base distance. */
  position(baseDistance: number, pose: OrbitPose = this.#current): [number, number, number] {
    const r = baseDistance * pose.zoom;
    const s = Math.sin(pose.polar);
    return [r * s * Math.sin(pose.azimuth), r * Math.cos(pose.polar), r * s * Math.cos(pose.azimuth)];
  }

  #setTarget(pose: OrbitPose): void {
    this.#target = {
      azimuth: pose.azimuth,
      polar: Math.min(POLAR_MAX, Math.max(POLAR_MIN, pose.polar)),
      zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pose.zoom)),
    };
    for (const listener of this.#listeners) listener();
  }
}
