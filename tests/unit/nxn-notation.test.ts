import { describe, expect, it } from 'vitest';
import { formatNxAlg, formatNxMove, parseNxAlg, parseNxMove } from '../../src/core/nxn/notation';

describe('NxN notation', () => {
  it('parses outer and wide turns from practice scrambles', () => {
    expect(parseNxAlg("R U' F2 Rw 3Uw2 2Lw'", 7)).toEqual([
      { face: 'R', width: 1, turns: 1 },
      { face: 'U', width: 1, turns: 3 },
      { face: 'F', width: 1, turns: 2 },
      { face: 'R', width: 2, turns: 1 },
      { face: 'U', width: 3, turns: 2 },
      { face: 'L', width: 2, turns: 3 },
    ]);
  });

  it('normalizes lowercase aliases and prime glyphs', () => {
    expect(parseNxMove('r’', 4)).toEqual({ face: 'R', width: 2, turns: 3 });
    expect(formatNxMove(parseNxMove('r2', 4))).toBe('Rw2');
    expect(formatNxAlg(parseNxAlg('R 3Rw2 B\'', 6))).toBe("R 3Rw2 B'");
  });

  it('rejects impossible, ambiguous and no-op turns', () => {
    for (const token of ['Rw', '2Rw', 'R4', 'R0', '2R', 'M', '8Rw']) {
      expect(() => parseNxMove(token, 2)).toThrow();
    }
    expect(parseNxAlg('   ', 4)).toEqual([]);
  });
});
