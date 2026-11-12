/**
 * Experimental Stickerless v2 (`src/components/cube/stickerless2/`): opt-in
 * selection; production anchoring (geometry, centre, finish, white);
 * material programs, turn state and GPU resource ownership; and isolation
 * from v1 and Classic Stickered.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CUBIE_DEFS, SOLVED_ORIENTATIONS, applyMoveToCubies } from '../../src/core/puzzle/cubies';
import { parseAlg } from '../../src/core/puzzle/notation';
import type { CubieKind } from '../../src/core/puzzle/cubies';
import { CubeVisuals } from '../../src/components/cube/cubeResources';
import { STICKERLESS_RENDERER } from '../../src/components/cube/stickerless2/flag';
import { KIND_INDEX, PRODUCTION_CENTRE_PLAN, V2_CENTRE_PLAN, outlineRadii, sdfGlsl } from '../../src/components/cube/stickerless2/shape';
import { createStickerlessV2Resources, setTurnBack, writeCellFaces, writeCellTints } from '../../src/components/cube/stickerless2/resources';
import { SEAM } from '../../src/components/cube/stickerless2/material';
import type { PieceMaterialV2 } from '../../src/components/cube/stickerless2/material';
import { V2_PALETTE } from '../../src/components/cube/stickerless2/palette';
import { DIAGONAL, SCALES, scaleLayout, scaleRows, scalesGlsl, shaftClearance } from '../../src/components/cube/stickerless2/scales';
import { GAPS, gapOcclusion } from '../../src/components/cube/stickerless2/gaps';
import { FACE_COLORS } from '../../src/core/puzzle/colors';
import { V2_STUDIO, fixedStudioDefines } from '../../src/components/cube/stickerless2/studio';
import { STICKERLESS_CHAMFER_NORMALS, buildStickerlessChamferGeometry, chamferNormalsGlsl, chamferOutline, sampleChamferSurface } from '../../src/components/cube/stickerlessChamferGeometry';
import { PRODUCTION_ROOM, fromHomeCamera, stickerlessWindowIntensity, stickerlessWindowPosition } from '../../src/components/stage/stickerlessEnvironment';
import { CAP_DEPTH, CUBE_EDGE_RADIUS, INNER_RADIUS, PILLOW, RIM_RADIUS } from '../../src/components/cube/pieceGeometry';
import { PIECE_DETAIL, createStickerlessResources } from '../../src/components/cube/stickerlessResources';

const KINDS: CubieKind[] = ['corner', 'edge', 'center'];

describe('Stickerless v2 selection', () => {
  // CubeVisuals draws its face-letter textures on a canvas; a stub is enough here.
  beforeAll(() => {
    (globalThis as Record<string, unknown>).document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  });
  afterAll(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it('is opt-in: v1 stays the renderer without the URL parameter', () => {
    expect(STICKERLESS_RENDERER).toBe('v1');
    const visuals = new CubeVisuals('low', 'gloss');
    expect(visuals.stickerlessRenderer).toBe('v1');
    expect(visuals.stickerless.setTurn).toBeUndefined();
    visuals.dispose();
  });

  it('builds the v2 set when selected, behind the same resource seam', () => {
    const visuals = new CubeVisuals('medium', 'gloss', 'v2');
    const res = visuals.stickerless;
    expect(res.materials).toHaveLength(CUBIE_DEFS.length);
    expect(typeof res.setTurn).toBe('function');
    expect(typeof res.onPieceRender).toBe('function');
    expect(res.coreFollowsSlices).toBe(true);
    for (const kind of KINDS) expect(res.pieces[kind]).toBeInstanceOf(THREE.BufferGeometry);
    visuals.dispose();
  });

  it('leaves Classic Stickered untouched: same meshes, materials and programs with v1 or v2 selected', () => {
    const v1 = new CubeVisuals('high', 'gloss', 'v1');
    const v2 = new CubeVisuals('high', 'gloss', 'v2');
    const a = v1.stickered;
    const b = v2.stickered;
    for (const kind of KINDS) expect(b.bodies[kind]).toBe(a.bodies[kind]);
    const describe = (m: THREE.Material) => ({ type: m.type, key: m.customProgramCacheKey(), defines: (m as THREE.MeshStandardMaterial).defines });
    for (const kind of KINDS) expect(describe(b.bodyMaterials[kind])).toEqual(describe(a.bodyMaterials[kind]));
    v1.dispose();
    v2.dispose();
  });
});

describe('Stickerless v2 is anchored to production', () => {
  it('uses the production piece meshes and, for Gloss, the production chamfer centre on its own plan', () => {
    for (const finish of ['gloss', 'matte'] as const) {
      const production = createStickerlessResources('medium', finish);
      const v2 = createStickerlessV2Resources('medium', finish);
      for (const kind of KINDS) {
        if (finish === 'gloss' && kind === 'center') continue;
        expect(v2.pieces[kind]).toBe(production.pieces[kind]);
      }
      if (finish === 'gloss') {
        // v2's Gloss centre is production's chamfer centre built on V2_CENTRE_PLAN, and only that differs.
        expect(v2.pieces.center).not.toBe(production.pieces.center);
        const expected = buildStickerlessChamferGeometry(PIECE_DETAIL.medium, V2_CENTRE_PLAN);
        expect(Array.from(v2.pieces.center.getAttribute('position').array)).toEqual(Array.from(expected.getAttribute('position').array));
        expect(Array.from(v2.pieces.center.getAttribute('normal').array)).toEqual(Array.from(expected.getAttribute('normal').array));
        expected.dispose();
      }
      production.dispose();
      v2.dispose();
    }
  });

  it("refines the Gloss centre by a hair: a slightly wider disc and a slightly squarer body, nothing else", () => {
    expect(PRODUCTION_CENTRE_PLAN).toEqual({ radius: 0.4255, cornerRadius: 0.37 * 0.97 });
    expect(V2_CENTRE_PLAN).toEqual({ radius: 0.4315, cornerRadius: 0.3445 });
    // Under 1.5% wider disc, under 5% tighter corners: a micro-refinement.
    expect(V2_CENTRE_PLAN.radius / PRODUCTION_CENTRE_PLAN.radius - 1).toBeLessThan(0.015);
    expect(1 - V2_CENTRE_PLAN.cornerRadius / PRODUCTION_CENTRE_PLAN.cornerRadius).toBeLessThan(0.05);
    // The body still fits its cell (half 0.493), and the diagonal grows by under 0.01.
    const v1 = chamferOutline(Math.PI / 4).radius, v2 = chamferOutline(Math.PI / 4, V2_CENTRE_PLAN).radius;
    expect(v2 - v1).toBeGreaterThan(0);
    expect(v2 - v1).toBeLessThan(0.01);
    for (let i = 0; i < 64; i++) {
      const a = (i * Math.PI) / 32, r = chamferOutline(a, V2_CENTRE_PLAN).radius;
      expect(Math.max(Math.abs(r * Math.cos(a)), Math.abs(r * Math.sin(a)))).toBeLessThanOrEqual(0.493 + 1e-12);
    }
    // Same top, drop and walls: the disc sits at the same height, the lip ends at the same side height.
    expect(sampleChamferSurface(0.3, 'plateau', 0.5, V2_CENTRE_PLAN).position[1]).toBe(sampleChamferSurface(0.3, 'plateau', 0.5).position[1]);
    expect(sampleChamferSurface(0.3, 'lip', 1, V2_CENTRE_PLAN).position[1]).toBeCloseTo(sampleChamferSurface(0.3, 'lip', 1).position[1], 12);
    // The shader's analytic normals follow the same plan; production's are untouched.
    expect(chamferNormalsGlsl(V2_CENTRE_PLAN)).toContain('r<=0.431500000');
    expect(chamferNormalsGlsl(V2_CENTRE_PLAN)).toContain('c=0.3445,');
    expect(chamferNormalsGlsl()).toBe(STICKERLESS_CHAMFER_NORMALS);
    expect(STICKERLESS_CHAMFER_NORMALS).toContain('r<=0.425500000');
  });

  it('uses production white; the shared face colours are unchanged', () => {
    expect(V2_PALETTE.U).toBe(FACE_COLORS.U.hex);
    expect(FACE_COLORS.U.hex).toBe('#f5f5f1');
    expect(FACE_COLORS.B.hex).toBe('#1f62e4');
  });

  it('takes the production Gloss finish: material values, Strong Hybrid response and per-piece variation', () => {
    const production = createStickerlessResources('high', 'gloss');
    const v2 = createStickerlessV2Resources('high', 'gloss');
    production.materials.forEach((p, id) => {
      const a = p as THREE.MeshPhysicalMaterial;
      const b = v2.materials[id] as THREE.MeshPhysicalMaterial;
      for (const key of ['roughness', 'clearcoat', 'clearcoatRoughness', 'specularIntensity', 'ior', 'envMapIntensity'] as const) {
        expect(b[key]).toBeCloseTo(a[key], 10);
      }
      expect(b.customProgramCacheKey()).toContain('strong-hybrid');
    });
    production.dispose();
    v2.dispose();
  });

  it('shades the production surface: the shader twin is generated from the production constants', () => {
    const glsl = sdfGlsl();
    for (const value of [RIM_RADIUS, CUBE_EDGE_RADIUS, PILLOW, CAP_DEPTH]) expect(glsl).toContain(String(value));
    expect(glsl).toContain('pieceAnalyticRimNormal');
    // v2 declares these itself; production's centre normal block must not repeat them.
    expect(glsl).not.toContain('uniform mat3 normalMatrix');
    expect(glsl).not.toContain('uniform vec4 uCentreSurface');
    expect(glsl).not.toMatch(/\bhalf\b/); // reserved word in GLSL ES
    expect(outlineRadii('edge', 1)).toContain(INNER_RADIUS.edge);
    expect(outlineRadii('corner', 0)).toContain(INNER_RADIUS.corner);
    expect(KIND_INDEX).toEqual({ corner: 0, edge: 1, center: 2 });
  });
});

describe('Stickerless v2 materials and resources', () => {
  it('compiles every piece of a tier to one program; detail shading only above Low', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      const res = createStickerlessV2Resources(tier, 'gloss');
      const keys = new Set(res.materials.map((m) => m.customProgramCacheKey()));
      expect(keys.size).toBe(1);
      const defines = Object.keys((res.materials[0] as THREE.MeshPhysicalMaterial).defines ?? {}).filter((d) => d.startsWith('V2_')).sort();
      // k2, the default studio, compiles in its exposure and its near-field transport on every tier; a turn lifts seams only at its cuts.
      const studio = ['V2_EXPOSURE_FIXED', 'V2_OPEN_CUTS', 'V2_TRANSPORT', 'V2_TRANSPORT_FLAGS'];
      const detail = tier === 'low' ? ['V2_BOUNCE', 'V2_MULTIBOUNCE', 'V2_SEAM'] : ['V2_BOUNCE', 'V2_CHAMFER_CENTRE', 'V2_MULTIBOUNCE', 'V2_SCALES', 'V2_SDF_NORMALS', 'V2_SEAM'];
      expect(defines).toEqual([...detail, ...studio].sort());
      res.dispose();
    }
  });

  it('patches its own hooks on top of the production shader, with engraved scales', () => {
    const res = createStickerlessV2Resources('high', 'gloss');
    const material = res.materials[0] as THREE.MeshPhysicalMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    for (const hook of ['v2SdfNormal', 'v2Cover', 'v2Scales', 'v2GapOcclusion', 'uPlasticDiffuseEnvironment', 'v2GatherOther', 'v2TraceOther', 'uTurnBack']) expect(shader.fragmentShader).toContain(hook);
    expect(shader.vertexShader).toContain('vPiecePos = position');
    for (const include of ['color_fragment', 'roughnessmap_fragment', 'normal_fragment_begin', 'lights_physical_fragment', 'lights_fragment_begin', 'aomap_fragment']) {
      expect(shader.fragmentShader).toContain(`#include <${include}>`);
    }
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['uFaceColor', 'uPieceToCube', 'uTurnAxis', 'uTurnBack', 'uPlasticDiffuseEnvironment']));
    res.dispose();
  });

  it('shares one turn state across all pieces and records the turn in flight', () => {
    const res = createStickerlessV2Resources('medium', 'gloss');
    const uniforms = res.materials.map((m) => {
      const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: '' };
      m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      return shader.uniforms;
    });
    expect(new Set(uniforms.map((u) => u.uTurnBack)).size).toBe(1);
    res.setTurn!({ axis: 1, layer: -1, angle: 0.5, cubies: [] });
    expect((uniforms[3]!.uTurnBack!.value as THREE.Matrix3).elements).toEqual(setTurnBack(new THREE.Matrix3(), new THREE.Vector3(0, 1, 0), 0.5).elements);
    expect(uniforms[3]!.uTurnLayer!.value).toBe(-1);
    expect((uniforms[3]!.uTurnAxis!.value as THREE.Vector3).toArray()).toEqual([0, 1, 0]);
    expect(uniforms[3]!.uTurnActive!.value).toBe(1);
    res.setTurn!({ axis: 0, layer: null, angle: 0.2, cubies: [] });
    expect(uniforms[3]!.uTurnLayer!.value).toBe(9);
    res.setTurn!(null);
    expect(uniforms[3]!.uTurnActive!.value).toBe(0);
    res.dispose();
  });

  it('gives each piece its transform within the cube before it is drawn', () => {
    const res = createStickerlessV2Resources('medium', 'gloss');
    const cube = new THREE.Group();
    cube.rotation.set(0.3, 0.7, 0.1);
    const cubie = new THREE.Group();
    cubie.position.set(1, 1, 1);
    const mesh = new THREE.Mesh(res.pieces.corner, res.materials[0]);
    mesh.rotation.y = Math.PI / 2;
    cubie.add(mesh);
    cube.add(cubie);
    cube.updateMatrixWorld(true);
    res.onPieceRender!.call(mesh, {} as THREE.WebGLRenderer, new THREE.Scene(), new THREE.Camera(), mesh.geometry, mesh.material as THREE.Material, new THREE.Group());
    const expected = new THREE.Matrix4().copy(cube.matrixWorld).invert().multiply(mesh.matrixWorld);
    const actual = (res.materials[0] as PieceMaterialV2).pieceToCube;
    actual.elements.forEach((v, i) => expect(v).toBeCloseTo(expected.elements[i]!, 10));
    expect(new THREE.Vector3().setFromMatrixPosition(actual).toArray().map((v) => Math.round(v))).toEqual([1, 1, 1]);
    res.dispose();
  });

  it('shares the production meshes and frees them once, after their last user', () => {
    const first = createStickerlessV2Resources('low', 'gloss');
    const second = createStickerlessV2Resources('low', 'gloss');
    expect(second.pieces.corner).toBe(first.pieces.corner);
    let freed = 0;
    for (const g of Object.values(first.pieces)) g.addEventListener('dispose', () => freed++);
    let materialsFreed = 0;
    for (const m of [...first.materials, first.coreMaterial]) m.addEventListener('dispose', () => materialsFreed++);
    first.dispose();
    first.dispose();
    expect(materialsFreed).toBe(CUBIE_DEFS.length + 1);
    expect(freed).toBe(0);
    second.dispose();
    expect(freed).toBe(3);
    // A later set reuses the cached CPU meshes; they simply upload again.
    for (let i = 0; i < 5; i++) createStickerlessV2Resources('low', 'gloss').dispose();
    expect(freed).toBe(3 + 5 * 3);
  });
});

describe('Stickerless v2 scale motif: one pattern of complete arches per face', () => {
  const arches = scaleLayout();
  const { radius: R, halfWidth: W } = SCALES;
  /** Points along an arch (the half of its circle toward the apex). */
  const archPoints = (a: { u: number; v: number }) =>
    Array.from({ length: 49 }, (_, i) => {
      const t = (Math.PI * i) / 48;
      return [a.u + R * Math.cos(t), a.v - R * Math.sin(t)] as const;
    });
  const rows = [...new Set(arches.map((a) => a.row))].sort((x, y) => x - y);
  const inRow = (row: number) => arches.filter((a) => a.row === row).sort((x, y) => x.u - y.u);

  it('is one field across the whole face, not two halves split at the colour change', () => {
    // Symmetric about the diagonal, with arches on it and straddling it.
    for (const a of arches) expect(arches.some((b) => b.row === a.row && Math.abs(b.u + a.u) < 1e-9)).toBe(true);
    // Even rows have an arch centred on the colour change, crossing it; odd rows have two arches meeting on it.
    expect(arches.filter((a) => Math.abs(a.u) < 1e-9).length).toBeGreaterThanOrEqual(5);
    for (const row of rows.filter((r) => r % 2 === 1)) expect(inRow(row).filter((a) => Math.abs(Math.abs(a.u) - R) < 1e-9)).toHaveLength(2);
    // Every row runs continuously across u = 0: no gap wider than the regular spacing at the diagonal.
    for (const row of rows) {
      const r = inRow(row);
      for (let i = 1; i < r.length; i++) expect(r[i]!.u - r[i - 1]!.u).toBeCloseTo(2 * R, 12);
      if (r.length > 1) expect(r[0]!.u).toBeLessThan(0);
    }
  });

  it('starts with a single arch on the diagonal nearest the apex, in staggered rows a radius apart', () => {
    expect(inRow(0)).toHaveLength(1);
    expect(inRow(0)[0]!.u).toBeCloseTo(0, 12);
    expect(Math.min(...arches.map((a) => a.v))).toBe(inRow(0)[0]!.v);
    rows.forEach((row, i) => expect(row).toBe(i));
    for (const row of rows.slice(1)) {
      expect(inRow(row)[0]!.v - inRow(row - 1)[0]!.v).toBeCloseTo(R, 12);
      // Stagger: even rows are centred on the diagonal, odd rows straddle it.
      const nearest = Math.min(...inRow(row).map((a) => Math.abs(a.u)));
      expect(nearest).toBeCloseTo(row % 2 === 0 ? 0 : R, 12);
    }
    expect(Math.max(...rows.map((row) => inRow(row).length))).toBeGreaterThanOrEqual(5);
  });

  it('keeps every arch whole inside the face, clear of its physical edges and of the corners that look into gaps', () => {
    for (const a of arches) {
      for (const [u, v] of archPoints(a)) {
        expect((v - Math.abs(u)) / Math.SQRT2 - W).toBeGreaterThanOrEqual(SCALES.marginOuter - 1e-9); // outer edges
        expect((DIAGONAL - Math.abs(u) - v) / Math.SQRT2 - W).toBeGreaterThanOrEqual(SCALES.marginInner - 1e-9); // internal edges
        expect(Math.hypot(DIAGONAL / 2 - Math.abs(u), DIAGONAL / 2 - v) - W).toBeGreaterThanOrEqual(SCALES.marginShaft - 1e-3);
      }
      const corner = Math.min(...archPoints(a).map(([u, v]) => Math.hypot(DIAGONAL / 2 - Math.abs(u), DIAGONAL / 2 - v)));
      expect(shaftClearance(a.u, a.v)).toBeCloseTo(corner, 2);
    }
  });

  it('adds no arch where a whole one would not fit (each row is as wide as the face allows)', () => {
    for (const row of rows) {
      const r = inRow(row);
      const next = { u: r.at(-1)!.u + 2 * R, v: r[0]!.v };
      const fits = archPoints(next).every(
        ([u, v]) =>
          (v - Math.abs(u)) / Math.SQRT2 - W >= SCALES.marginOuter &&
          (DIAGONAL - Math.abs(u) - v) / Math.SQRT2 - W >= SCALES.marginInner &&
          Math.hypot(DIAGONAL / 2 - Math.abs(u), DIAGONAL / 2 - v) - W >= SCALES.marginShaft,
      );
      expect(fits).toBe(false);
    }
  });

  it('draws exactly the laid-out arches in the shader, convex toward the apex', () => {
    const glsl = scalesGlsl();
    // The shader's row table reproduces the layout: each row's centres are (k mod 2)·R + 2R·j up to its largest |u|.
    const { firstRow, maxU } = scaleRows();
    expect(glsl).toContain(`const int V2_ROWS = ${maxU.length};`);
    const fromTable = maxU.flatMap((m, k) => {
      const out: { u: number; v: number }[] = [];
      for (let j = -20; j <= 20; j++) {
        const u = (k % 2) * R + 2 * R * j;
        if (m >= 0 && Math.abs(u) <= m + 1e-4) out.push({ u, v: firstRow + k * R });
      }
      return out;
    });
    const key = (a: { u: number; v: number }) => `${a.u.toFixed(6)},${a.v.toFixed(6)}`;
    expect(fromTable.map(key).sort()).toEqual(arches.map(key).sort());
    // The arch is the half of each circle with v below its centre (toward the apex at v = 0).
    expect(glsl).toContain('if (d.y <= 0.0)');
  });
});

