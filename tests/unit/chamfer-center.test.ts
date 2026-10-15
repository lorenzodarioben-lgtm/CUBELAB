import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildStickerlessChamferGeometry, chamferOutline, sampleChamferSurface, STICKERLESS_CHAMFER_NORMALS, STICKERLESS_CHAMFER_SURFACE as profile } from '../../src/components/cube/stickerlessChamferGeometry';
import { buildStickerlessCenterGeometry, CONTINUOUS_CENTRE_NORMALS } from '../../src/components/cube/stickerlessCenterGeometry';
import { createStickerlessResources, PIECE_DETAIL } from '../../src/components/cube/stickerlessResources';
import { CUBIE_DEFS } from '../../src/core/puzzle/cubies';

const hash = (array: ArrayBufferView) => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const centreId = CUBIE_DEFS.find(piece => piece.name === 'U')!.id;
function compile(material: THREE.Material) {
  const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} as Record<string, { value: unknown }> };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

describe('approved moulded chamfer centre', () => {
  it('matches the approved 0.425 candidate position, normal and index hashes exactly', () => {
    const geometry = buildStickerlessChamferGeometry(40);
    expect(hash(geometry.getAttribute('position').array)).toBe('b63a0387fafea0aecaa653a26d38cc583e03199394ddaca8e65833ea4053d2f7');
    expect(hash(geometry.getAttribute('normal').array)).toBe('0be5d46ffe349b9e0053741cc743093d25de9ce1ca8650223aee717271b8dd44');
    expect(hash(geometry.index!.array)).toBe('4f1c3d11f61c8e9060b8a68fd57677c6cecca89d26fb0a44f6decb27f5f6bdd1');
    expect(profile).toMatchObject({ plateauRadius: .425, drop: .073, softening: .008, top: .511, side: .438 });
    geometry.dispose();
  });

  it('has a flat circle, tiny softened top and straight variable-width lip without an outer shelf', () => {
    expect(chamferOutline(Math.PI / 4).radius - profile.plateauRadius).toBeGreaterThan(chamferOutline(0).radius - profile.plateauRadius);
    for (let i = 0; i < 80; i++) {
      const angle = i * Math.PI / 40, span = chamferOutline(angle).radius - profile.plateauRadius;
      expect(sampleChamferSurface(angle, 'plateau', .7).position[1]).toBe(.511);
      expect(new THREE.Vector3(...sampleChamferSurface(angle, 'lip', 0).normal).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-12);
      expect(sampleChamferSurface(angle, 'lip', 1).position[1]).toBeCloseTo(.438, 14);
      let previous = profile.top as number;
      for (let j = 1; j <= 100; j++) {
        const t = j / 100, s = sampleChamferSurface(angle, 'lip', t);
        expect(s.position[1]).toBeLessThan(previous); previous = s.position[1];
        if (span * t >= profile.softening) {
          const expected = profile.top - profile.drop * (span * t - profile.softening / 2) / (span - profile.softening / 2);
          expect(s.position[1]).toBe(expected);
        }
        if (j < 100) {
          const e = 1e-6, a = new THREE.Vector3(...sampleChamferSurface(angle - e, 'lip', t).position), b = new THREE.Vector3(...sampleChamferSurface(angle + e, 'lip', t).position);
          const c = new THREE.Vector3(...sampleChamferSurface(angle, 'lip', t - e).position), d = new THREE.Vector3(...sampleChamferSurface(angle, 'lip', t + e).position);
          const numeric = b.sub(a).cross(d.sub(c)).normalize();
          expect(numeric.dot(new THREE.Vector3(...s.normal))).toBeGreaterThan(.999999);
        }
      }
    }
  });

  for (const detail of [24, 30, 40]) it(`has finite normals and a closed, outward, nondegenerate mesh at detail ${detail}`, () => {
    const g = buildStickerlessChamferGeometry(detail), p = g.getAttribute('position'), n = g.getAttribute('normal'), ids = g.index!;
    const welded: number[] = [], positions = new Map<string, number>(), edges = new Map<string, { count: number; balance: number }>();
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(.493001); expect(Math.abs(v.z)).toBeLessThanOrEqual(.493001);
      expect(v.y).toBeGreaterThanOrEqual(-.493001); expect(v.y).toBeLessThanOrEqual(.511001);
      expect(new THREE.Vector3().fromBufferAttribute(n, i).length()).toBeCloseTo(1, 6);
      const key = v.toArray().map(x => x.toFixed(7)).join(',');
      if (!positions.has(key)) positions.set(key, positions.size);
      welded.push(positions.get(key)!);
    }
    for (let i = 0; i < ids.count; i += 3) {
      const v = [ids.getX(i), ids.getX(i + 1), ids.getX(i + 2)], a = new THREE.Vector3().fromBufferAttribute(p, v[0]!), b = new THREE.Vector3().fromBufferAttribute(p, v[1]!), c = new THREE.Vector3().fromBufferAttribute(p, v[2]!);
      const face = b.sub(a).cross(c.sub(a)), average = new THREE.Vector3();
      expect(face.lengthSq()).toBeGreaterThan(1e-15);
      for (const id of v) average.add(new THREE.Vector3().fromBufferAttribute(n, id));
      expect(face.dot(average)).toBeGreaterThan(0);
      for (let j = 0; j < 3; j++) {
        const x = welded[v[j]!]!, y = welded[v[(j + 1) % 3]!]!, key = `${Math.min(x, y)}:${Math.max(x, y)}`;
        const edge = edges.get(key) ?? { count: 0, balance: 0 }; edge.count++; edge.balance += x < y ? 1 : -1; edges.set(key, edge);
      }
    }
    expect([...edges.values()].every(edge => edge.count === 2 && edge.balance === 0)).toBe(true);
    expect(positions.size - edges.size + ids.count / 3).toBe(2); g.dispose();
  });
});

