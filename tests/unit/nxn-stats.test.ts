import { describe, expect, it } from 'vitest';
import { bestMeanOf3, currentMeanOf3, summarizeNx } from '../../src/core/nxn/stats';
import type { NxSolve } from '../../src/core/nxn/session';

const records = (times: number[]): NxSolve[] => times.map((durationMs, index) => ({
  id: String(index), at: index + 1, durationMs, penalty: 'none', source: 'manual', scramble: '', moves: 0, assisted: false,
}));

describe('NxN event statistics', () => {
  it('uses an untrimmed mean of three for 6×6 and 7×7', () => {
    const solves = records([30_000, 33_000, 39_000]);
    expect(currentMeanOf3(solves)).toBe(34_000);
    expect(summarizeNx('666', solves).currentLabel).toBe('Current mo3');
  });

  it('treats a DNF as a DNF mean and ignores assisted practice', () => {
    const solves = [...records([30_000, 33_000, 39_000]), { ...records([0])[0]!, id: 'dnf', penalty: 'DNF' as const }];
    expect(currentMeanOf3(solves)).toBe(Infinity);
    expect(bestMeanOf3(solves)).toBe(34_000);
    expect(currentMeanOf3([...solves, { ...records([20_000])[0]!, id: 'help', assisted: true }])).toBe(Infinity);
  });

  it('shows rolling ao5 and ao12 for smaller events', () => {
    const solves = records([10_000, 11_000, 12_000, 13_000, 14_000]);
    const stats = summarizeNx('222', solves);
    expect(stats.current).toBe(12_000);
    expect(stats.secondary).toBeNull();
    expect(stats.currentLabel).toBe('Current ao5');
  });
});