describe('Stickerless v2 gaps: one darkening rule for every internal surface', () => {
  it('darkens with depth: a hairline seam at once, a shaft gradually, both to the same floor', () => {
    expect(gapOcclusion(0, 0.5)).toBeCloseTo(1, 10);
    expect(gapOcclusion(0.06, 0.5)).toBeLessThan(0.05); // plain seam: dark just below the rim
    expect(gapOcclusion(0.06, 0)).toBeGreaterThan(0.3); // shaft: still some light
    expect(gapOcclusion(0.4, 0)).toBeLessThan(GAPS.floor + 0.01);
    expect(gapOcclusion(0.4, 0.5)).toBeCloseTo(GAPS.floor, 3);
  });

  it('is continuous, so no surface inside a gap shows a hard-edged patch', () => {
    // A hard edge would keep the same jump however fine the sampling; a continuous rule's steps shrink with it.
    const worst = (h: number) => {
      let w = 0;
      for (let d = 0; d <= 0.4; d += 0.004) {
        for (let l = 0; l <= 0.6; l += 0.004) {
          w = Math.max(w, Math.abs(gapOcclusion(d + h, l) - gapOcclusion(d, l)), Math.abs(gapOcclusion(d, l + h) - gapOcclusion(d, l)));
        }
      }
      return w;
    };
    expect(worst(0.0005)).toBeLessThan(worst(0.002) * 0.3);
    expect(worst(0.0005)).toBeLessThan(0.06);
    // Darker the deeper, lighter the nearer the shaft's middle.
    for (let l = 0; l <= 0.6; l += 0.05) for (let d = 0; d < 0.4; d += 0.02) expect(gapOcclusion(d + 0.02, l)).toBeLessThanOrEqual(gapOcclusion(d, l) + 1e-12);
    for (let d = 0.02; d <= 0.3; d += 0.02) for (let l = 0; l < 0.6; l += 0.05) expect(gapOcclusion(d, l + 0.05)).toBeLessThanOrEqual(gapOcclusion(d, l) + 1e-12);
  });
});

