import { describe, expect, it } from 'vitest';
import { parseManualTime } from '../../src/core/nxn/manualTime';
import { addManualNxSolve, bestNxSingle, createNxSession, setNxPenalty } from '../../src/core/nxn/session';

describe('physical solve entry', () => {
  it('accepts seconds and minute notation without rounding away precision', () => {
    expect(parseManualTime('12.34')).toBe(12_340);
    expect(parseManualTime('1:02.345')).toBe(62_345);
    expect(parseManualTime('8')).toBe(8000);
  });

  it('rejects invalid or ambiguous times', () => {
    for (const text of ['', '0', '-1.00', '1:75.00', 'foo', '12.3456']) expect(parseManualTime(text)).toBeNull();
  });

  it('keeps physical times in history without touching the puzzle', () => {
    const before = createNxSession(4);
    const after = addManualNxSolve(before, 35_200, '+2', 1234, 'physical');
    expect(after.cube).toBe(before.cube);
    expect(after.phase).toBe('idle');
    expect(after.solves[0]).toMatchObject({ source: 'manual', penalty: '+2', scramble: '', durationMs: 35_200 });
    expect(bestNxSingle(after.solves)).toBe(37_200);
  });

  it('recomputes the best single after a penalty correction', () => {
    const before = addManualNxSolve(createNxSession(2), 20_000, 'none', 1234, 'one');
    expect(bestNxSingle(setNxPenalty(before, 'one', '+2').solves)).toBe(22_000);
    expect(bestNxSingle(setNxPenalty(before, 'one', 'DNF').solves)).toBeNull();
  });
});
