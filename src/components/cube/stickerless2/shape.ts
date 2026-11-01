/**
 * Stickerless v2 piece shapes are the production Stickerless shapes: the
 * pillowed faces, rim fillet, plan outlines and rounded cube edges of
 * `pieceGeometry.ts` (`STICKERLESS_SHAPE`) for corners and edges, and the
 * production Gloss centre (`stickerlessChamferGeometry.ts`). Production's look
 * is the anchor for face softness and the centre; v2 only shades them better.
 *
 * What v2 adds here is a GLSL twin of the production corner/edge SDF, built
 * from the same constants, so the shader takes exact per-pixel normals of the
 * production surface (pillow included) at any tessellation. The centre keeps
 * production's own analytic normal function.
 */
import type { CubieKind } from '../../../core/puzzle/cubies';
import { CANONICAL_HOME, CAP_DEPTH, CUBE_EDGE_RADIUS, PIECE_HALF, PILLOW, RIM_RADIUS, STICKERLESS_SHAPE, outlineCornerRadius } from '../pieceGeometry';
import { STICKERLESS_CHAMFER_NORMALS } from '../stickerlessChamferGeometry';

export const KIND_INDEX: Readonly<Record<CubieKind, number>> = { corner: 0, edge: 1, center: 2 };

/**
 * Plan radii of a visible face's outline as production builds them, quadrants
 * (+,+), (+,−), (−,+), (−,−) over the face's in-plane axes b = axis+1, c = axis+2.
 */
export function outlineRadii(kind: CubieKind, axis: 0 | 1 | 2): [number, number, number, number] {
  const home = CANONICAL_HOME[kind];
  const b = (axis + 1) % 3;
  const c = (axis + 2) % 3;
  const radius = (beta: number, gamma: number) =>
    outlineCornerRadius(kind, Math.abs(home[b]! + beta / 2) === 0.5 && Math.abs(home[c]! + gamma / 2) === 0.5, STICKERLESS_SHAPE);
  return [radius(1, 1), radius(1, -1), radius(-1, 1), radius(-1, -1)];
}

const glsl = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const vec4 = (r: readonly number[]) => `vec4(${r.map(glsl).join(', ')})`;
/** In-plane coordinates of a face, matching production's `sdRoundRect(p[b], p[c])`. */
const PLANE = ['p.yz', 'p.zx', 'p.xy'] as const;
const AXIS = ['p.x', 'p.y', 'p.z'] as const;

/** One visible face of the canonical piece: its rounded extrusion and its pillow. */
function face(kind: CubieKind, axis: 0 | 1 | 2): { extrusion: string; pillow: string } {
  return {
    extrusion: `v2Extrusion(v2RoundRect(${PLANE[axis]}, ${vec4(outlineRadii(kind, axis))}), ${AXIS[axis]} - V2_HALF)`,
    pillow: `v2Pillow(${PLANE[axis]}, ${AXIS[axis]} - V2_HALF)`,
  };
}

/** Hidden sides of the canonical piece: the planes production intersects it with. */
function slabs(kind: CubieKind): string {
  const home = CANONICAL_HOME[kind];
  const terms: string[] = [];
  for (const axis of [0, 1, 2] as const) {
    for (const sign of [1, -1]) if (home[axis] !== sign) terms.push(`${sign > 0 ? '' : '-'}${AXIS[axis]} - V2_HALF`);
  }
  return terms.reduce((acc, t) => (acc ? `max(${acc}, ${t})` : t), '');
}

function pieceTerm(kind: 'corner' | 'edge'): string {
  const home = CANONICAL_HOME[kind];
  const faces = ([0, 1, 2] as const).filter((a) => home[a] !== 0).map((a) => face(kind, a));
  const extrusions = faces.map((f) => f.extrusion).reduce((acc, t) => `max(${acc}, ${t})`);
  return `max(max(v2CubeBox(p + vec3(${home.map(glsl).join(', ')})), ${slabs(kind)}), ${extrusions}) - (${faces.map((f) => f.pillow).join(' + ')})`;
}

/**
 * GLSL: `v2Sdf(p, kind)` for corners (0) and edges (1), the production piece
 * SDF; `v2SdfNormal(p, kind)` its gradient; and the production centre's
 * analytic normal `pieceAnalyticRimNormal(p, face)`.
 */
export function sdfGlsl(): string {
  // Production's centre normal function, without the declarations v2 makes itself.
  const centreNormals = STICKERLESS_CHAMFER_NORMALS.replace('uniform mat3 normalMatrix;', '').replace('uniform vec4 uCentreSurface;', '');
  return /* glsl */ `
#define V2_HALF ${glsl(PIECE_HALF)}
float v2RoundRect(vec2 q, vec4 r) {
  float radius = q.x > 0.0 ? (q.y > 0.0 ? r.x : r.y) : (q.y > 0.0 ? r.z : r.w);
  vec2 w = abs(q) - V2_HALF + radius;
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - radius;
}
// Rounded extrusion of an outline below the face plane (production's rim fillet).
float v2Extrusion(float outline, float height) {
  vec2 w = vec2(outline, height) + ${glsl(RIM_RADIUS)};
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - ${glsl(RIM_RADIUS)};
}
// The whole cube as one rounded box (production's outer edge rounding).
float v2CubeBox(vec3 q) {
  vec3 w = abs(q) - ${glsl(1 + PIECE_HALF - CUBE_EDGE_RADIUS)};
  return length(max(w, 0.0)) + min(max(w.x, max(w.y, w.z)), 0.0) - ${glsl(CUBE_EDGE_RADIUS)};
}
// Production's parabolic face pillow, fading out below the face.
float v2Pillow(vec2 q, float height) {
  vec2 t = min(abs(q) / V2_HALF, vec2(1.0));
  vec2 profile = vec2(1.0) - t * t;
  float s = clamp(-height / ${glsl(CAP_DEPTH)}, 0.0, 1.0);
  return ${glsl(PILLOW)} * profile.x * profile.y * (1.0 - s * s * (3.0 - 2.0 * s));
}
float v2Sdf(vec3 p, int kind) {
  if (kind == 1) return ${pieceTerm('edge')};
  return ${pieceTerm('corner')};
}
vec3 v2SdfNormal(vec3 p, int kind) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0004;
  return normalize(
    k.xyy * v2Sdf(p + k.xyy * h, kind) +
    k.yyx * v2Sdf(p + k.yyx * h, kind) +
    k.yxy * v2Sdf(p + k.yxy * h, kind) +
    k.xxx * v2Sdf(p + k.xxx * h, kind));
}
${centreNormals}
`;
}