describe('Stickerless v2 bounce light: the colour each cell shows across each axis', () => {
  const palette = Object.fromEntries(Object.entries(V2_PALETTE).map(([face, hex]) => [face, new THREE.Color(hex)])) as Record<keyof typeof V2_PALETTE, THREE.Color>;
  const mechanism = new THREE.Color('#c9cacb');
  const texel = (data: Uint8Array, cell: [number, number, number], axis: number) => {
    const i = (axis * 27 + (cell[0] + 1) * 9 + (cell[1] + 1) * 3 + (cell[2] + 1)) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
  const byte = (c: number) => Math.round(Math.min(1, c) * 255);

  it('shows a centre its own colour, an edge its other colour and the mechanism in the middle', () => {
    const data = new Uint8Array(27 * 3 * 4);
    writeCellTints(data, SOLVED_ORIENTATIONS, palette, mechanism);
    const u = palette.U;
    expect(texel(data, [0, 1, 0], 0)).toEqual([byte(u.r), byte(u.g), byte(u.b)]); // U centre, across x
    // UF edge across y: its internal face toward a neighbour in y shows F's colour, not U's.
    const f = palette.F;
    expect(texel(data, [0, 1, 1], 1)).toEqual([byte(f.r), byte(f.g), byte(f.b)]);
    expect(texel(data, [0, 0, 0], 2)).toEqual([byte(mechanism.r), byte(mechanism.g), byte(mechanism.b)]);
  });

  it('follows the puzzle state: after R the cell at UFR holds the piece that was at DFR', () => {
    const data = new Uint8Array(27 * 3 * 4);
    const turned = applyMoveToCubies(SOLVED_ORIENTATIONS, parseAlg('R')[0]!);
    writeCellTints(data, turned, palette, mechanism);
    const solved = new Uint8Array(27 * 3 * 4);
    writeCellTints(solved, SOLVED_ORIENTATIONS, palette, mechanism);
    // Across x (the R axis) the corner in that cell shows its two non-R faces; after R it is another piece.
    expect(texel(data, [1, 1, 1], 0)).not.toEqual(texel(solved, [1, 1, 1], 0));
    // Cells outside the R layer are unchanged.
    expect(texel(data, [-1, 1, 1], 0)).toEqual(texel(solved, [-1, 1, 1], 0));
  });
});

describe('Stickerless v2 near-field transport: the colour each cell shows each way', () => {
  const palette = Object.fromEntries(Object.entries(V2_PALETTE).map(([face, hex]) => [face, new THREE.Color(hex)])) as Record<keyof typeof V2_PALETTE, THREE.Color>;
  const mechanism = new THREE.Color('#c9cacb');
  const slot = (data: Uint8Array, cell: [number, number, number], s: number) => {
    const i = (s * 27 + (cell[0] + 1) * 9 + (cell[1] + 1) * 3 + (cell[2] + 1)) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
  };
  const byte = (c: THREE.Color) => [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, v) * 255));

  it('gives each outer face its own colour and marks the faces a piece does not have', () => {
    const data = new Uint8Array(27 * 7 * 4);
    writeCellFaces(data, SOLVED_ORIENTATIONS, palette, mechanism);
    // The UFR corner: +X red, +Y white, +Z green, and nothing toward −X, −Y, −Z.
    expect(slot(data, [1, 1, 1], 0)).toEqual([...byte(palette.R), 255]);
    expect(slot(data, [1, 1, 1], 2)).toEqual([...byte(palette.U), 255]);
    expect(slot(data, [1, 1, 1], 4)).toEqual([...byte(palette.F), 255]);
    for (const s of [1, 3, 5]) expect(slot(data, [1, 1, 1], s)[3]).toBe(0);
    // A centre's own colour (slot 6); the empty middle shows the mechanism every way.
    expect(slot(data, [0, -1, 0], 6)).toEqual([...byte(palette.D), 255]);
    for (let s = 0; s < 7; s++) expect(slot(data, [0, 0, 0], s)).toEqual([...byte(mechanism), 255]);
  });

  it('follows the puzzle state: after E2 the cell at BL holds the FR edge, turned', () => {
    const data = new Uint8Array(27 * 7 * 4);
    writeCellFaces(data, applyMoveToCubies(SOLVED_ORIENTATIONS, parseAlg('E2')[0]!), palette, mechanism);
    // The FR edge (red, green) now sits at BL (−X, −Z): red faces −X, green faces −Z.
    expect(slot(data, [-1, 0, -1], 1)).toEqual([...byte(palette.R), 255]);
    expect(slot(data, [-1, 0, -1], 5)).toEqual([...byte(palette.F), 255]);
    expect(slot(data, [-1, 0, -1], 0)[3]).toBe(0);
    // Outside the E slice nothing moved.
    const solved = new Uint8Array(27 * 7 * 4);
    writeCellFaces(solved, SOLVED_ORIENTATIONS, palette, mechanism);
    for (let s = 0; s < 7; s++) expect(slot(data, [-1, 1, -1], s)).toEqual(slot(solved, [-1, 1, -1], s));
  });
});

