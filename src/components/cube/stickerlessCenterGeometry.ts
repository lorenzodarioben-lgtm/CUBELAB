/** A single circular-to-rounded-square moulded surface, retaining A3's perimeter and rear body. */
import * as THREE from 'three';
import { INNER_RADIUS, PIECE_HALF, PILLOW, RIM_RADIUS } from './pieceGeometry';

export const STICKERLESS_CENTRE_SURFACE = {
  plateauRadius: 0.4,
  top: PIECE_HALF + PILLOW,
  side: PIECE_HALF - RIM_RADIUS,
  cornerRadius: INNER_RADIUS.center,
} as const;

/** Exact ray intersection and normal of A3's original rounded-square outline. */
export function centreOutline(angle: number) {
  const x = Math.cos(angle), z = Math.sin(angle), ax = Math.abs(x), az = Math.abs(z);
  const h = PIECE_HALF, r = STICKERLESS_CENTRE_SURFACE.cornerRadius, k = h - r;
  if (Math.min(ax, az) * h <= k * Math.max(ax, az)) {
    return ax > az ? { radius: h / ax, nx: Math.sign(x), nz: 0 } : { radius: h / az, nx: 0, nz: Math.sign(z) };
  }
  const sum = ax + az;
  const radius = k * sum + Math.sqrt(r * r - 2 * k * k + k * k * sum * sum);
  return { radius, nx: Math.sign(x) * (radius * ax - k) / r, nz: Math.sign(z) * (radius * az - k) / r };
}

/** The cubic has horizontal/zero-curvature entry and vertical/zero-curvature exit. */
export function sampleCentreSurface(angle: number, t: number) {
  const p = STICKERLESS_CENTRE_SURFACE;
  const ex = Math.cos(angle), ez = Math.sin(angle), tx = -ez, tz = ex;
  const outline = centreOutline(angle), span = outline.radius - p.plateauRadius, drop = p.top - p.side;
  const g = 1 - (1 - t) ** 3;
  const radius = p.plateauRadius + span * g, height = p.top - drop * t ** 3;
  const angularRadius = -outline.radius * (outline.nx * tx + outline.nz * tz) / (outline.nx * ex + outline.nz * ez) * g;
  const nx = drop * t * t * (ex - angularRadius / radius * tx);
  const nz = drop * t * t * (ez - angularRadius / radius * tz);
  const ny = span * (1 - t) ** 2, length = Math.hypot(nx, ny, nz);
  return { position: [radius * ex, height, radius * ez] as const, normal: [nx / length, ny / length, nz / length] as const };
}

export function buildStickerlessCenterGeometry(detail: number): THREE.BufferGeometry {
  const sectors = detail * 4, steps = Math.max(10, Math.round(detail * 0.4)), rings = steps + 3;
  const positions: number[] = [0, STICKERLESS_CENTRE_SURFACE.top, 0], normals: number[] = [0, 1, 0], indices: number[] = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < sectors; i++) {
    const angle = i * Math.PI * 2 / sectors;
    if (j <= steps) {
      const point = sampleCentreSurface(angle, j / steps);
      positions.push(...point.position); normals.push(...point.normal);
    } else {
      const outline = centreOutline(angle);
      positions.push(outline.radius * Math.cos(angle), j === steps + 1 ? 0 : -PIECE_HALF, outline.radius * Math.sin(angle));
      normals.push(outline.nx, 0, outline.nz);
    }
  }
  const bottom = positions.length / 3;
  positions.push(0, -PIECE_HALF, 0); normals.push(0, -1, 0);
  for (let i = 0; i < sectors; i++) {
    const next = (i + 1) % sectors;
    indices.push(0, 1 + next, 1 + i);
    for (let j = 0; j < rings - 1; j++) {
      const a = 1 + j * sectors + i, an = 1 + j * sectors + next;
      indices.push(a, an, an + sectors, a, an + sectors, a + sectors);
    }
    const last = 1 + (rings - 1) * sectors;
    indices.push(last + i, last + next, bottom);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export const STICKERLESS_CENTRE_MESH = { id: 'stickerless-continuous-centre-v1', build: buildStickerlessCenterGeometry };

/** A2 normal correction differentiated from this actual loft, without a normal map. */
export const CONTINUOUS_CENTRE_NORMALS = /* glsl */ `
uniform mat3 normalMatrix;
uniform vec4 uCentreSurface;
vec3 pieceAnalyticRimNormal(vec3 p, int face) {
  float radius = length(p.xz);
  if (radius <= uCentreSurface.x) return vec3(0.0, 1.0, 0.0);
  vec2 e = p.xz / radius;
  vec2 tangent = vec2(-e.y, e.x);
  vec2 a = abs(e);
  float halfWidth = ${PIECE_HALF.toFixed(4)};
  float corner = uCentreSurface.w;
  float k = halfWidth - corner;
  float outer;
  vec2 boundaryNormal;
  if (min(a.x, a.y) * halfWidth <= k * max(a.x, a.y)) {
    outer = halfWidth / max(a.x, a.y);
    boundaryNormal = a.x > a.y ? vec2(sign(e.x), 0.0) : vec2(0.0, sign(e.y));
  } else {
    float sum = a.x + a.y;
    outer = k * sum + sqrt(corner * corner - 2.0 * k * k + k * k * sum * sum);
    boundaryNormal = sign(e) * (outer * a - k) / corner;
  }
  float drop = uCentreSurface.y - uCentreSurface.z;
  float t = pow(clamp((uCentreSurface.y - p.y) / drop, 0.0, 1.0), 1.0 / 3.0);
  float g = 1.0 - (1.0 - t) * (1.0 - t) * (1.0 - t);
  float angularRadius = -outer * dot(boundaryNormal, tangent) / dot(boundaryNormal, e) * g;
  vec2 uvNormal = drop * t * t * (e - angularRadius / radius * tangent);
  float upNormal = (outer - uCentreSurface.x) * (1.0 - t) * (1.0 - t);
  return normalize(vec3(uvNormal.x, upNormal, uvNormal.y));
}
`;
