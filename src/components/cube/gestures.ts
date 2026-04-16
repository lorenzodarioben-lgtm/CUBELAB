/**
 * Pointer-twist geometry. Pure functions: the caller supplies the ray and a
 * world→screen projection, so the heuristic is unit-testable without WebGL.
 *
 * Heuristic ("push the stickers"):
 *  1. Ray-cast against the cube's bounding box (|x|,|y|,|z| ≤ 1.5) to find the
 *     touched face normal n and the hit point p (cubie units).
 *  2. Once the drag passes a small threshold, compare its screen direction with
 *     the projected screen directions of the face's two tangent axes and lock
 *     onto the closer one, t. If both are similarly close, keep waiting; if it
 *     stays ambiguous, do nothing rather than guess.
 *  3. Pushing stickers along t rotates the slab about a = n × t containing p.
 *     A positive rotation about a moves face-n points along +t, so the drag
 *     distance d (world units) maps to angle d / 1.5 about a.
 *  4. Only outer slabs are puzzle moves. A drag that would turn a middle slice
 *     is refused with a hint instead of turning the wrong layer.
 *  5. On release the angle snaps to the nearest quarter (with a small flick
 *     threshold); below it the layer settles back and nothing is committed.
 */
import { clockwiseQuarterSign, faceForAxisLayer } from '../../core/puzzle/geometry';
import type { Axis, Vec3 } from '../../core/puzzle/geometry';
import { mv } from '../../core/puzzle/notation';
import type { Move } from '../../core/puzzle/notation';

export const HALF_EXTENT = 1.5;

export interface CubeHit {
  /** Axis-aligned outward normal of the touched face. */
  readonly normal: Vec3;
  /** Hit point in cubie units. */
  readonly point: Vec3;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export type Project = (world: Vec3) => ScreenPoint;

/** Slab test against the axis-aligned cube. Returns the entry face, or null. */
export function intersectCube(origin: Vec3, direction: Vec3, half = HALF_EXTENT): CubeHit | null {
  let tNear = -Infinity;
  let tFar = Infinity;
  let nearAxis = -1;
  let nearSign = 0;
  for (let i = 0; i < 3; i++) {
    const o = origin[i]!;
    const d = direction[i]!;
    if (Math.abs(d) < 1e-12) {
      if (o < -half || o > half) return null;
      continue;
    }
    let t1 = (-half - o) / d;
    let t2 = (half - o) / d;
    let sign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sign = 1;
    }
    if (t1 > tNear) {
      tNear = t1;
      nearAxis = i;
      nearSign = sign;
    }
    tFar = Math.min(tFar, t2);
    if (tNear > tFar) return null;
  }
  if (nearAxis < 0 || tNear < 0) return null;
  const normal: [number, number, number] = [0, 0, 0];
  normal[nearAxis] = nearSign;
  const point: Vec3 = [origin[0] + direction[0] * tNear, origin[1] + direction[1] * tNear, origin[2] + direction[2] * tNear];
  return { normal, point };
}

