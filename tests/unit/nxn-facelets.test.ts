import { describe, expect, it } from 'vitest';
import { applyNxMoves, createNxState } from '../../src/core/nxn/model';
import { nxFacelets } from '../../src/core/nxn/facelets';
import { parseNxAlg } from '../../src/core/nxn/notation';
import { FACES } from '../../src/core/puzzle/notation';
import { parseAlg } from '../../src/core/puzzle/notation';
import { applyMoves, createSolvedState, stateFacelets } from '../../src/core/puzzle/cubeState';
import { loadKPuzzle } from '../../src/core/puzzle/kpattern';
import type { Face } from '../../src/core/puzzle/notation';

describe('NxN 2D facelets', () => {
  it('gives each face exactly n² stickers for all supported sizes', () => {
    for (const size of [2, 3, 4, 5, 6, 7]) {
      const colors = nxFacelets(applyNxMoves(createNxState(size), parseNxAlg(size === 2 ? 'R U' : "R U Rw'", size)));
      for (const face of FACES) expect(colors[face]).toHaveLength(size * size);
    }
  });

  it('projects solved colours to their own faces', () => {
    const colors = nxFacelets(createNxState(4));
    for (const face of FACES) expect(new Set(colors[face])).toEqual(new Set([face]));
  });

  it('agrees sticker for sticker with the established 3×3 model', async () => {
    const text = "R U F2 L' B D2 R' U2";
    const nx = nxFacelets(applyNxMoves(createNxState(3), parseAlg(text).map((move) => ({ face: move.family as Face, width: 1, turns: move.turns }))));
    const legacy = stateFacelets(applyMoves(createSolvedState(await loadKPuzzle()), parseAlg(text)));
    expect(FACES.flatMap((face) => nx[face]).join('')).toBe(legacy);
  });
});