describe('Stickerless v2 assembly seam', () => {
  it('is a narrow V-groove: no wider than the scale grooves, walls neither flat nor sheer, darkest at the bottom', () => {
    expect(SEAM.halfWidth).toBeLessThanOrEqual(SCALES.halfWidth);
    const wallAngle = (Math.atan2(SEAM.depth, SEAM.halfWidth) * 180) / Math.PI;
    expect(wallAngle).toBeGreaterThan(30);
    expect(wallAngle).toBeLessThan(60);
    expect(SEAM.shade).toBeGreaterThan(0);
    expect(SEAM.shade).toBeLessThan(1);
    // Recess shading concentrated at the bottom (falloff > 1), so the walls keep their own lighting.
    expect(SEAM.falloff).toBeGreaterThan(1);
    // The approved profile (616a2dc).
    expect(SEAM).toEqual({ halfWidth: 0.0095, depth: 0.0121, shoulder: 0.35, shade: 0.97, falloff: 2.5, selfShadow: 0.85, wallRoughness: 0.14 });
  });

  it('runs along the colour boundary of internal surfaces only, on every tier', () => {
    for (const tier of ['high', 'low'] as const) {
      const res = createStickerlessV2Resources(tier, 'gloss');
      const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
      res.materials[0]!.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      const seam = shader.fragmentShader.slice(shader.fragmentShader.indexOf('#ifdef V2_SEAM'));
      // Defined by the gap between the two nearest outer faces (the colour boundary), masked off the exterior,
      // and applied after the scale motif so both grooves are cut where they cross.
      expect(seam).toContain('v2Gap * 0.70710678');
      expect(seam).toContain('v2Ext < 0.999');
      expect(shader.fragmentShader.indexOf('#ifdef V2_SEAM')).toBeGreaterThan(shader.fragmentShader.indexOf('v2Scales(uv)'));
      expect(shader.fragmentShader).toContain('v2Occ *= v2SeamShade');
      res.dispose();
    }
  });
});

