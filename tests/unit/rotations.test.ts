/**
 * Whole-cube rotations x / y / z.
 *
 * Expectations come from the definitions (x turns like R, y like U, z like F)
 * and from physical-cube identities, e.g. after `x2` the top layer is the old
 * D layer, so `x2 U` is the same as `D x2`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { KPuzzle } from 'cubing/kpuzzle';
import { applyMoves, agrees, createSolvedState, isSolved, stateFacelets } from '../../src/core/puzzle/cubeState';
import type { CubeState } from '../../src/core/puzzle/cubeState';
import { faceSlice, isFaceletStringSolved } from '../../src/core/puzzle/facelets';
import { centersAtHome, isReachablePatternData, loadKPuzzle, patternFacelets, serializePattern } from '../../src/core/puzzle/kpattern';
import { MOVE_FAMILIES, countHTM, countQTM, countSTM, formatAlg, moveMetrics, mv, parseAlg } from '../../src/core/puzzle/notation';
import type { Move, Turns } from '../../src/core/puzzle/notation';
import { solveState } from '../../src/core/solver/solver';
import { createMemoryStore, loadCube, saveCube } from '../../src/core/persistence/storage';
import { createTimerState, timerTransition } from '../../src/core/timing/timerMachine';
import { seededRandom } from './helpers';

let kpuzzle: KPuzzle;
let solved: CubeState;

beforeAll(async () => {
  kpuzzle = await loadKPuzzle();
  solved = createSolvedState(kpuzzle);
});

const at = (alg: string) => applyMoves(solved, parseAlg(alg));
const centre = (s: CubeState, face: 'U' | 'D' | 'F' | 'B' | 'R' | 'L') => faceSlice(stateFacelets(s), face)[4];

/** Random sequence over every family, rotations included. */
function randomMoves(rand: () => number, length: number): Move[] {
  return Array.from({ length }, () => mv(MOVE_FAMILIES[Math.floor(rand() * MOVE_FAMILIES.length)]!, (1 + Math.floor(rand() * 3)) as Turns));
}

describe('notation and metrics', () => {
  it('parses and formats x y z with primes and doubles', () => {
    expect(formatAlg(parseAlg("x y' z2 x3"))).toBe("x y' z2 x'");
  });

  it('counts zero in every metric, so they never inflate a solve', () => {
    for (const r of ['x', "y'", 'z2']) expect(moveMetrics(parseAlg(r)[0]!)).toEqual({ stm: 0, htm: 0, qtm: 0 });
    const alg = parseAlg("x R y U2 z' M");
    expect(countSTM(alg)).toBe(3);
    expect(countHTM(alg)).toBe(4);
    expect(countQTM(alg)).toBe(5);
  });
});

describe('directions', () => {
  it('x turns like R: the front comes to the top', () => {
    const s = at('x');
    expect(centre(s, 'U')).toBe('F');
    expect(centre(s, 'F')).toBe('D');
    expect(centre(s, 'R')).toBe('R');
  });

  it('y turns like U: the right comes to the front', () => {
    const s = at('y');
    expect(centre(s, 'F')).toBe('R');
    expect(centre(s, 'L')).toBe('F');
    expect(centre(s, 'U')).toBe('U');
  });

  it('z turns like F: the top goes to the right', () => {
    const s = at('z');
    expect(centre(s, 'R')).toBe('U');
    expect(centre(s, 'U')).toBe('L');
    expect(centre(s, 'F')).toBe('F');
  });

  it('x2 puts white on the bottom and yellow on top, still solved', () => {
    const s = at('x2');
    expect(faceSlice(stateFacelets(s), 'U')).toBe('DDDDDDDDD');
    expect(faceSlice(stateFacelets(s), 'D')).toBe('UUUUUUUUU');
    expect(isSolved(s)).toBe(true);
    expect(isFaceletStringSolved(stateFacelets(s))).toBe(true);
  });

  it('moves act on positions: after x2, U turns the yellow layer (x2 U = D x2)', () => {
    expect(stateFacelets(at('x2 U'))).toBe(stateFacelets(at('D x2')));
    expect(stateFacelets(at("y R"))).toBe(stateFacelets(at("B y")));
    expect(stateFacelets(at("z U"))).toBe(stateFacelets(at("L z")));
  });

  it('four quarter rotations are the identity; a rotation and its inverse cancel', () => {
    for (const r of ['x', 'y', 'z']) {
      expect(stateFacelets(at(`${r} ${r} ${r} ${r}`))).toBe(stateFacelets(solved));
      expect(stateFacelets(at(`R U ${r} ${r}'`))).toBe(stateFacelets(at('R U')));
    }
  });
});

describe('model consistency and legality', () => {
  it('cubie model and cubing.js pattern agree through mixed sequences with rotations', () => {
    const rand = seededRandom(41);
    for (let i = 0; i < 60; i++) {
      const s = applyMoves(solved, randomMoves(rand, 1 + Math.floor(rand() * 40)));
      expect(stateFacelets(s)).toBe(patternFacelets(s.pattern));
      expect(agrees(s)).toBe(true);
      expect(isReachablePatternData(serializePattern(s.pattern))).toBe(true);
    }
  });

  it('a rotated cube persists and restores exactly', () => {
    const s = at("x2 R U' y M");
    const store = createMemoryStore();
    expect(saveCube(store, s, null)).toBe(true);
    const restored = loadCube(store, kpuzzle);
    expect(restored).not.toBeNull();
    expect(stateFacelets(restored!.state)).toBe(stateFacelets(s));
  });
});

describe('timer', () => {
  it('a rotation never starts the clock', () => {
    let state = createTimerState('casual', false);
    state = timerTransition(state, { type: 'scrambleStarted' }).state;
    state = timerTransition(state, { type: 'scrambleApplied', scramble: "R U F'" }).state;
    expect(state.phase).toBe('ready');
    const after = timerTransition(state, { type: 'manualTurn', at: 10, metrics: { stm: 0, htm: 0, qtm: 0 }, solved: false }).state;
    expect(after).toBe(state);
  });
});

describe('auto solve after rotations', () => {
  it('keeps the orientation the user chose: after x2 + turns, yellow stays on top', async () => {
    const state = at("x2 R U'");
    const solution = await solveState(state);
    const end = applyMoves(state, solution);
    expect(isSolved(end)).toBe(true);
    expect(centre(end, 'U')).toBe('D');
    expect(solution.length).toBeLessThanOrEqual(4);
    expect(solution.every((m) => moveMetrics(m).stm === 1)).toBe(true);
  });

  it('a merely rotated cube needs nothing', async () => {
    expect(await solveState(at("x y2 z'"))).toEqual([]);
  });

  it('solves random states that mix faces, slices and rotations', async () => {
    const rand = seededRandom(77);
    for (let i = 0; i < 12; i++) {
      const state = applyMoves(solved, randomMoves(rand, 10 + Math.floor(rand() * 30)));
      const solution = await solveState(state);
      const end = applyMoves(state, solution);
      expect(isSolved(end), formatAlg(solution)).toBe(true);
      expect(isFaceletStringSolved(stateFacelets(end))).toBe(true);
    }
  });

  it('centre homing is unaffected: a lone slice still comes back as its inverse', async () => {
    const s = at('S');
    expect(centersAtHome(s.pattern)).toBe(false);
    expect(formatAlg(await solveState(s))).toBe("S'");
  });
});
