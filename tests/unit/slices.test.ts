/**
 * M / E / S middle-slice turns.
 *
 * Direction tests use expectations derived by hand from the definitions
 * (M turns like L, E like D, S like F) and from cube-rotation identities, so a
 * mirrored or inverted slice fails here even though inverse/identity tests
 * would still pass.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { KPuzzle } from 'cubing/kpuzzle';
import { CubeEngine } from '../../src/core/engine/cubeEngine';
import type { CommitEvent } from '../../src/core/engine/cubeEngine';
import { agrees, applyMove, applyMoves, createSolvedState, isSolved, sameLogicalState, stateFacelets } from '../../src/core/puzzle/cubeState';
import type { CubeState } from '../../src/core/puzzle/cubeState';
import { CUBIE_DEFS, cubiePosition, cubiesInLayer } from '../../src/core/puzzle/cubies';
import { SOLVED_FACELETS, colorHistogram, faceSlice, isFaceletStringSolved } from '../../src/core/puzzle/facelets';
import { IDENTITY, isCubeRotation, matEquals } from '../../src/core/puzzle/geometry';
import { centersAtHome, isReachablePatternData, loadKPuzzle, patternFacelets, serializePattern } from '../../src/core/puzzle/kpattern';
import { MOVE_FAMILIES, SLICES, formatAlg, invertAlg, invertMove, moveMetrics, mv, parseAlg } from '../../src/core/puzzle/notation';
import type { Move, Turns } from '../../src/core/puzzle/notation';
import { centerFixSequence, solveState } from '../../src/core/solver/solver';
import { createMemoryStore, loadCube, saveCube } from '../../src/core/persistence/storage';
import { resolveTwist, snapTwist, twistAngle } from '../../src/components/cube/gestures';
import type { Project } from '../../src/components/cube/gestures';
import { HOME_POSE, OrbitRig } from '../../src/components/stage/orbitRig';
import { fakeClock, seededRandom } from './helpers';

let kpuzzle: KPuzzle;
let solved: CubeState;

beforeAll(async () => {
  kpuzzle = await loadKPuzzle();
  solved = createSolvedState(kpuzzle);
});

/** Random sequence over all nine families. */
function randomAllMoves(rand: () => number, length: number): Move[] {
  return Array.from({ length }, () => mv(MOVE_FAMILIES[Math.floor(rand() * 9)]!, (1 + Math.floor(rand() * 3)) as Turns));
}

function expectHealthy(state: CubeState) {
  expect(agrees(state)).toBe(true);
  const positions = new Set<string>();
  for (const def of CUBIE_DEFS) {
    expect(isCubeRotation(state.cubies[def.id]!)).toBe(true);
    const pos = cubiePosition(state.cubies, def.id);
    expect(pos.filter((c) => c !== 0).length).toBe(def.stickers.length);
    positions.add(pos.join(','));
  }
  expect(positions.size).toBe(26);
  expect(colorHistogram(stateFacelets(state))).toEqual({ U: 9, R: 9, F: 9, D: 9, L: 9, B: 9 });
  expect(isReachablePatternData(serializePattern(state.pattern))).toBe(true);
}

describe('slice geometry', () => {
  it('each middle slice holds exactly 8 visible cubies: 4 edges + 4 centres', () => {
    for (const axis of [0, 1, 2] as const) {
      const ids = cubiesInLayer(solved.cubies, axis, 0);
      expect(ids).toHaveLength(8);
      expect(ids.filter((id) => CUBIE_DEFS[id]!.kind === 'edge')).toHaveLength(4);
      expect(ids.filter((id) => CUBIE_DEFS[id]!.kind === 'center')).toHaveLength(4);
    }
  });

  it('a slice turn moves exactly its 8 cubies and leaves the other 18 untouched', () => {
    for (const family of SLICES) {
      const after = applyMove(solved, mv(family, 1)).cubies;
      const moved = after.filter((o, id) => !matEquals(o, solved.cubies[id]!)).length;
      expect(moved).toBe(8);
    }
  });
});

