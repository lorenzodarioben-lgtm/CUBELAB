import { describe, expect, it } from 'vitest';
import { addManualNxSolve, createNxSession, setNxPenalty } from '../../src/core/nxn/session';
import { exportNxHistory, importNxHistory, mergeNxHistory } from '../../src/core/nxn/transfer';

const sample = addManualNxSolve(createNxSession(2), 12_340, 'none', 1234, 'one').solves;

describe('NxN result transfer', () => {
  it('round trips a puzzle result file', () => {
    expect(importNxHistory(exportNxHistory('222', sample, 4567), '222')).toEqual(sample);
  });

  it('rejects a different event and invalid records', () => {
    expect(() => importNxHistory(exportNxHistory('222', sample), '444')).toThrow('not 444');
    expect(() => importNxHistory('not json', '222')).toThrow('valid');
    const bad = JSON.parse(exportNxHistory('222', sample));
    bad.solves[0].durationMs = -3;
    expect(() => importNxHistory(JSON.stringify(bad), '222')).toThrow('invalid');
    bad.solves[0].durationMs = 12_340;
    bad.solves.push(bad.solves[0]);
    expect(() => importNxHistory(JSON.stringify(bad), '222')).toThrow('duplicate');
  });

  it('merges without duplicating or replacing local corrections', () => {
    const local = setNxPenalty(createNxSession(2, sample), 'one', '+2').solves;
    const incoming = addManualNxSolve(createNxSession(2, sample), 9_000, 'none', 2345, 'two').solves;
    const merged = mergeNxHistory(local, incoming);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.penalty).toBe('+2');
    expect(merged[1]?.id).toBe('two');
  });
});
