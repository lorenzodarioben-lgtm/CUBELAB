import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CANONICAL_HOME, PIECE_HALF, STICKERLESS_SHAPE, pieceSdf } from '../../src/components/cube/pieceGeometry';
import { STICKERLESS_CENTRE_SURFACE as profile, buildStickerlessCenterGeometry, centreOutline, sampleCentreSurface } from '../../src/components/cube/stickerlessCenterGeometry';

describe('continuous Stickerless centre', () => {
  it('retains A3 perimeter and rear body exactly, with a horizontal circular plateau', () => {
    const sdf = pieceSdf(CANONICAL_HOME.center, STICKERLESS_SHAPE);
    for (let i = 0; i < 160; i++) {
      const angle = i * Math.PI / 80, outline = centreOutline(angle);
      expect(Math.abs(sdf(outline.radius * Math.cos(angle), 0, outline.radius * Math.sin(angle)))).toBeLessThan(1e-12);
      expect(sampleCentreSurface(angle, 0).position[1]).toBe(profile.top);
      expect(new THREE.Vector3(...sampleCentreSurface(angle, 0).normal).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-12);
      const end = sampleCentreSurface(angle, 1);
      expect(end.position[1]).toBe(profile.side);
      expect(end.normal[1]).toBe(0);
    }
  });

  it('has a monotonic shoulder with no landing/groove and zero meridian curvature at both joins', () => {
    for (let a = 0; a < 32; a++) {
      const angle = a * Math.PI / 16, span = centreOutline(angle).radius - profile.plateauRadius, drop = profile.top - profile.side;
      let previousRadius: number = profile.plateauRadius, previousHeight: number = profile.top;
      for (let i = 1; i <= 100; i++) {
        const p = sampleCentreSurface(angle, i / 100).position, radius = Math.hypot(p[0], p[2]);
        expect(radius).toBeGreaterThan(previousRadius); expect(p[1]).toBeLessThan(previousHeight);
        previousRadius = radius; previousHeight = p[1];
      }
      for (const t of [1e-5, 1 - 1e-5]) {
        const rp = 3 * span * (1 - t) ** 2, yp = -3 * drop * t * t;
        const curvature = Math.abs(rp * (-6 * drop * t) - yp * (-6 * span * (1 - t))) / (rp * rp + yp * yp) ** 1.5;
        expect(curvature).toBeLessThan(0.001);
      }
      for (const t of [0.1, 0.3, 0.6, 0.9]) {
        const e = 1e-5, p = (x: number, y: number) => new THREE.Vector3(...sampleCentreSurface(x, y).position);
        const dt = p(angle, t + e).sub(p(angle, t - e)), da = p(angle + e, t).sub(p(angle - e, t));
        const normal = da.cross(dt).normalize(), exact = new THREE.Vector3(...sampleCentreSurface(angle, t).normal);
        expect(normal.dot(exact)).toBeGreaterThan(0.999999);
      }
    }
  });

  for (const detail of [24, 30, 40]) it(`is closed, nondegenerate, outward and within the lattice at detail ${detail}`, () => {
    const g = buildStickerlessCenterGeometry(detail), p = g.getAttribute('position'), n = g.getAttribute('normal'), ids = g.index!;
    expect(p.count).toBeLessThan(6 * (detail + 1) ** 2);
    const edges = new Map<string, number>(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      a.fromBufferAttribute(p, i); expect(Math.abs(a.x)).toBeLessThanOrEqual(PIECE_HALF + 1e-6); expect(Math.abs(a.z)).toBeLessThanOrEqual(PIECE_HALF + 1e-6);
      expect(a.y).toBeGreaterThanOrEqual(-PIECE_HALF - 1e-6); expect(a.y).toBeLessThanOrEqual(profile.top + 1e-6);
      expect(new THREE.Vector3().fromBufferAttribute(n, i).length()).toBeCloseTo(1, 6);
    }
    for (let i = 0; i < ids.count; i += 3) {
      const v = [ids.getX(i), ids.getX(i + 1), ids.getX(i + 2)];
      a.fromBufferAttribute(p, v[0]!); b.fromBufferAttribute(p, v[1]!); c.fromBufferAttribute(p, v[2]!);
      const face = b.sub(a).cross(c.sub(a)), average = new THREE.Vector3();
      expect(face.lengthSq()).toBeGreaterThan(1e-15);
      for (const id of v) average.add(new THREE.Vector3().fromBufferAttribute(n, id));
      expect(face.dot(average)).toBeGreaterThan(0);
      for (let j = 0; j < 3; j++) { const u = v[j]!, w = v[(j + 1) % 3]!, key = `${Math.min(u, w)}:${Math.max(u, w)}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
    }
    expect([...edges.values()].every(v => v === 2)).toBe(true); expect(p.count - edges.size + ids.count / 3).toBe(2); g.dispose();
  });
});
