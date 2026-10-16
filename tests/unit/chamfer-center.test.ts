import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildStickerlessChamferGeometry, chamferOutline, sampleChamferSurface, CONVEXITY_AMPLITUDE, CONVEXITY_BOUND, STICKERLESS_CHAMFER_NORMALS, STICKERLESS_CHAMFER_SURFACE as profile } from '../../src/components/cube/stickerlessChamferGeometry';
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
  for (const [detail, positions, normals, indices] of [
    [24, 'b6464bfd9ac8767efe93c50b98d27e9510bb315e96c0450b04fa5bff5e4c7537', '227ebcdfa97e45117feef1b8023b27cb7528442da42f0f582c77cd09934c3359', '373bf08ecef797e681f9ae8a5cc11b31a7e0c71bf0adb97e057e94db4ccc615a'],
    [30, '3151c886e373c1155d469eebd3c3b1b94bf9b046323a70ece45fa3158a7add78', '193ec6da9688eeb031693066997ebf17ae904f63f4d31994ef81751215ce14bc', '602b2db961b25595b62854930f254f79c0138546b27a5ddd682a6dc86b88dc3b'],
    [40, '2d5524b7b736b054c0ec4779acf2df8a3d9943ecae80e8c0f636ac8e36c004f3', 'b83423aa6cf52c5bb8fa052349dcca276625ad21d82b16911d9a99d37442f7a6', '4f1c3d11f61c8e9060b8a68fd57677c6cecca89d26fb0a44f6decb27f5f6bdd1'],
  ] as const) it(`matches the approved stronger candidate mesh and normal hashes at detail ${detail}`, () => {
    const geometry = buildStickerlessChamferGeometry(detail);
    expect(hash(geometry.getAttribute('position').array)).toBe(positions);
    expect(hash(geometry.getAttribute('normal').array)).toBe(normals);
    expect(hash(geometry.index!.array)).toBe(indices);
    expect(profile).toMatchObject({ plateauRadius: .425, drop: .073, softening: .008, top: .511, side: .438 });
    geometry.dispose();
  });

  it('localizes the approved tiny bow to the descending lip and preserves the plateau, softening and endpoints', () => {
    expect(CONVEXITY_BOUND).toBe(.0015);
    expect(CONVEXITY_AMPLITUDE).toBe(.00149997);
    expect(STICKERLESS_CHAMFER_NORMALS).toContain(`float bowSlope=${CONVEXITY_AMPLITUDE.toFixed(12)}*bowDerivative/lipLength;`);
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
        // Independent pre-convexity reference, including the entire original top softening.
        const distance = span * t, w = profile.softening;
        const line = distance >= w ? distance - w / 2 : distance / 2 - w / (2 * Math.PI) * Math.sin(Math.PI * distance / w);
        const baseline = profile.top - profile.drop * line / (span - w / 2);
        const displacement = s.position[1] - baseline;
        expect(displacement).toBeGreaterThanOrEqual(0);
        expect(displacement).toBeLessThanOrEqual(CONVEXITY_BOUND);
        if (distance <= w || j === 100) expect(displacement).toBe(0);
        if (j < 100) {
          const e = 1e-6, a = new THREE.Vector3(...sampleChamferSurface(angle - e, 'lip', t).position), b = new THREE.Vector3(...sampleChamferSurface(angle + e, 'lip', t).position);
          const c = new THREE.Vector3(...sampleChamferSurface(angle, 'lip', t - e).position), d = new THREE.Vector3(...sampleChamferSurface(angle, 'lip', t + e).position);
          const numeric = b.sub(a).cross(d.sub(c)).normalize();
          expect(numeric.dot(new THREE.Vector3(...s.normal))).toBeGreaterThan(.999999);
        }
      }
      const softeningEnd = sampleChamferSurface(angle, 'lip', profile.softening / span);
      const originalSlope = profile.drop / (span - profile.softening / 2);
      expect(softeningEnd.position[1]).toBeCloseTo(profile.top - profile.drop * (profile.softening / 2) / (span - profile.softening / 2), 14);
      for (const point of [softeningEnd, sampleChamferSurface(angle, 'lip', 1)]) {
        // The radial slope is encoded by the horizontal normal projected onto the face radius.
        const radial = (point.normal[0] * Math.cos(angle) + point.normal[2] * Math.sin(angle)) / point.normal[1];
        expect(radial).toBeCloseTo(originalSlope, 12);
      }
      const midpoint = (profile.softening + (span - profile.softening) / 2) / span;
      const straightHeight = profile.top - profile.drop * (span * midpoint - profile.softening / 2) / (span - profile.softening / 2);
      expect(sampleChamferSurface(angle, 'lip', midpoint).position[1] - straightHeight).toBeCloseTo(CONVEXITY_AMPLITUDE, 14);
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
