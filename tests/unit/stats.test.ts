import { describe, expect, it } from 'vitest';
import { DNF, bestAverage, bestSingle, currentAverage, effectiveMs, sessionMean, summarize, trimmedAverage } from '../../src/core/stats/stats';
import type { TimedResult } from '../../src/core/stats/stats';
import { formatAverage, formatTime, formatTps } from '../../src/core/stats/format';

const r = (durationMs: number, penalty: TimedResult['penalty'] = 'none', assisted = false): TimedResult => ({ durationMs, penalty, assisted });

describe('effective time', () => {
  it('applies +2 and DNF', () => {
    expect(effectiveMs(r(10_000))).toBe(10_000);
    expect(effectiveMs(r(10_000, '+2'))).toBe(12_000);
    expect(effectiveMs(r(10_000, 'DNF'))).toBe(DNF);
  });
});

describe('trimmed averages', () => {
  it('ao5 drops one best and one worst', () => {
    expect(trimmedAverage([10_000, 12_000, 11_000, 9_000, 20_000])).toBe(11_000);
  });

  it('one DNF is the dropped worst; two DNFs make the average DNF', () => {
    expect(trimmedAverage([10_000, 12_000, 11_000, 9_000, DNF])).toBe(11_000);
    expect(trimmedAverage([10_000, DNF, 11_000, 9_000, DNF])).toBe(DNF);
  });

  it('+2 is applied before trimming', () => {
    const results = [r(10_000), r(10_000, '+2'), r(11_000), r(9_000), r(13_000)];
    expect(currentAverage(results, 5)).toBe(11_000); // 10 000, 11 000, 12 000 kept
  });

  it('handles ties exactly', () => {
    expect(trimmedAverage([10_000, 10_000, 10_000, 10_000, 10_000])).toBe(10_000);
  });

  it('keeps exact millisecond arithmetic', () => {
    expect(trimmedAverage([10_001, 10_002, 10_004, 1, 99_999])).toBeCloseTo(10_002.333_333, 5);
  });

  it('ao12 trims one each side', () => {
    const times = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 100].map((s) => r(s * 1000));
    expect(currentAverage(times, 12)).toBe(10_500);
  });

  it('returns null without enough solves', () => {
    expect(currentAverage([r(1), r(2), r(3), r(4)], 5)).toBeNull();
    expect(bestAverage([r(1)], 12)).toBeNull();
  });

  it('best rolling average finds the best window', () => {
    const times = [20, 20, 20, 20, 20, 10, 10, 10, 10, 10].map((s) => r(s * 1000));
    expect(bestAverage(times, 5)).toBe(10_000);
  });
});

describe('eligibility', () => {
  it('assisted solves never contaminate PB or averages', () => {
    const results = [r(5_000, 'none', true), r(10_000), r(11_000), r(12_000), r(13_000), r(1_000, 'none', true), r(14_000)];
    expect(bestSingle(results)).toBe(10_000);
    expect(currentAverage(results, 5)).toBe(12_000);
    expect(summarize(results).count).toBe(5);
  });

  it('DNF singles are never a best', () => {
    expect(bestSingle([r(1_000, 'DNF')])).toBeNull();
    expect(bestSingle([r(1_000, 'DNF'), r(9_000)])).toBe(9_000);
  });

  it('session mean excludes DNFs', () => {
    expect(sessionMean([r(10_000), r(1, 'DNF'), r(20_000)])).toBe(15_000);
    expect(sessionMean([])).toBeNull();
  });

  it('empty history reports no statistics at all', () => {
    expect(summarize([])).toEqual({ count: 0, finished: 0, best: null, ao5: null, ao12: null, bestAo5: null, bestAo12: null, mean: null });
  });
});

describe('formatting', () => {
  it('truncates singles and rounds averages to hundredths', () => {
    expect(formatTime(12_345.9)).toBe('12.34');
    expect(formatAverage(12_345.9)).toBe('12.35');
    expect(formatTime(9_990)).toBe('9.99');
    expect(formatTime(0)).toBe('0.00');
  });

  it('adds minutes and hours', () => {
    expect(formatTime(61_005)).toBe('1:01.00');
    expect(formatTime(3_600_000 + 61_005)).toBe('1:01:01.00');
  });

  it('renders DNF and missing values', () => {
    expect(formatTime(DNF)).toBe('DNF');
    expect(formatTime(null)).toBe('—');
  });

  it('computes turns per second', () => {
    expect(formatTps(50, 10_000)).toBe('5.00');
    expect(formatTps(0, 10_000)).toBeNull();
  });
});