describe('production chamfer routing', () => {
  for (const tier of ['high', 'medium', 'low'] as const) it(`uses approved centre geometry and normals on Gloss ${tier}`, () => {
    const r = createStickerlessResources(tier, 'gloss'), expected = buildStickerlessChamferGeometry(PIECE_DETAIL[tier]);
    for (const key of ['position', 'normal']) expect(hash(r.pieces.center.getAttribute(key).array)).toBe(hash(expected.getAttribute(key).array));
    expect(hash(r.pieces.center.index!.array)).toBe(hash(expected.index!.array));
    const shader = compile(r.materials[centreId]!);
    if (tier === 'low') {
      // Low uses the approved mesh normals, without either analytic normal hook.
      expect(r.materials[centreId]!.type).toBe('MeshPhysicalMaterial');
      expect(shader.fragmentShader).not.toContain('pieceAnalyticRimNormal');
      expect(shader.fragmentShader).toContain('plasticWindowVisibility');
      expect(shader.uniforms.uCentreSurface).toBeUndefined();
    } else {
      expect(shader.fragmentShader).toContain(STICKERLESS_CHAMFER_NORMALS);
      expect(shader.fragmentShader).toContain('plasticWindowVisibility');
      expect((shader.uniforms.uCentreSurface!.value as THREE.Vector4).toArray()).toEqual([.425, .511, .438, .37]);
    }
    expected.dispose(); r.dispose();
  });

  for (const [tier, finish] of [['high', 'matte'], ['medium', 'matte'], ['low', 'matte']] as const) it(`retains the previous centre and shader on ${tier} ${finish}`, () => {
    const r = createStickerlessResources(tier, finish), old = buildStickerlessCenterGeometry(PIECE_DETAIL[tier]);
    for (const key of ['position', 'normal']) expect(hash(r.pieces.center.getAttribute(key).array)).toBe(hash(old.getAttribute(key).array));
    const shader = compile(r.materials[centreId]!);
    expect(shader.fragmentShader).not.toContain(STICKERLESS_CHAMFER_NORMALS);
    if (tier !== 'low') expect(shader.fragmentShader).toContain(CONTINUOUS_CENTRE_NORMALS);
    old.dispose(); r.dispose();
  });

  it('releases each tier centre only after its last Gloss owner, independently of Matte', () => {
    // Adjacent resource sets can overlap while the previous shaders finish warming.
    const tiers = ['high', 'medium', 'low', 'high'] as const;
    const sets = tiers.map(tier => createStickerlessResources(tier, 'gloss'));
    const matte = createStickerlessResources('low', 'matte');
    expect(sets[0]!.pieces.center).toBe(sets[3]!.pieces.center);
    expect(sets[2]!.pieces.center).not.toBe(matte.pieces.center);
    expect(sets[2]!.pieces.corner).toBe(matte.pieces.corner);
    const centers = [...new Set(sets.map(r => r.pieces.center))];
    const released = centers.map(g => { const fn = vi.fn(); g.addEventListener('dispose', fn); return fn; });
    const bodyReleased = vi.fn(); matte.pieces.corner.addEventListener('dispose', bodyReleased);
    try {
      sets[0]!.dispose(); expect(released[0]).not.toHaveBeenCalled();
      for (const r of sets.slice(1)) { r.dispose(); r.dispose(); }
      for (const fn of released) expect(fn).toHaveBeenCalledTimes(1);
      expect(bodyReleased).not.toHaveBeenCalled();
      matte.dispose(); expect(bodyReleased).toHaveBeenCalledTimes(1);
      // Cached CPU geometry can be uploaded again on Low -> High -> Low.
      const low = createStickerlessResources('low', 'gloss');
      expect(low.pieces.center).toBe(sets[2]!.pieces.center);
      low.dispose(); expect(released[2]).toHaveBeenCalledTimes(2);
    } finally {
      for (const r of sets) r.dispose(); matte.dispose();
      centers.forEach((g, i) => g.removeEventListener('dispose', released[i]!));
      matte.pieces.corner.removeEventListener('dispose', bodyReleased);
    }
  });
});
