import type { ScreenPoint } from '../cube/gestures';

const PINCH_SLOP_PX = 3;
const MIN_ROLL_SPAN_PX = 8;

/** Samples the existing pointer pair together, rather than treating the first
 * finger's event as a pinch before the second finger's event arrives. */
export class TwoFingerMotion {
  #points: [ScreenPoint, ScreenPoint];
  #changed = 0;
  #waited = false;
  #mid: ScreenPoint;
  #distance: number;
  #vector: ScreenPoint | null;

  constructor(a: ScreenPoint, b: ScreenPoint) {
    this.#points = [a,b];
    this.#mid = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
    this.#distance = Math.hypot(a.x-b.x,a.y-b.y);
    this.#vector = this.#distance >= MIN_ROLL_SPAN_PX ? { x:b.x-a.x, y:b.y-a.y } : null;
  }

  move(index: 0 | 1, point: ScreenPoint): void {
    this.#points[index] = point;
    this.#changed |= 1 << index;
  }

  get pending(): boolean { return this.#changed !== 0; }

  flush(final = false): { dx: number; dy: number; zoom: number; roll: number } | null {
    if (!this.pending) return null;
    // Give a sequential partner event one extra frame to arrive. A pinch with
    // one stationary finger still responds on the following frame.
    if (this.#changed !== 3 && !this.#waited && !final) { this.#waited = true; return null; }
    this.#changed = 0; this.#waited = false;
    const [a,b] = this.#points;
    const mid = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
    const distance = Math.hypot(a.x-b.x,a.y-b.y);
    const vector = { x:b.x-a.x, y:b.y-a.y };
    // Screen Y points down, so positive cross products mean clockwise roll.
    // atan2(cross,dot) unwraps each delta across ±π without rounding or snapping.
    // Nearly coincident contacts have no reliable angle; rebase on separation.
    const roll = distance >= MIN_ROLL_SPAN_PX && this.#vector
      ? Math.atan2(this.#vector.x*vector.y-this.#vector.y*vector.x, this.#vector.x*vector.x+this.#vector.y*vector.y)
      : 0;
    this.#vector = distance >= MIN_ROLL_SPAN_PX ? vector : null;
    let zoom = 1;
    const separation = distance-this.#distance;
    if (distance > 0 && this.#distance === 0) this.#distance = distance;
    else if (distance > 0 && Math.abs(separation) > PINCH_SLOP_PX) {
      // A sliding dead band removes separation noise without accumulating it
      // into zoom drift. Deliberate separation and centroid motion coexist.
      const filtered = distance-Math.sign(separation)*PINCH_SLOP_PX;
      zoom = this.#distance/filtered;
      this.#distance = filtered;
    }
    const delta = { dx:mid.x-this.#mid.x, dy:mid.y-this.#mid.y, zoom, roll };
    this.#mid = mid;
    return delta;
  }
}
