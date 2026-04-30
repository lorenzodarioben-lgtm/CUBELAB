import { describe, expect, it } from 'vitest';
import { faceFromNormal, mulVec } from '../../src/core/puzzle/geometry';
import { faceletIndex } from '../../src/core/puzzle/facelets';
import { applyMoves, createSolvedState, stateFacelets } from '../../src/core/puzzle/cubeState';
import { loadKPuzzle } from '../../src/core/puzzle/kpattern';
import { parseAlg } from '../../src/core/puzzle/notation';
import type { Face } from '../../src/core/puzzle/notation';
import { applyNxMove, applyNxMoves, createNxState, invertNxMove, isNxSolved, piecePosition } from '../../src/core/nxn/model';
import type { NxMove, NxState } from '../../src/core/nxn/model';

function facelets3(state: NxState): string {
  const result = Array<string>(54).fill('?');
  for (const piece of state.pieces) {
    const orientation = state.orientations[piece.id]!;
    const position = piecePosition(state, piece.id).map((value) => value / 2) as [number, number, number];
    for (const sticker of piece.stickers) {
      const face = faceFromNormal(mulVec(orientation, sticker.normal));
      result[faceletIndex(face, position)] = sticker.color;
    }
  }
  return result.join('');
}

describe('exact NxN piece model', () => {
  for (const size of [2, 3, 4, 5, 6, 7]) {
    it(`${size}×${size} has the right shell and sticker count`, () => {
      const state = createNxState(size);
      expect(state.pieces).toHaveLength(size ** 3 - Math.max(0, size - 2) ** 3);
      expect(state.pieces.reduce((count, piece) => count + piece.stickers.length, 0)).toBe(6 * size * size);
      expect(isNxSolved(state)).toBe(true);
    });

    it(`${size}×${size} turns invert and four quarters return home`, () => {
      const solved = createNxState(size);
      for (const face of ['U', 'R', 'F', 'D', 'L', 'B'] as const) {
        for (let width = 1; width < size; width++) {
          const move: NxMove = { face, width, turns: 1 };
          const turned = applyNxMove(solved, move);
          expect(isNxSolved(applyNxMove(turned, invertNxMove(move)))).toBe(true);
          expect(applyNxMoves(solved, [move, move, move, move]).orientations).toEqual(solved.orientations);
        }
      }
    });
  }

  it('matches the established 3×3 cubie model for long outer-face sequences', async () => {
    const alg = parseAlg("R U F2 L' B D2 R' U2 F L2 B' D");
    const legacy = applyMoves(createSolvedState(await loadKPuzzle()), alg);
    const generic = applyNxMoves(
      createNxState(3),
      alg.map((move) => ({ face: move.family as Face, width: 1, turns: move.turns })),
    );
    expect(facelets3(generic)).toBe(stateFacelets(legacy));
  });
});
