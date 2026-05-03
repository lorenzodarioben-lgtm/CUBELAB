import { describe, expect, it } from 'vitest';
import { applyNxMoves, createNxState, isNxSolved } from '../../src/core/nxn/model';
import { generateNxScramble } from '../../src/core/nxn/scramble';

describe('NxN practice scrambles', () => {
  it('validates a 2×2 scramble against the physical piece model', async () => {
    const result = await generateNxScramble('222', async () => "R U R' U'");
    expect(result.text).toBe("R U R' U'");
    expect(isNxSolved(applyNxMoves(createNxState(2), result.moves))).toBe(false);
  });

  it('keeps wide turns for big cubes', async () => {
    const result = await generateNxScramble('777', async () => "3Rw U2 3Fw' Lw");
    expect(result.text).toBe("3Rw U2 3Fw' Lw");
  });

  it('retries invalid source output before failing', async () => {
    let count = 0;
    const result = await generateNxScramble('444', async () => (++count === 1 ? '8Rw' : 'Rw U'), 2);
    expect(count).toBe(2);
    expect(result.moves).toHaveLength(2);
    await expect(generateNxScramble('222', async () => 'Rw', 1)).rejects.toThrow('valid 2×2');
  });
});
