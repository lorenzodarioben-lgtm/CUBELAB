/**
 * The moulded scale motif on the corner pieces' internal faces, laid out to fit.
 *
 * Each internal face of a corner piece is one flat square of plastic, coloured
 * in two halves along its diagonal; the face's outer corner (on the cube's
 * edge) is the apex. The motif is a single field of complete semicircular
 * grooves ("C" arches) over the whole square, each convex toward the apex, in
 * staggered rows like overlapping scales. As on the references, the pattern
 * runs straight across the colour change: the diagonal is a change of colour,
 * not a physical seam, so arches straddle it wherever they fall.
 *
 * The layout is computed here once, not as a repeating texture clipped at the
 * edges: the first row is one arch centred on the diagonal as close to the
 * apex as a whole arch fits; each later row is a radius further in, offset by
 * half an arch, and widens symmetrically about the diagonal. A row holds only
 * the arches that fit entirely inside the face with a clean margin from the
 * physical boundaries: the coated exterior band along the two outer edges,
 * the rounded internal edges, and the two side corners that look into the
 * closed cube's gaps. Rows stop where no whole arch fits. The shader draws
 * exactly these arches (`scalesGlsl`), so every arch is complete.
 *
 * Coordinates on the face, in object units: `v` runs from the apex along the
 * diagonal toward the inner corner, `u` across it (the colour change is u = 0).
 * The face is |u| ≤ v (outer edges) and |u| ≤ DIAGONAL − v (internal edges);
 * its side corners, interior lattice points of the neighbouring outer faces,
 * are at (±DIAGONAL/2, DIAGONAL/2).
 */
import { PIECE_HALF } from '../pieceGeometry';

export const SCALES = {
  /** Arch radius; neighbouring arches in a row are a diameter apart, rows one radius apart. */
  radius: 0.068,
  /** Groove half-width on the arch's inner side (the outer side is steeper, 0.6×). */
  halfWidth: 0.011,
  /** Groove depth. */
  depth: 0.006,
  /** Clearance from the outer face edges: past the coated exterior band and the rim fillet. */
  marginOuter: 0.085,
  /** Clearance from the internal edges, which production rounds with a 0.08 radius. */
  marginInner: 0.1,
  /**
   * Clearance from the face's side corners. Each is an interior lattice point
   * of a neighbouring outer face, where the closed cube's gaps open into a
   * shaft: no arch sits where it shows through one.
   */
  marginShaft: 0.3,
} as const;

/** Length of the face diagonal, apex to inner corner. */
export const DIAGONAL = 2 * PIECE_HALF * Math.SQRT2;

export interface ScaleArch {
  /** Centre of the arch's circle (u, v); the arch is the half with v below the centre (toward the apex). */
  readonly u: number;
  readonly v: number;
  readonly row: number;
}

/** Largest |u| an arch centre at row height `vc` may have and still fit entirely inside the face's edges. */
function maxCentre(vc: number): number {
  const { radius: R, halfWidth: W, marginOuter, marginInner } = SCALES;
  // Outer edges |u| = v: the arch's 45° point comes closest to them.
  const outer = vc - Math.SQRT2 * (marginOuter + W + R);
  // Internal edges |u| = DIAGONAL − v: the arch's end point comes closest to them.
  const inner = DIAGONAL - Math.SQRT2 * (marginInner + W) - R - vc;
  return Math.min(outer, inner);
}

/** Closest approach of an arch (centre u, v) to the nearer of the face's side corners (±DIAGONAL/2, DIAGONAL/2). */
export function shaftClearance(u: number, v: number): number {
  const { radius: R } = SCALES;
  const cu = DIAGONAL / 2 - Math.abs(u);
  const cv = DIAGONAL / 2 - v;
  // The arch is the half circle toward the apex (smaller v): the corner is nearest
  // the arch itself if it lies on that side, otherwise one of the arch's ends.
  if (cv < 0) return Math.abs(Math.hypot(cu, cv) - R);
  return Math.min(Math.hypot(cu - R, cv), Math.hypot(cu + R, cv));
}

