/** Approved Stickerless Gloss centre: a flat circle and softened straight circle-to-square lip. */
import * as THREE from 'three';
import { INNER_RADIUS, PIECE_HALF, PILLOW, RIM_RADIUS } from './pieceGeometry';

const APPROVED = { radius: .425, drop: .073, softening: .008 } as const;
const TOP = PIECE_HALF + PILLOW;
const SIDE = PIECE_HALF - RIM_RADIUS;
export const STICKERLESS_CHAMFER_SURFACE = {
  plateauRadius: APPROVED.radius, top: TOP, side: SIDE,
  drop: APPROVED.drop, softening: APPROVED.softening, cornerRadius: INNER_RADIUS.center,
} as const;

/** Exact original rounded-square outline, including its angular derivative. */
export function chamferOutline(angle: number) {
  const x = Math.cos(angle), z = Math.sin(angle), ax = Math.abs(x), az = Math.abs(z);
  const h = PIECE_HALF, r = INNER_RADIUS.center, k = h - r;
  let radius: number, nx: number, nz: number;
  if (Math.min(ax, az) * h <= k * Math.max(ax, az)) {
    radius = h / Math.max(ax, az); nx = ax > az ? Math.sign(x) : 0; nz = ax > az ? 0 : Math.sign(z);
  } else {
    const sum = ax + az;
    radius = k * sum + Math.sqrt(r * r - 2 * k * k + k * k * sum * sum);
    nx = Math.sign(x) * (radius * ax - k) / r; nz = Math.sign(z) * (radius * az - k) / r;
  }
  return { radius, nx, nz, derivative: -radius * (-nx * z + nz * x) / (nx * x + nz * z) };
}

/** Only the top junction rounds; the remainder is exactly straight, without an inflection. */
function softenedLine(s: number, w: number) {
  if (s >= w) return { value: s - w / 2, derivative: 1 };
  const a = Math.PI * s / w;
  return { value: s / 2 - w / (2 * Math.PI) * Math.sin(a), derivative: .5 - .5 * Math.cos(a) };
}

export function sampleChamferSurface(angle: number, region: 'plateau' | 'lip', t: number) {
  const p = APPROVED, ex = Math.cos(angle), ez = Math.sin(angle), o = chamferOutline(angle);
  const span = o.radius - p.radius, radius = region === 'plateau' ? p.radius * t : p.radius + span * t;
  if (region === 'plateau') return { position: [radius * ex, TOP, radius * ez] as const, normal: [0, 1, 0] as const, radius };
  const f = softenedLine(span * t, p.softening), denominator = span - p.softening / 2;
  const y = TOP - p.drop * f.value / denominator;
  const radialNormal = p.drop * f.derivative / denominator;
  const tangentialNormal = -p.drop * f.value * o.derivative / (denominator * denominator * radius);
  const nx = radialNormal * ex - tangentialNormal * ez, nz = radialNormal * ez + tangentialNormal * ex;
  const length = Math.hypot(nx, 1, nz);
  return { position: [radius * ex, y, radius * ez] as const, normal: [nx / length, 1 / length, nz / length] as const, radius };
}

