/**
 * Piece shapes for a modern stickerless speedcube, built from signed distance
 * fields and meshed once per render tier.
 *
 * Every piece is a solid moulded part filling its lattice cell (less a tight
 * seam). Seen from a face, each piece's outline is a rounded square whose
 * corners differ by position, as on real stickerless cubes:
 *
 *   - corners that point at the face's centre are cut: centre caps and edge
 *     pieces with a large round arc (the centre reads as a rounded "coin",
 *     edges get their soft rounded ends), corner pieces with only a small
 *     radius, so their inner corner stays crisp and almost square as on GAN
 *     cubes. A small black opening shows the mechanism at each diagonal,
 *     framed by three rounded pieces and one sharp corner;
 *   - every other corner, and the rims along the seams between pieces, get a
 *     small fillet, so seams read as tight grooves that catch a thin highlight;
 *   - the cube's own outer edges and corners are rounded a little more, as a
 *     whole (one rounded box over all 26 pieces), so the silhouette is softened
 *     and the corners are spherical;
 *   - each face is very slightly pillowed toward its middle.
 *
 * Construction: for each visible face the piece is a rounded extrusion of that
 * face's 2D outline (exact SDF, rim fillet included); hidden sides are plain
 * planes; the cube-wide rounded box trims the outer edges. The solid is their
 * intersection. Two faces sharing a cube edge round it identically, so edges
 * and corners blend seamlessly. Colour is not part of the mesh:
 * the piece material colours each fragment by which face's cap it lies in
 * (see `pieceMaterial.ts`).
 *
 * Meshing: a grid on a slightly larger box (denser toward its edges) is
 * projected radially onto the surface — the solid is star-shaped about the
 * piece centre — and normals come from the SDF gradient, so shading is smooth
 * at any tessellation.
 */
import * as THREE from 'three';
import type { Vec3 } from '../../core/puzzle/geometry';

/** Half the width of a piece (lattice spacing 1, seam 0.014). */
export const PIECE_HALF = 0.493;
/** Fillet on the rims along seams; also the radius of outline corners on the cube's boundary. */
export const RIM_RADIUS = 0.03;
/** Rounding of the cube's own outer edges and corners. */
export const CUBE_EDGE_RADIUS = 0.075;
export type PieceKind = 'corner' | 'edge' | 'center';

/**
 * Radius of the circular cut on outline corners that point at the face
 * centre, per piece kind. Centres and edges keep the large GAN arc; corner
 * pieces are nearly square there.
 */
export const INNER_RADIUS: Readonly<Record<PieceKind, number>> = { center: 0.37, edge: 0.37, corner: 0.08 };
/** How far each face is pillowed outward at its middle. */
export const PILLOW = 0.0045;
const PILLOW_RAMP = 0.22;
/** Depth of the coloured cap; below it a piece is black mechanism plastic. */
export const CAP_DEPTH = 0.13;

/** Canonical home of each kind; real pieces are rotations of these. */
export const CANONICAL_HOME: Readonly<Record<PieceKind, Vec3>> = {
  corner: [1, 1, 1],
  edge: [0, 1, 1],
  center: [0, 1, 0],
};

/** Kind of the piece at a lattice position (number of visible faces). */
export function pieceKind(home: Vec3): PieceKind {
  const visible = home.filter((c) => c !== 0).length;
  return visible === 3 ? 'corner' : visible === 2 ? 'edge' : 'center';
}

/** Radius of one outline corner: the piece-specific cut if it points at the face centre, else the rim radius. */
export function outlineCornerRadius(kind: PieceKind, inner: boolean): number {
  return inner ? INNER_RADIUS[kind] : RIM_RADIUS;
}

/**
 * 2D rounded rectangle centred at the origin with half-size h and a radius per
 * quadrant: r[0] (+,+), r[1] (+,−), r[2] (−,+), r[3] (−,−). Exact inside and out.
 */