/** The fitted arches of one whole face, row by row from the apex. */
export function scaleLayout(): ScaleArch[] {
  const { radius: R, halfWidth: W } = SCALES;
  // The first row is the first height at which one whole arch fits, centred on the diagonal.
  const firstRow = Math.SQRT2 * (SCALES.marginOuter + W + R);
  const fits = (u: number, v: number) => Math.abs(u) <= maxCentre(v) + 1e-9 && shaftClearance(u, v) >= SCALES.marginShaft + W;
  const arches: ScaleArch[] = [];
  for (let row = 0; ; row++) {
    const v = firstRow + row * R;
    if (maxCentre(v) < -1e-9 && v > DIAGONAL / 2) break;
    // Even rows have an arch on the diagonal, odd rows straddle it half an arch to each side.
    const offset = (row % 2) * R;
    const centres: number[] = [];
    for (let j = 0; offset + 2 * R * j <= maxCentre(v) + 1e-9; j++) {
      const u = offset + 2 * R * j;
      centres.push(...(u === 0 ? [0] : [-u, u]));
    }
    // A row keeps its arches contiguous: from the middle out, stop at the first that does not fit
    // (the face is symmetric about the diagonal, so arches drop out in mirrored pairs).
    centres.sort((x, y) => Math.abs(x) - Math.abs(y) || x - y);
    const firstMisfit = centres.findIndex((u) => !fits(u, v));
    const kept = firstMisfit < 0 ? centres : centres.slice(0, firstMisfit);
    for (const u of kept.sort((x, y) => x - y)) arches.push({ u, v, row });
  }
  return arches;
}

const glsl = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : n.toFixed(6));

/** Per-row lookup for the shader: the first row's height and each row's largest |u| (−1 for a row with no arch). */
export function scaleRows(): { firstRow: number; maxU: number[] } {
  const arches = scaleLayout();
  const rows = Math.max(...arches.map((a) => a.row)) + 1;
  const maxU = Array.from({ length: rows }, (_, row) => {
    const inRow = arches.filter((a) => a.row === row);
    return inRow.length ? Math.max(...inRow.map((a) => Math.abs(a.u))) : -1;
  });
  return { firstRow: arches.find((a) => a.row === 0)!.v, maxU };
}

/**
 * GLSL: `vec3 v2Scales(vec2 uv)` for a point of a face (u signed). Returns
 * the groove (0…1) and the gradient of the groove's height field (object units).
 * Only the laid-out arches exist, so no arch is ever cut off or faded at an edge.
 *
 * Rows are a radius apart from `firstRow`, row k's centres are (k mod 2)·R + 2R·j
 * up to that row's largest |u|; so a point needs only the two or three rows whose
 * band can reach it, and the three nearest centres in each, not every arch.
 */
export function scalesGlsl(): string {
  const { firstRow, maxU } = scaleRows();
  const { radius: R, halfWidth: W, depth: D } = SCALES;
  return /* glsl */ `
const int V2_ROWS = ${maxU.length};
const float V2_ROW_MAX[${maxU.length}] = float[](${maxU.map(glsl).join(', ')});
vec3 v2Scales(vec2 uv) {
  const float R = ${glsl(R)};
  const float WI = ${glsl(W)};
  const float WO = ${glsl(W * 0.6)};
  const float D = ${glsl(D)};
  const float V0 = ${glsl(firstRow)};
  float best = 1e3;
  float signedDist = 0.0;
  vec2 grad = vec2(0.0);
  bool inner = true;
  // An arch centred at height c covers v in [c − R − WI, c + WI].
  int k0 = max(int(ceil((uv.y - WI - V0) / R)), 0);
  int k1 = min(int(floor((uv.y + R + WI - V0) / R)), V2_ROWS - 1);
  for (int k = k0; k <= k1; k++) {
    float maxU = V2_ROW_MAX[k];
    if (maxU < 0.0) continue;
    float off = (k % 2 == 1) ? R : 0.0;
    float vc = V0 + float(k) * R;
    float j0 = floor((uv.x - off) / (2.0 * R) + 0.5);
    for (int m = -1; m <= 1; m++) {
      float cu = off + 2.0 * R * (j0 + float(m));
      if (abs(cu) > maxU + 1e-4) continue;
      vec2 d = uv - vec2(cu, vc);
      if (abs(d.x) > R + WI || d.y > WI || d.y < -R - WI) continue;
      if (d.y <= 0.0) {
        // The arch itself: signed distance, positive inside the circle.
        float r = max(length(d), 1e-5);
        float s = R - r;
        if (abs(s) < best) { best = abs(s); signedDist = s; grad = -d / r; inner = s >= 0.0; }
      } else {
        // Its rounded ends.
        vec2 e = d - vec2(sign(d.x) * R, 0.0);
        float r = max(length(e), 1e-5);
        if (r < best) { best = r; signedDist = r; grad = e / r; inner = true; }
      }
    }
  }
  float w = inner ? WI : WO;
  float t = clamp(best / w, 0.0, 1.0);
  float groove = 1.0 - t * t * (3.0 - 2.0 * t);
  // Height h = −D·groove(|s|/w): it rises with |s|, along ∇|s| = sign(s)·∇s.
  float slope = best < w ? D * 6.0 * t * (1.0 - t) / w : 0.0;
  vec2 dh = slope * (signedDist < 0.0 ? -grad : grad);
  return vec3(groove, dh);
}
`;
}
