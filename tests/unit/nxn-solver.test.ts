import { describe, expect, it } from 'vitest';
import { applyNxMoves, createNxState, isNxSolved } from '../../src/core/nxn/model';
import { parseNxAlg } from '../../src/core/nxn/notation';
import { solveTwoByTwo } from '../../src/core/nxn/solver';

describe('2×2 state solver', () => {
  it('solves a scrambled state and verifies the physical pieces', async () => {
    const scramble = "R U F R' U2 F'";
    const state = applyNxMoves(createNxState(2), parseNxAlg(scramble, 2));
    const solution = await solveTwoByTwo(state, scramble, []);
    expect(solution.length).toBeGreaterThan(0);
    expect(isNxSolved(applyNxMoves(state, solution))).toBe(true);
  }, 60_000);

  it('accepts a state reached by user turns after the scramble', async () => {
    const scramble = 'R U';
    const moves = parseNxAlg("F' R", 2);
    const state = applyNxMoves(createNxState(2), [...parseNxAlg(scramble, 2), ...moves]);
    expect(isNxSolved(applyNxMoves(state, await solveTwoByTwo(state, scramble, moves)))).toBe(true);
  }, 60_000);
});