describe('Stickerless v2 studios', () => {
  it('lights Gloss with k2, the approved lighting, its values compiled in', () => {
    expect(V2_STUDIO.transport).toEqual({ specular: true, bounce: false, internal: true, sheen: false });
    expect(V2_STUDIO.exposure).toBe(1.15);
    expect(V2_STUDIO.innerLight).toBe(1);
    expect(V2_STUDIO.keyLight).toBe(1.5);
    // Constants: none of the bounce or gain code.
    const res = createStickerlessV2Resources('high', 'gloss');
    for (const material of res.materials) {
      expect(material.defines).not.toHaveProperty('V2_INNER_FIXED');
      expect(material.defines).toMatchObject({ V2_TRANSPORT: '', V2_TRANSPORT_FLAGS: '1.0, 0.0, 1.0, 0.0', V2_EXPOSURE_FIXED: '1.15' });
      expect(material.customProgramCacheKey()).toBe('cubelab-v2-piece-detailed-studio-y-strong-hybrid');
    }
    res.dispose();
    // Matte has no studio (its lighting is production's matte lighting): none of k2's values or transport.
    const matte = createStickerlessV2Resources('high', 'matte');
    for (const material of matte.materials) {
      for (const define of ['V2_TRANSPORT', 'V2_TRANSPORT_FLAGS', 'V2_EXPOSURE_FIXED', 'V2_INNER_FIXED', 'V2_OPEN_CUTS']) expect(material.defines).not.toHaveProperty(define);
      expect(material.customProgramCacheKey()).toBe('cubelab-v2-piece-detailed-matte');
    }
    matte.dispose();
    // Only what a studio changes is compiled in.
    const off = { specular: false, bounce: false, internal: false, sheen: false };
    expect(fixedStudioDefines({ ...V2_STUDIO, exposure: 1, transport: off })).toEqual({});
    expect(fixedStudioDefines({ ...V2_STUDIO, innerLight: 1.7, exposure: 1, transport: off })).toEqual({ V2_INNER_FIXED: '1.7' });
    // v1's room is unchanged.
    expect(PRODUCTION_ROOM.colors).toEqual(['#909494', '#777772', '#aaa9a3', '#665044', '#898780', '#757572']);
  });

  it('turns vectors into the turning layer\'s frame as the per-vector rotation it replaces did', () => {
    // Rodrigues' rotation by -angle about the axis, as the shader computed it before (v2Rotate).
    const rodrigues = (p: THREE.Vector3, a: THREE.Vector3, angle: number) => {
      const c = Math.cos(angle), s = Math.sin(angle);
      return p.clone().multiplyScalar(c).add(a.clone().cross(p).multiplyScalar(s)).add(a.clone().multiplyScalar(a.dot(p) * (1 - c)));
    };
    const m = new THREE.Matrix3();
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    for (const axis of axes) {
      for (const angle of [-1.9, -0.82, 0.3, 1.2, Math.PI / 2]) {
        setTurnBack(m, axis, angle);
        for (const p of [new THREE.Vector3(1.5, -0.4, 0.9), new THREE.Vector3(-0.2, 1.1, -1.4)]) {
          const want = rodrigues(p, axis, -angle);
          expect(p.clone().applyMatrix3(m).distanceTo(want)).toBeLessThan(1e-12);
          // Its transpose turns forward again.
          expect(want.clone().applyMatrix3(m.clone().transpose()).distanceTo(p)).toBeLessThan(1e-12);
        }
      }
    }
  });

  it("keeps production's window light exactly: same place, same first moment", () => {
    // The pre-rebuild formula, restated: a hard 8 × 4.5 window of radiance 3.6 at (−1, 2.5, 7) in the home camera frame.
    const d2 = 1 + 2.5 ** 2 + 49, n = 32;
    let sum = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = ((x + 0.5) / n - 0.5) * 8, v = ((y + 0.5) / n - 0.5) * 4.5;
      sum += d2 / (d2 + u * u + v * v) ** 2;
    }
    expect(stickerlessWindowIntensity()).toBe((3.6 * 8 * 4.5 * sum) / (n * n));
    expect(stickerlessWindowPosition().length()).toBeCloseTo(Math.sqrt(d2), 10);
  });

  it('builds k2 on a neutral grey studio of white softboxes, without the low-left ring softbox', () => {
    const studio = V2_STUDIO;
    expect(studio.fill).toBe(false);
    expect(studio.key.tint).toBe('#ffffff');
    expect(studio.key.radiance).toBe(9);
    for (const panel of studio.panels) expect(panel.tint).toBe('#ffffff');
    // k2 as approved: seven panels; the low-left softbox of Y's ring (the peach wash) is a broad dim fill instead.
    expect(studio.panels).toHaveLength(7);
    const lowFill = fromHomeCamera([-5, -6, 4]);
    expect(studio.panels.some((p) => new THREE.Vector3(...p.position).distanceTo(fromHomeCamera([-6, -4.5, 4.5])) < 1e-9)).toBe(false);
    expect(studio.panels.at(-1)).toMatchObject({ size: [7, 3], radiance: 1.6, falloff: 0.7 });
    expect(new THREE.Vector3(...studio.panels.at(-1)!.position).distanceTo(lowFill)).toBeLessThan(1e-9);
    // The overhead sheet is a dim graded strip.
    expect(studio.panels.filter((p) => p.grade === 0.8)).toEqual([expect.objectContaining({ size: [8, 3], radiance: 2.2 })]);
    // The room is a neutral mid-grey surround: every wall the same grey.
    expect(studio.room.radiance).toBe(3);
    for (const color of studio.room.colors) expect(color).toBe('#5a5a5a');
  });

  it('places every panel between the cube and the room walls, emitting light', () => {
    expect(V2_STUDIO.innerLight).toBeGreaterThanOrEqual(1);
    expect(V2_STUDIO.room.radiance).toBeGreaterThan(0);
    for (const panel of [V2_STUDIO.key, ...V2_STUDIO.panels]) {
      const distance = Math.hypot(...panel.position);
      expect(distance).toBeGreaterThan(5);
      expect(Math.max(...panel.position.map(Math.abs))).toBeLessThan(30);
      expect(panel.radiance).toBeGreaterThan(0);
    }
  });
});
