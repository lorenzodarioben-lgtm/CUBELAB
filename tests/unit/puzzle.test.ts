import { beforeAll, describe, expect, it } from 'vitest';
import { applyMove, applyMoves, agrees, isSolved, sameLogicalState, stateFacelets } from '../../src/core/puzzle/cubeState';
import type { CubeState } from '../../src/core/puzzle/cubeState';
import { CUBIE_DEFS, cubiePosition, cubieFacelets } from '../../src/core/puzzle/cubies';
import { SOLVED_FACELETS, colorHistogram, faceSlice, isFaceletStringSolved } from '../../src/core/puzzle/facelets';
import { IDENTITY, isCubeRotation, matEquals, CUBE_ROTATIONS } from '../../src/core/puzzle/geometry';
import { patternFacelets } from '../../src/core/puzzle/kpattern';
import { FACES, formatAlg, invertAlg, invertMove, mv, parseAlg, parseMove, NotationError, countQTM } from '../../src/core/puzzle/notation';
import type { Turns } from '../../src/core/puzzle/notation';
import { FACE_COLORS, OPPOSITE_FACE } from '../../src/core/puzzle/colors';
import { randomMoves, seededRandom, solvedState } from './helpers';

let solved: CubeState;

beforeAll(async () => {
  solved = await solvedState();
});

function expectIdentical(a: CubeState, b: CubeState) {
  expect(sameLogicalState(a, b)).toBe(true);
  expect(stateFacelets(a)).toBe(stateFacelets(b));
}

function expectHealthy(state: CubeState) {
  expect(agrees(state)).toBe(true);
  const positions = new Set<string>();
  for (const def of CUBIE_DEFS) {
    expect(isCubeRotation(state.cubies[def.id]!)).toBe(true);
    const pos = cubiePosition(state.cubies, def.id);
    expect(pos.every((c) => c === -1 || c === 0 || c === 1)).toBe(true);
    expect(pos.filter((c) => c !== 0).length).toBe(def.stickers.length);
    positions.add(pos.join(','));
  }
  expect(positions.size).toBe(26);
  expect(colorHistogram(stateFacelets(state))).toEqual({ U: 9, R: 9, F: 9, D: 9, L: 9, B: 9 });
}