function axisOf(v: Vec3): Axis {
  if (v[0] !== 0) return 0;
  if (v[1] !== 0) return 1;
  return 2;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export type TwistResolution =
  | { readonly kind: 'pending' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'slice'; readonly axis: Axis }
  | {
      readonly kind: 'twist';
      readonly axis: Axis;
      readonly layer: -1 | 1;
      /** +1 if (n × t) points along +axis, −1 otherwise. */
      readonly axisSign: 1 | -1;
      /** Unit screen direction of +t. */
      readonly screenDir: ScreenPoint;
      /** Screen pixels per world unit along t at the hit point. */
      readonly pixelsPerUnit: number;
    };

export interface ResolveOptions {
  /** Minimum drag in px before deciding. */
  readonly threshold: number;
  /** Required |cos| advantage of the chosen tangent over the other. */
  readonly margin?: number;
}

/** Decides which slab a drag means. Pure and deterministic. */
export function resolveTwist(hit: CubeHit, drag: ScreenPoint, project: Project, options: ResolveOptions): TwistResolution {
  const length = Math.hypot(drag.x, drag.y);
  if (length < options.threshold) return { kind: 'pending' };
  const n = hit.normal;
  const nAxis = axisOf(n);
  const origin = project(hit.point);
  const candidates: Array<{ t: Vec3; dir: ScreenPoint; ppu: number; cos: number }> = [];
  for (let i = 0; i < 3; i++) {
    if (i === nAxis) continue;
    const t: [number, number, number] = [0, 0, 0];
    t[i] = 1;
    const tip = project([hit.point[0] + t[0] * 0.5, hit.point[1] + t[1] * 0.5, hit.point[2] + t[2] * 0.5]);
    const sx = tip.x - origin.x;
    const sy = tip.y - origin.y;
    const len = Math.hypot(sx, sy);
    if (len < 1e-3) continue;
    const dir = { x: sx / len, y: sy / len };
    candidates.push({ t, dir, ppu: len / 0.5, cos: (drag.x * dir.x + drag.y * dir.y) / length });
  }
  if (candidates.length === 0) return { kind: 'ambiguous' };
  candidates.sort((a, b) => Math.abs(b.cos) - Math.abs(a.cos));
  const best = candidates[0]!;
  const other = candidates[1];
  if (other && Math.abs(best.cos) - Math.abs(other.cos) < (options.margin ?? 0.2)) return { kind: 'ambiguous' };

  const a = cross(n, best.t);
  const axis = axisOf(a);
  const axisSign = (a[axis]! > 0 ? 1 : -1) as 1 | -1;
  const coordinate = hit.point[axis]!;
  const layer = Math.max(-1, Math.min(1, Math.round(coordinate)));
  if (layer === 0) return { kind: 'slice', axis };
  return { kind: 'twist', axis, layer: layer as -1 | 1, axisSign, screenDir: best.dir, pixelsPerUnit: best.ppu };
}

/** Drag gain: 1 world unit of push ≈ (gain / 1.5) rad of layer rotation. */
export const TWIST_GAIN = 1.2;

/** Layer angle (radians about +axis) for the current drag vector. */
export function twistAngle(resolution: Extract<TwistResolution, { kind: 'twist' }>, drag: ScreenPoint): number {
  const along = (drag.x * resolution.screenDir.x + drag.y * resolution.screenDir.y) / resolution.pixelsPerUnit;
  const aboutA = (along / HALF_EXTENT) * TWIST_GAIN;
  const limit = Math.PI * 1.15;
  return Math.max(-limit, Math.min(limit, resolution.axisSign * aboutA));
}

/** Release snapping: commits beyond ~24°, or a quick flick beyond ~9°. */
export const COMMIT_ANGLE = 0.42;
export const FLICK_ANGLE = 0.16;
export const FLICK_VELOCITY = 4; // rad/s

export interface SnapResult {
  readonly move: Move;
  readonly targetAngle: number;
}

export function snapTwist(axis: Axis, layer: -1 | 1, angle: number, angularVelocity = 0): SnapResult | null {
  const magnitude = Math.abs(angle);
  const flick = magnitude >= FLICK_ANGLE && Math.sign(angularVelocity) === Math.sign(angle) && Math.abs(angularVelocity) >= FLICK_VELOCITY;
  if (magnitude < COMMIT_ANGLE && !flick) return null;
  const quarters = Math.min(2, Math.max(1, Math.round(magnitude / (Math.PI / 2))));
  const direction = Math.sign(angle) as 1 | -1;
  const face = faceForAxisLayer(axis, layer);
  const turns = quarters === 2 ? 2 : direction === clockwiseQuarterSign(face) ? 1 : 3;
  return { move: mv(face, turns), targetAngle: (direction * quarters * Math.PI) / 2 };
}

/** Notation label for the move the current drag would commit (for the live preview). */
export function previewLabel(axis: Axis, layer: -1 | 1, angle: number): string | null {
  const snap = snapTwist(axis, layer, angle);
  if (!snap) return null;
  const { move } = snap;
  return move.turns === 1 ? move.face : move.turns === 2 ? `${move.face}2` : `${move.face}'`;
}
