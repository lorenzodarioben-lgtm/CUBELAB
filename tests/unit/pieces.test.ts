/**
 * Stickerless piece geometry, colour slots, hover outline and shader hooks.
 * Rendering itself is verified in the browser suite; these pin the invariants
 * the look depends on.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CUBIE_DEFS } from '../../src/core/puzzle/cubies';
import type { Vec3 } from '../../src/core/puzzle/geometry';
import { PIECE_FRAMES, SURFACE_OFFSET } from '../../src/components/cube/cubeResources';
import {
  CANONICAL_HOME,
  CUBE_EDGE_RADIUS,
  INNER_RADIUS,
  PIECE_HALF,
  PILLOW,
  buildPieceGeometry,
  pieceSdf,
} from '../../src/components/cube/pieceGeometry';
import { FACE_SLOTS, createPieceMaterial } from '../../src/components/cube/pieceMaterial';
import { HoverState } from '../../src/components/cube/hoverState';

const s = PIECE_HALF;
const KINDS = ['corner', 'edge', 'center'] as const;

describe('piece frames', () => {
  it('turn each canonical piece onto its cubie and carry exactly its colours', () => {
    for (const def of CUBIE_DEFS) {
      const frame = PIECE_FRAMES[def.id]!;
      expect(frame.kind).toBe(def.kind);
      const m = new THREE.Matrix4().makeRotationFromQuaternion(frame.quaternion);
      const home = new THREE.Vector3(...CANONICAL_HOME[def.kind]).applyMatrix4(m);
      expect([Math.round(home.x), Math.round(home.y), Math.round(home.z)]).toEqual([...def.home]);
      // Every sticker sits in the slot whose turned direction is its normal; other slots are black.
      const filled = frame.slots.filter((f) => f !== null);
      expect(filled.length).toBe(def.stickers.length);
      FACE_SLOTS.forEach((slot, i) => {
        const dir = new THREE.Vector3(...slot).applyMatrix4(m);
        const normal: Vec3 = [Math.round(dir.x), Math.round(dir.y), Math.round(dir.z)];
        const sticker = def.stickers.find((st) => st.normal.every((c, k) => c === normal[k]));
        expect(frame.slots[i] ?? null).toBe(sticker?.color ?? null);
      });
    }
  });
});

describe('piece shape (signed distance)', () => {
  for (const kind of KINDS) {
    const home = CANONICAL_HOME[kind];
    const sdf = pieceSdf(home);

    it(`${kind}: solid at the centre, flat-ish face, inside its own cell`, () => {
      expect(sdf(0, 0, 0)).toBeLessThan(-0.4);
      // The visible +Y face sits at the cell boundary, pillowed by at most PILLOW.
      expect(sdf(0, s + PILLOW + 1e-3, 0)).toBeGreaterThan(0);
      expect(sdf(0, s - 1e-3, 0)).toBeLessThan(0);
      // Nothing crosses into a neighbouring cell (seam kept open); visible faces stop at the pillow.
      for (const axis of [0, 1, 2]) {
        for (const sign of [1, -1]) {
          const p: [number, number, number] = [0, 0, 0];
          p[axis] = sign * (home[axis] === sign ? s + PILLOW + 1e-3 : s + 0.003);
          expect(sdf(...p)).toBeGreaterThan(0);
        }
      }
    });

    it(`${kind}: corners pointing at the face centre are cut with the large radius`, () => {
      // Inner corners of the +Y face outline, just below the face.
      const inner = (bx: number, bz: number) => sdf(bx * (s - 0.02), s - 0.02, bz * (s - 0.02));
      const innerCorners = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].filter(([bx, bz]) => Math.abs(home[0] + bx! / 2) === 0.5 && Math.abs(home[2] + bz! / 2) === 0.5);
      expect(innerCorners.length).toBe(kind === 'center' ? 4 : kind === 'edge' ? 2 : 1);
      for (const [bx, bz] of innerCorners) {
        expect(inner(bx!, bz!)).toBeGreaterThan(0.05);
        // …but the cut is a rounded corner, not a missing quadrant.
        const d = s - INNER_RADIUS * 0.6;
        expect(sdf(bx! * d * 0.5, s - 0.02, bz! * d * 0.5)).toBeLessThan(0);
      }
    });
  }

  it("rounds the cube's own corner with the cube-edge radius", () => {
    const sdf = pieceSdf(CANONICAL_HOME.corner);
    // The sharp corner point is cut away; a point just inside the rounding is solid.
    expect(sdf(s - 0.002, s - 0.002, s - 0.002)).toBeGreaterThan(0.01);
    const c = s - CUBE_EDGE_RADIUS;
    const inside = c + CUBE_EDGE_RADIUS * 0.5;
    expect(sdf(inside, inside, inside)).toBeLessThan(0);
  });
});

describe('piece meshes', () => {
  for (const kind of KINDS) {
    it(`${kind}: every vertex lies on the surface with an outward unit normal`, () => {
      const n = 16;
      const geometry = buildPieceGeometry(CANONICAL_HOME[kind], n);
      const pos = geometry.getAttribute('position');
      const nor = geometry.getAttribute('normal');
      expect(pos.count).toBe(6 * (n + 1) * (n + 1));
      expect(geometry.getIndex()!.count).toBe(6 * n * n * 6);
      const sdf = pieceSdf(CANONICAL_HOME[kind]);
      for (let i = 0; i < pos.count; i++) {
        const p = [pos.getX(i), pos.getY(i), pos.getZ(i)] as const;
        const q = [nor.getX(i), nor.getY(i), nor.getZ(i)] as const;
        expect(Math.abs(sdf(...p))).toBeLessThan(1e-4);
        expect(Math.max(...p.map(Math.abs))).toBeLessThanOrEqual(s + PILLOW + 1e-4);
        expect(Math.hypot(...q)).toBeCloseTo(1, 4);
        expect(p[0] * q[0] + p[1] * q[1] + p[2] * q[2]).toBeGreaterThan(0);
      }
      geometry.dispose();
    });
  }
});

describe('hover outline', () => {
  it('traces the hovered piece: centre caps are round, edges have two cuts, corners one', () => {
    const hover = new HoverState();
    const bits = (m: number) => [0, 1, 2, 3].filter((i) => m & (1 << i)).length;
    hover.set([0, 0, 1], [0, 0, 1.5]);
    expect(bits(hover.shape)).toBe(4);
    hover.set([0, 0, 1], [0, 1, 1.5]);
    expect(bits(hover.shape)).toBe(2);
    hover.set([0, 1, 0], [1, 1.5, 1]);
    expect(bits(hover.shape)).toBe(1);
    // Sits on the face, outline plane facing out along the normal with a right-handed basis.
    expect(hover.position.y).toBeCloseTo(1 + SURFACE_OFFSET + 0.004);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(hover.quaternion);
    const x = new THREE.Vector3();
    const y = new THREE.Vector3();
    const z = new THREE.Vector3();
    m.extractBasis(x, y, z);
    expect(z.y).toBeCloseTo(1);
    expect(new THREE.Vector3().crossVectors(x, y).y).toBeCloseTo(1);
  });

  it('marks the cut corners on the side that faces the centre', () => {
    const hover = new HoverState();
    // Bottom-front corner of the F face: its only inner corner points up-left in the face (toward the F centre).
    hover.set([0, 0, 1], [1, -1, 1.5]);
    // For +Z, the outline plane is (x, y): quadrant (−,+) is bit 2.
    expect(hover.shape).toBe(1 << 2);
  });
});

describe('piece material', () => {
  it('hooks into every shader chunk it relies on (physical and standard)', () => {
    for (const tier of ['high', 'low'] as const) {
      const material = createPieceMaterial([new THREE.Color('#ffffff'), null, null, null, null, null], { tier, finish: 'gloss' }, 1);
      const lib = tier === 'high' ? THREE.ShaderLib.physical : THREE.ShaderLib.standard;
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, unknown> } as unknown as THREE.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.vertexShader).toContain('vPieceNormal = objectNormal;');
      expect(shader.fragmentShader).toContain('diffuseColor.rgb = mix(pieceSecondColor, pieceBestColor, pieceBlend);');
      expect(shader.fragmentShader).toContain('roughnessFactor = mix(uBlackRoughness');
      expect(shader.fragmentShader).toContain('reflectedLight.directSpecular *= pieceDirect * pieceSeamSpecular;');
      if (tier === 'high') expect(shader.fragmentShader).toContain('material.clearcoat *= mix(uBlackCoat');
      expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['uFaceColor', 'uFaceOn', 'uBlack']));
      material.dispose();
    }
  });

  it('colour slots match the cubie definitions for the corner at URF', () => {
    const urf = CUBIE_DEFS.find((d) => d.home.join() === '1,1,1')!;
    const frame = PIECE_FRAMES[urf.id]!;
    const m = new THREE.Matrix4().makeRotationFromQuaternion(frame.quaternion);
    const colourAt = (dir: Vec3) => {
      const i = FACE_SLOTS.findIndex((slot) => {
        const v = new THREE.Vector3(...slot).applyMatrix4(m);
        return Math.round(v.x) === dir[0] && Math.round(v.y) === dir[1] && Math.round(v.z) === dir[2];
      });
      return frame.slots[i];
    };
    expect(colourAt([0, 1, 0])).toBe('U');
    expect(colourAt([1, 0, 0])).toBe('R');
    expect(colourAt([0, 0, 1])).toBe('F');
    expect(colourAt([0, -1, 0])).toBeNull();
  });
});