/** Exact approved mesh buffers. Coincident lower-junction vertices retain the separate lip/body normals. */
export function buildStickerlessChamferGeometry(detail: number): THREE.BufferGeometry {
  const p = APPROVED, sectors = detail * 4;
  const positions: number[] = [0, TOP, 0], normals: number[] = [0, 1, 0], indices: number[] = [];
  const lipSteps = Math.max(16, Math.round(detail * .5)), ringCount = 1 + 12 + lipSteps;
  for (let j = 0; j < ringCount; j++) for (let i = 0; i < sectors; i++) {
    const angle = i * Math.PI * 2 / sectors, span = chamferOutline(angle).radius - p.radius;
    const distance = j === 0 ? 0 : j <= 12 ? p.softening * j / 12 : p.softening + (span - p.softening) * (j - 12) / lipSteps;
    const point = sampleChamferSurface(angle, j === 0 ? 'plateau' : 'lip', j === 0 ? 1 : distance / span);
    positions.push(...point.position); normals.push(...point.normal);
  }
  for (let i = 0; i < sectors; i++) {
    const next = (i + 1) % sectors; indices.push(0, 1 + next, 1 + i);
    for (let j = 0; j < ringCount - 1; j++) {
      const a = 1 + j * sectors + i, b = 1 + j * sectors + next;
      indices.push(a, b, b + sectors, a, b + sectors, a + sectors);
    }
  }
  const wallStart = positions.length / 3;
  for (const y of [SIDE, 0, -PIECE_HALF]) for (let i = 0; i < sectors; i++) {
    const a = i * Math.PI * 2 / sectors, o = chamferOutline(a);
    positions.push(o.radius * Math.cos(a), y, o.radius * Math.sin(a)); normals.push(o.nx, 0, o.nz);
  }
  const bottom = positions.length / 3; positions.push(0, -PIECE_HALF, 0); normals.push(0, -1, 0);
  for (let i = 0; i < sectors; i++) {
    const next = (i + 1) % sectors;
    for (let j = 0; j < 2; j++) {
      const a = wallStart + j * sectors + i, b = wallStart + j * sectors + next;
      indices.push(a, b, b + sectors, a, b + sectors, a + sectors);
    }
    const last = wallStart + 2 * sectors; indices.push(last + i, last + next, bottom);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices); geometry.computeBoundingSphere(); return geometry;
}

// Own only the replacement centre; edges/corners continue sharing the existing cache with Matte.
const cache = new Map<number, { geometry: THREE.BufferGeometry; users: number }>();
export function acquireStickerlessChamferGeometry(detail: number): THREE.BufferGeometry {
  let entry = cache.get(detail);
  if (!entry) { entry = { geometry: buildStickerlessChamferGeometry(detail), users: 0 }; cache.set(detail, entry); }
  entry.users++; return entry.geometry;
}
export function releaseStickerlessChamferGeometry(detail: number): void {
  const entry = cache.get(detail);
  if (entry && entry.users > 0 && --entry.users === 0) entry.geometry.dispose();
}

/** Exact derivative of the approved geometry, preserving all production material response. */
export const STICKERLESS_CHAMFER_NORMALS = /* glsl */ `
uniform mat3 normalMatrix;
uniform vec4 uCentreSurface;
vec3 pieceAnalyticRimNormal(vec3 p, int face) {
  float r=length(p.xz); if(r<=${APPROVED.radius.toFixed(9)}) return vec3(0.,1.,0.);
  vec2 e=p.xz/r, a=abs(e), tangent=vec2(-e.y,e.x);
  float h=${PIECE_HALF}, c=${INNER_RADIUS.center}, k=h-c, outer; vec2 n;
  if(min(a.x,a.y)*h<=k*max(a.x,a.y)){outer=h/max(a.x,a.y);n=a.x>a.y?vec2(sign(e.x),0.):vec2(0.,sign(e.y));}
  else {float sum=a.x+a.y;outer=k*sum+sqrt(c*c-2.*k*k+k*k*sum*sum);n=sign(e)*(outer*a-k)/c;}
  if(p.y<${(TOP - APPROVED.drop - 1e-6).toFixed(9)}) return vec3(n.x,0.,n.y);
  float angular=-outer*dot(n,tangent)/dot(n,e);
  float span=outer-${APPROVED.radius.toFixed(9)}, w=${APPROVED.softening.toFixed(9)}, s=max(0.,r-${APPROVED.radius.toFixed(9)});
  float f=s-w*.5, df=1.;
  if(s<w){float angle=3.141592653589793*s/w;f=s*.5-w/(2.*3.141592653589793)*sin(angle);df=.5-.5*cos(angle);}
  float denominator=span-w*.5;
  float radial=${APPROVED.drop.toFixed(9)}*df/denominator;
  float around=-${APPROVED.drop.toFixed(9)}*f*angular/(denominator*denominator*r);
  vec2 horizontal=radial*e+around*tangent;
  return normalize(vec3(horizontal.x,1.,horizontal.y));
}`;