function sdRoundRect(x: number, y: number, h: number, r: readonly number[]): number {
  const radius = x > 0 ? (y > 0 ? r[0]! : r[1]!) : y > 0 ? r[2]! : r[3]!;
  const qx = Math.abs(x) - h + radius;
  const qy = Math.abs(y) - h + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

interface Face {
  readonly axis: 0 | 1 | 2;
  /** Outward sign of the face along its axis. */
  readonly sign: 1 | -1;
  /** In-plane axes. */
  readonly b: 0 | 1 | 2;
  readonly c: 0 | 1 | 2;
  /** Outline corner radii, quadrants as in `sdRoundRect` over (b, c). */
  readonly radii: readonly number[];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Signed distance (approximately Lipschitz-1) to the piece whose home lattice position is `home`. */
export function pieceSdf(home: Vec3): (x: number, y: number, z: number) => number {
  const s = PIECE_HALF;
  const kind = pieceKind(home);
  const faces: Face[] = [];
  const slabs: Array<{ axis: number; sign: number }> = [];
  for (const axis of [0, 1, 2] as const) {
    const h = home[axis];
    for (const sign of [1, -1] as const) {
      if (h !== sign) slabs.push({ axis, sign });
    }
    if (h === 0) continue;
    const b = ((axis + 1) % 3) as 0 | 1 | 2;
    const c = ((axis + 2) % 3) as 0 | 1 | 2;
    // A corner of the outline is "inner" when it sits at one of the four lattice
    // points around the face centre: (±½, ±½) in face-grid units.
    const corner = (beta: number, gamma: number) =>
      outlineCornerRadius(kind, Math.abs(home[b] + beta / 2) === 0.5 && Math.abs(home[c] + gamma / 2) === 0.5);
    faces.push({ axis, sign: h as 1 | -1, b, c, radii: [corner(1, 1), corner(1, -1), corner(-1, 1), corner(-1, -1)] });
  }
  const p = [0, 0, 0];
  // The whole cube as one rounded box, in this piece's coordinates.
  const cubeHalf = 1 + s - CUBE_EDGE_RADIUS;
  return (x, y, z) => {
    p[0] = x;
    p[1] = y;
    p[2] = z;
    const qx = Math.abs(x + home[0]) - cubeHalf;
    const qy = Math.abs(y + home[1]) - cubeHalf;
    const qz = Math.abs(z + home[2]) - cubeHalf;
    let d =
      Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - CUBE_EDGE_RADIUS;
    for (const slab of slabs) d = Math.max(d, slab.sign * p[slab.axis]! - s);
    let pillow = 0;
    for (const f of faces) {
      const outline = sdRoundRect(p[f.b]!, p[f.c]!, s, f.radii);
      const height = f.sign * p[f.axis]! - s;
      // Rounded extrusion: inset the outline and the face by the rim radius, then grow back.
      const wx = outline + RIM_RADIUS;
      const wy = height + RIM_RADIUS;
      const extrusion = Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - RIM_RADIUS;
      d = Math.max(d, extrusion);
      pillow += PILLOW * smoothstep(0, PILLOW_RAMP, -outline) * (1 - smoothstep(0, CAP_DEPTH, -height));
    }
    return d - pillow;
  };
}

/** Grid spacing on the projection box: dense toward the box edges, where the fillets are. */
function gridCoordinate(i: number, n: number): number {
  return Math.sin(((2 * i) / n - 1) * (Math.PI / 2));
}

/** Root of f on [lo, hi] (f(lo) < 0 < f(hi)) by the Illinois variant of regula falsi. */
function findRoot(f: (t: number) => number, lo: number, hi: number): number {
  let flo = f(lo);
  let fhi = f(hi);
  let side = 0;
  let t = hi;
  for (let i = 0; i < 60; i++) {
    t = (lo * fhi - hi * flo) / (fhi - flo);
    const ft = f(t);
    if (Math.abs(ft) < 1e-7) return t;
    if (ft > 0) {
      hi = t;
      fhi = ft;
      if (side === 1) flo /= 2;
      side = 1;
    } else {
      lo = t;
      flo = ft;
      if (side === -1) fhi /= 2;
      side = -1;
    }
  }
  return t;
}

/**
 * Meshes the piece at `home` with an n×n grid per box face (6·(n+1)² vertices,
 * 12·n² triangles). Positions and normals are in the piece's own frame,
 * centred on the piece.
 */
export function buildPieceGeometry(home: Vec3, n: number): THREE.BufferGeometry {
  const sdf = pieceSdf(home);
  const bound = PIECE_HALF + 0.06;
  const vertsPerFace = (n + 1) * (n + 1);
  const positions = new Float32Array(6 * vertsPerFace * 3);
  const normals = new Float32Array(6 * vertsPerFace * 3);
  const indices: number[] = [];
  const dir = [0, 0, 0];
  const e = 1e-4;
  let v = 0;
  let face = 0;
  for (const axis of [0, 1, 2] as const) {
    for (const sign of [1, -1] as const) {
      const b = (axis + 1) % 3;
      const c = (axis + 2) % 3;
      const base = face * vertsPerFace;
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          dir[axis] = sign * bound;
          dir[b] = gridCoordinate(i, n) * bound;
          dir[c] = gridCoordinate(j, n) * bound;
          const length = Math.hypot(dir[0]!, dir[1]!, dir[2]!);
          const ux = dir[0]! / length;
          const uy = dir[1]! / length;
          const uz = dir[2]! / length;
          const t = findRoot((k) => sdf(ux * k, uy * k, uz * k), 0, length);
          const x = ux * t;
          const y = uy * t;
          const z = uz * t;
          positions.set([x, y, z], v * 3);
          const gx = sdf(x + e, y, z) - sdf(x - e, y, z);
          const gy = sdf(x, y + e, z) - sdf(x, y - e, z);
          const gz = sdf(x, y, z + e) - sdf(x, y, z - e);
          const g = Math.hypot(gx, gy, gz) || 1;
          normals.set([gx / g, gy / g, gz / g], v * 3);
          v++;
        }
      }
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = base + j * (n + 1) + i;
          const bq = a + 1;
          const cq = a + n + 2;
          const dq = a + n + 1;
          // (b, c) follow the axis cyclically, so the grid's natural winding faces +axis.
          if (sign > 0) indices.push(a, bq, cq, a, cq, dq);
          else indices.push(a, cq, bq, a, dq, cq);
        }
      }
      face++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
