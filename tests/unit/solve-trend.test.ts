import { describe, expect, it } from 'vitest';
import { buildSolveTrend } from '../../src/core/stats/trend';

describe('recent clean solve trend', () => {
  it('places faster times higher and uses +2 adjusted times', () => {
    const trend = buildSolveTrend([
      { durationMs: 20_000, penalty: 'none', assisted: false },
      { durationMs: 15_000, penalty: '+2', assisted: false },
    ])!;
    expect(trend.lastMs).toBe(17_000);
    expect(trend.points[1]!.y).toBeLessThan(trend.points[0]!.y);
  });

  it('excludes DNFs and assisted attempts', () => {
    expect(buildSolveTrend([
      { durationMs: 20_000, penalty: 'none', assisted: false },
      { durationMs: 10_000, penalty: 'DNF', assisted: false },
      { durationMs: 5_000, penalty: 'none', assisted: true },
    ])).toBeNull();
  });
});