describe('slice directions (hand-derived)', () => {
  it('M follows L: U→F→D→B on the middle column', () => {
    const f = stateFacelets(applyMove(solved, mv('M', 1)));
    expect(faceSlice(f, 'U')).toBe('UBUUBUUBU');
    expect(faceSlice(f, 'F')).toBe('FUFFUFFUF');
    expect(faceSlice(f, 'D')).toBe('DFDDFDDFD');
    expect(faceSlice(f, 'B')).toBe('BDBBDBBDB');
    expect(faceSlice(f, 'R')).toBe('RRRRRRRRR');
    expect(faceSlice(f, 'L')).toBe('LLLLLLLLL');
  });

  it('E follows D: F→R→B→L on the middle row', () => {
    const f = stateFacelets(applyMove(solved, mv('E', 1)));
    expect(faceSlice(f, 'R')).toBe('RRRFFFRRR');
    expect(faceSlice(f, 'B')).toBe('BBBRRRBBB');
    expect(faceSlice(f, 'L')).toBe('LLLBBBLLL');
    expect(faceSlice(f, 'F')).toBe('FFFLLLFFF');
    expect(faceSlice(f, 'U')).toBe('UUUUUUUUU');
  });

  it('S follows F: U→R→D→L on the standing slice', () => {
    const f = stateFacelets(applyMove(solved, mv('S', 1)));
    expect(faceSlice(f, 'R')).toBe('RURRURRUR');
    expect(faceSlice(f, 'D')).toBe('DDDRRRDDD');
    expect(faceSlice(f, 'L')).toBe('LDLLDLLDL');
    expect(faceSlice(f, 'U')).toBe('UUULLLUUU');
    expect(faceSlice(f, 'F')).toBe('FFFFFFFFF');
  });

  it("whole-cube rotation identities: R M' L' = x, U E' D' = y, F S B' = z", () => {
    // x: F comes to U. Every face is a single colour, rotated as a whole.
    const x = stateFacelets(applyMoves(solved, parseAlg("R M' L'")));
    expect(x).toBe('FFFFFFFFF' + 'RRRRRRRRR' + 'DDDDDDDDD' + 'BBBBBBBBB' + 'LLLLLLLLL' + 'UUUUUUUUU');
    // y: R comes to F.
    const y = stateFacelets(applyMoves(solved, parseAlg("U E' D'")));
    expect(y).toBe('UUUUUUUUU' + 'BBBBBBBBB' + 'RRRRRRRRR' + 'DDDDDDDDD' + 'FFFFFFFFF' + 'LLLLLLLLL');
    // z: U comes to R.
    const z = stateFacelets(applyMoves(solved, parseAlg("F S B'")));
    expect(z).toBe('LLLLLLLLL' + 'UUUUUUUUU' + 'FFFFFFFFF' + 'RRRRRRRRR' + 'DDDDDDDDD' + 'BBBBBBBBB');
    // A rotated but solved cube counts as solved (the timer must stop on it).
    for (const alg of ["R M' L'", "U E' D'", "F S B'"]) expect(isSolved(applyMoves(solved, parseAlg(alg)))).toBe(true);
  });

  it('cubing.js KPattern agrees with the cubie model on every slice move', () => {
    for (const family of SLICES) {
      for (const turns of [1, 2, 3] as Turns[]) {
        const s = applyMove(solved, mv(family, turns));
        expect(patternFacelets(s.pattern)).toBe(stateFacelets(s));
      }
    }
  });
});

describe('slice algebra', () => {
  it('four quarter turns are the identity, physically too (centres return unspun)', () => {
    for (const family of SLICES) {
      let s = solved;
      for (let i = 0; i < 4; i++) s = applyMove(s, mv(family, 1));
      expect(sameLogicalState(s, solved)).toBe(true);
      s.cubies.forEach((o) => expect(matEquals(o, IDENTITY)).toBe(true));
    }
  });

  it('move then inverse, and two halves, are the identity', () => {
    for (const family of SLICES) {
      for (const turns of [1, 2, 3] as Turns[]) {
        const m = mv(family, turns);
        expect(stateFacelets(applyMoves(solved, [m, invertMove(m)]))).toBe(SOLVED_FACELETS);
      }
      expect(stateFacelets(applyMoves(solved, [mv(family, 2), mv(family, 2)]))).toBe(SOLVED_FACELETS);
    }
  });

  it('long seeded sequences over all nine families keep model, KPattern and invariants in agreement', () => {
    for (let seed = 1; seed <= 25; seed++) {
      let s = solved;
      for (const m of randomAllMoves(seededRandom(seed), 120)) {
        s = applyMove(s, m);
        expect(patternFacelets(s.pattern)).toBe(stateFacelets(s));
      }
      expectHealthy(s);
      // And the inverse sequence returns home.
    }
    const moves = randomAllMoves(seededRandom(99), 200);
    expect(stateFacelets(applyMoves(applyMoves(solved, moves), invertAlg(moves)))).toBe(SOLVED_FACELETS);
  });

  it('solved detectors agree on slice-heavy sequences', () => {
    const rand = seededRandom(7);
    let s = solved;
    for (let i = 0; i < 1500; i++) {
      s = applyMove(s, randomAllMoves(rand, 1)[0]!);
      expect(isSolved(s)).toBe(isFaceletStringSolved(stateFacelets(s)));
    }
  });

  it('metrics: a slice is 1 STM, 2 HTM, 2 QTM (M2: 4 QTM)', () => {
    expect(moveMetrics(mv('M', 1))).toEqual({ stm: 1, htm: 2, qtm: 2 });
    expect(moveMetrics(mv('E', 2))).toEqual({ stm: 1, htm: 2, qtm: 4 });
    expect(moveMetrics(mv('R', 2))).toEqual({ stm: 1, htm: 1, qtm: 2 });
  });
});