describe('solved cube', () => {
  it('has 26 cubies: 8 corners, 12 edges, 6 centres, 54 stickers', () => {
    expect(CUBIE_DEFS).toHaveLength(26);
    expect(CUBIE_DEFS.filter((c) => c.kind === 'corner')).toHaveLength(8);
    expect(CUBIE_DEFS.filter((c) => c.kind === 'edge')).toHaveLength(12);
    expect(CUBIE_DEFS.filter((c) => c.kind === 'center')).toHaveLength(6);
    expect(CUBIE_DEFS.reduce((n, c) => n + c.stickers.length, 0)).toBe(54);
  });

  it('projects to the solved facelet string with nine stickers per colour', () => {
    expect(stateFacelets(solved)).toBe(SOLVED_FACELETS);
    expect(patternFacelets(solved.pattern)).toBe(SOLVED_FACELETS);
    expect(colorHistogram(SOLVED_FACELETS)).toEqual({ U: 9, R: 9, F: 9, D: 9, L: 9, B: 9 });
    expect(isSolved(solved)).toBe(true);
  });

  it('keeps the six centres fixed in the standard reference frame', () => {
    for (const face of FACES) {
      const centre = CUBIE_DEFS.find((c) => c.kind === 'center' && c.stickers[0]!.color === face)!;
      expect(faceSlice(SOLVED_FACELETS, face)[4]).toBe(face);
      for (const m of randomMoves(seededRandom(7), 40)) {
        // No outer turn can move a centre off its axis.
        expect(cubiePosition(applyMove(solved, m).cubies, centre.id)).toEqual(centre.home);
      }
    }
  });

  it('uses the conventional colour scheme with correct opposite pairs', () => {
    expect(FACE_COLORS.U.name).toBe('white');
    expect(FACE_COLORS.D.name).toBe('yellow');
    expect(FACE_COLORS.F.name).toBe('green');
    expect(FACE_COLORS.B.name).toBe('blue');
    expect(FACE_COLORS.R.name).toBe('red');
    expect(FACE_COLORS.L.name).toBe('orange');
    expect(OPPOSITE_FACE).toEqual({ U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' });
  });
});

describe('notation', () => {
  it('parses and formats every outer-face token', () => {
    expect(parseMove("R'")).toEqual(mv('R', 3));
    expect(parseMove('U2')).toEqual(mv('U', 2));
    expect(parseMove("B2'")).toEqual(mv('B', 2));
    expect(parseMove('D3')).toEqual(mv('D', 3));
    expect(parseMove('F’')).toEqual(mv('F', 3));
    expect(formatAlg(parseAlg(" R  U' F2\nB ")).toString()).toBe("R U' F2 B");
    expect(countQTM(parseAlg("R U2 F'"))).toBe(4);
  });

  it('rejects rotations, wide moves and no-ops (slices are accepted)', () => {
    expect(parseMove("M'")).toEqual(mv('M', 3));
    expect(parseMove('E2')).toEqual(mv('E', 2));
    expect(parseMove('S')).toEqual(mv('S', 1));
    for (const bad of ['x', 'y', 'Rw', 'r', 'R4', '(R', 'Q', "R''", 'M4']) {
      expect(() => parseMove(bad)).toThrow(NotationError);
    }
  });

  it('inverts moves and algorithms', () => {
    expect(invertMove(mv('R', 1))).toEqual(mv('R', 3));
    expect(invertMove(mv('R', 2))).toEqual(mv('R', 2));
    expect(formatAlg(invertAlg(parseAlg("R U F'")))).toBe("F U' R'");
  });
});

describe('face turns (hand-derived facelets)', () => {
  it('R moves F→U→B→D→F on the right layer', () => {
    expect(stateFacelets(applyMove(solved, mv('R', 1)))).toBe(
      'UUFUUFUUF' + 'RRRRRRRRR' + 'FFDFFDFFD' + 'DDBDDBDDB' + 'LLLLLLLLL' + 'UBBUBBUBB',
    );
  });

  it('U moves R→F→L→B→R on the top layer', () => {
    expect(stateFacelets(applyMove(solved, mv('U', 1)))).toBe(
      'UUUUUUUUU' + 'BBBRRRRRR' + 'RRRFFFFFF' + 'DDDDDDDDD' + 'FFFLLLLLL' + 'LLLBBBBBB',
    );
  });

  it('F moves U→R→D→L→U on the front layer', () => {
    expect(stateFacelets(applyMove(solved, mv('F', 1)))).toBe(
      'UUUUUULLL' + 'URRURRURR' + 'FFFFFFFFF' + 'RRRDDDDDD' + 'LLDLLDLLD' + 'BBBBBBBBB',
    );
  });

  it('L, D and B are the mirror images (not accidentally inverted)', () => {
    // L clockwise (seen from the left) carries U stickers down onto F.
    expect(faceSlice(stateFacelets(applyMove(solved, mv('L', 1))), 'F')).toBe('UFFUFFUFF');
    // D clockwise (seen from below) carries F stickers onto R.
    expect(faceSlice(stateFacelets(applyMove(solved, mv('D', 1))), 'R')).toBe('RRRRRRFFF');
    // B clockwise (seen from behind) carries R stickers onto U's back row.
    expect(faceSlice(stateFacelets(applyMove(solved, mv('B', 1))), 'U')).toBe('RRRUUUUUU');
  });

  it('checkerboard pattern lands exactly where expected', () => {
    const f = stateFacelets(applyMoves(solved, parseAlg('U2 D2 F2 B2 L2 R2')));
    expect(faceSlice(f, 'U')).toBe('UDUDUDUDU');
    expect(faceSlice(f, 'F')).toBe('FBFBFBFBF');
    expect(faceSlice(f, 'R')).toBe('RLRLRLRLR');
  });
});

describe('group identities', () => {
  it('every face turned four times returns exactly to the start, logically and physically', () => {
    for (const face of FACES) {
      let s = solved;
      for (let i = 0; i < 4; i++) {
        s = applyMove(s, mv(face, 1));
        expectHealthy(s);
      }
      expectIdentical(s, solved);
      // Physical identity too: every cubie, including the turned centre, is back home.
      s.cubies.forEach((o) => expect(matEquals(o, IDENTITY)).toBe(true));
    }
  });

  it('every move followed by its inverse is the identity', () => {
    for (const face of FACES) {
      for (const turns of [1, 2, 3] as Turns[]) {
        const m = mv(face, turns);
        const s = applyMove(applyMove(solved, m), invertMove(m));
        expectIdentical(s, solved);
        s.cubies.forEach((o) => expect(matEquals(o, IDENTITY)).toBe(true));
      }
    }
  });

  it('every double turn applied twice is the identity', () => {
    for (const face of FACES) {
      expectIdentical(applyMoves(solved, [mv(face, 2), mv(face, 2)]), solved);
    }
  });

  it("sexy move (R U R' U') has order 6", () => {
    const sexy = parseAlg("R U R' U'");
    let s = solved;
    for (let i = 1; i <= 6; i++) {
      s = applyMoves(s, sexy);
      expectHealthy(s);
      expect(isSolved(s)).toBe(i === 6);
    }
    expectIdentical(s, solved);
  });

  it('(R U) has order 105 on the stickers', () => {
    let s = solved;
    for (let i = 1; i <= 105; i++) {
      s = applyMoves(s, parseAlg('R U'));
      if (i < 105) expect(isSolved(s)).toBe(false);
    }
    expect(isSolved(s)).toBe(true);
    expect(isFaceletStringSolved(stateFacelets(s))).toBe(true);
  });

  it('a sequence followed by its inverse returns home for long random mixed-axis sequences', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const moves = randomMoves(seededRandom(seed), 20 + seed * 7);
      const s = applyMoves(applyMoves(solved, moves), invertAlg(moves));
      expectIdentical(s, solved);
    }
  });
});

describe('model ↔ KPattern agreement', () => {
  it('cubie facelets equal KPattern facelets after every move of long random sequences', () => {
    for (let seed = 100; seed < 130; seed++) {
      let s = solved;
      for (const m of randomMoves(seededRandom(seed), 120)) {
        s = applyMove(s, m);
        expect(cubieFacelets(s.cubies)).toBe(patternFacelets(s.pattern));
      }
      expectHealthy(s);
    }
  });

  it('the two solved detectors always agree', () => {
    const rand = seededRandom(5);
    let s = solved;
    for (let i = 0; i < 2000; i++) {
      s = applyMove(s, randomMoves(rand, 1)[0]!);
      expect(isSolved(s)).toBe(isFaceletStringSolved(stateFacelets(s)));
    }
  });

  it('the rotation table contains exactly the 24 proper cube rotations', () => {
    expect(CUBE_ROTATIONS).toHaveLength(24);
    CUBE_ROTATIONS.forEach((r) => expect(isCubeRotation(r)).toBe(true));
  });
});