describe('legality and persistence after slices', () => {
  it('accepts slice-reachable patterns and rejects impossible centre arrangements and parity', () => {
    const state = applyMoves(solved, parseAlg("M E' S2 R U"));
    const data = serializePattern(state.pattern);
    expect(isReachablePatternData(data)).toBe(true);

    const swapped = structuredClone(data);
    const c = swapped['CENTERS']!.pieces;
    [c[0], c[5]] = [c[5]!, c[0]!]; // U and D centres swapped: a reflection, not a rotation
    expect(isReachablePatternData(swapped)).toBe(false);

    const parity = structuredClone(serializePattern(applyMove(solved, mv('M', 1)).pattern));
    const e = parity['EDGES']!.pieces;
    [e[0], e[1]] = [e[1]!, e[0]!]; // one edge swap breaks edge ⊕ corner = centre parity
    expect(isReachablePatternData(parity)).toBe(false);
  });

  it('saves and restores a cube that has been turned with slices', () => {
    const store = createMemoryStore();
    const state = applyMoves(solved, parseAlg("M' U2 E S' R2 M2 F"));
    saveCube(store, state, null);
    const restored = loadCube(store, kpuzzle)!;
    expect(restored).not.toBeNull();
    expect(sameLogicalState(restored.state, state)).toBe(true);
    expect(stateFacelets(restored.state)).toBe(stateFacelets(state));
  });
});

describe('engine and undo/redo with slices', () => {
  it('animates the 8-cubie slice layer and commits once at the animation boundary', () => {
    const clock = fakeClock();
    const engine = new CubeEngine(solved, { now: clock.now });
    const commits: CommitEvent[] = [];
    engine.subscribe((e) => e.type === 'commit' && commits.push(e));
    engine.enqueue(mv('M', 1), { source: 'manual', durationMs: 100 });
    engine.tick(clock.advance(50));
    const visual = engine.getVisualTurn()!;
    expect(visual.axis).toBe(0);
    expect(visual.layer).toBe(0);
    expect(visual.cubies).toHaveLength(8);
    expect(visual.angle).toBeGreaterThan(0); // M turns like L: positive about +X
    expect(commits).toHaveLength(0);
    engine.tick(clock.advance(60));
    expect(commits).toHaveLength(1);
    expect(stateFacelets(engine.state)).toBe(stateFacelets(applyMove(solved, mv('M', 1))));
  });

  it('undo and redo reverse and replay mixed face/slice sequences exactly', () => {
    const clock = fakeClock();
    const engine = new CubeEngine(solved, { now: clock.now });
    const run = () => {
      while (engine.isBusy()) engine.tick(clock.advance(16));
    };
    const moves = parseAlg("M R E' U S2 M'");
    for (const m of moves) {
      engine.enqueue(m, { source: 'manual', durationMs: 60 });
      run();
    }
    const after = engine.state;
    for (let i = 0; i < moves.length; i++) {
      engine.requestUndo(60);
      run();
    }
    expect(stateFacelets(engine.state)).toBe(SOLVED_FACELETS);
    for (let i = 0; i < moves.length; i++) {
      engine.requestRedo(60);
      run();
    }
    expect(sameLogicalState(engine.state, after)).toBe(true);
    expect(stateFacelets(engine.state)).toBe(stateFacelets(after));
  });
});

describe('auto solve with slices (real cubing.js solver)', () => {
  it('centre homing needs at most three slice turns for all 24 arrangements', () => {
    const rand = seededRandom(3);
    for (let i = 0; i < 120; i++) {
      const s = applyMoves(solved, randomAllMoves(rand, 30));
      const fix = centerFixSequence(s);
      expect(fix.length).toBeLessThanOrEqual(3);
      expect(fix.every((m) => SLICES.includes(m.family as (typeof SLICES)[number]))).toBe(true);
      expect(centersAtHome(applyMoves(s, fix).pattern)).toBe(true);
    }
  });

  it('solves many seeded states containing M/E/S, with no history, ending in the canonical orientation', async () => {
    for (let seed = 500; seed < 530; seed++) {
      const rand = seededRandom(seed);
      const state = applyMoves(solved, randomAllMoves(rand, 4 + Math.floor(rand() * 50)));
      const solution = await solveState(state);
      const end = applyMoves(state, solution);
      expect(isSolved(end), `seed ${seed}: ${formatAlg(solution)}`).toBe(true);
      expect(stateFacelets(end)).toBe(SOLVED_FACELETS); // white top, green front
    }
  });

  it('solves a lone slice turn and an odd-parity slice state', async () => {
    for (const alg of ['M', "E'", 'S2', 'M E S', "R M U'"]) {
      const state = applyMoves(solved, parseAlg(alg));
      const solution = await solveState(state);
      expect(stateFacelets(applyMoves(state, solution)), alg).toBe(SOLVED_FACELETS);
    }
  });

  it('treats a rotated-but-solved cube as solved (nothing to do)', async () => {
    expect(await solveState(applyMoves(solved, parseAlg("R M' L'")))).toEqual([]);
  });
});

describe('slice gestures under real perspective cameras', () => {
  /** Perspective projection of a 800×800 viewport for an orbit pose. */
  function cameraProject(azimuth: number, polar: number): Project {
    const rig = new OrbitRig();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const [x, y, z] = rig.position(12, { azimuth, polar, zoom: 1 });
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    return ([px, py, pz]) => {
      v.set(px, py, pz).project(camera);
      return { x: ((v.x + 1) / 2) * 800, y: ((1 - v.y) / 2) * 800 };
    };
  }

  /** Drags from a sticker centre toward a world target, like a user pushing it. */
  function dragMove(project: Project, normal: [number, number, number], point: [number, number, number], target: [number, number, number]): string | null {
    const a = project(point);
    const b = project(target);
    const drag = { x: b.x - a.x, y: b.y - a.y };
    const res = resolveTwist({ normal, point }, drag, project, { threshold: 6 });
    if (res.kind !== 'twist') return null;
    const snap = snapTwist(res.axis, res.layer, twistAngle(res, drag));
    return snap ? formatAlg([snap.move]) : null;
  }

  const poses = [
    { name: 'home three-quarter view', azimuth: HOME_POSE.azimuth, polar: HOME_POSE.polar },
    { name: 'orbited round to the back-left', azimuth: -2.4, polar: 1.15 },
    { name: 'looking up from below', azimuth: 0.4, polar: 2.3 },
  ];

  for (const pose of poses) {
    describe(pose.name, () => {
      // Only faces that point toward the camera are dragged; the expected move is view-independent.
      const project = cameraProject(pose.azimuth, pose.polar);
      const camDir = new THREE.Vector3(...new OrbitRig().position(1, { azimuth: pose.azimuth, polar: pose.polar, zoom: 1 }));
      const visible = (n: [number, number, number]) => camDir.dot(new THREE.Vector3(...n)) > 0.2;
      const cases: Array<{ normal: [number, number, number]; point: [number, number, number]; target: [number, number, number]; expected: string }> = [
        // Front face, middle column pushed up → stickers carried F→U: M' (M moves U→F).
        { normal: [0, 0, 1], point: [0, 0, 1.5], target: [0, 1.4, 1.5], expected: "M'" },
        { normal: [0, 0, 1], point: [0, -1, 1.5], target: [0, -2.4, 1.5], expected: 'M' },
        // Front face, middle row pushed right → F→R: E (E moves F→R, like D).
        { normal: [0, 0, 1], point: [0, 0, 1.5], target: [1.4, 0, 1.5], expected: 'E' },
        { normal: [0, 0, 1], point: [1, 0, 1.5], target: [-0.4, 0, 1.5], expected: "E'" },
        // Top face, middle row (z = 0) pushed right → U→R: S.
        { normal: [0, 1, 0], point: [0, 1.5, 0], target: [1.4, 1.5, 0], expected: 'S' },
        // Right face, middle column (z = 0) pushed up → D→R→U: S'.
        { normal: [1, 0, 0], point: [1.5, 0, 0], target: [1.5, 1.4, 0], expected: "S'" },
        // Right face, middle row pushed toward the back → F→R→B: E.
        { normal: [1, 0, 0], point: [1.5, 0, 1], target: [1.5, 0, -0.4], expected: 'E' },
        // Back face, middle column pushed up → B→U: M (M moves B→U).
        { normal: [0, 0, -1], point: [0, 0, -1.5], target: [0, 1.4, -1.5], expected: 'M' },
        // Bottom face, middle column pushed toward the front → D→F: M'.
        { normal: [0, -1, 0], point: [0, -1.5, 0], target: [0, -1.5, 1.4], expected: "M'" },
        // Outer strips next to the slice still turn outer faces.
        { normal: [0, 0, 1], point: [1, 0, 1.5], target: [1, 1.4, 1.5], expected: 'R' },
        { normal: [0, 0, 1], point: [0, 1, 1.5], target: [-1.4, 1, 1.5], expected: 'U' },
      ];
      for (const c of cases) {
        it(`${c.expected} from the ${JSON.stringify(c.normal)} face`, () => {
          if (!visible(c.normal)) return; // the user could not touch a hidden face from this view
          expect(dragMove(project, c.normal, c.point, c.target)).toBe(c.expected);
        });
      }
    });
  }
});
