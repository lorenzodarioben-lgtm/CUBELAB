import { describe, expect, it } from 'vitest';
import { exportPracticeCsv } from '../../src/core/stats/csv';

describe('practice CSV export', () => {
  it('writes exact raw and penalty-adjusted seconds', () => {
    const csv = exportPracticeCsv('444', [{ id: 'one', at: 1_000, durationMs: 12_345, penalty: '+2', source: 'manual', moves: 0, assisted: false, scramble: '' }]);
    expect(csv).toContain('"12.345","\'+2","14.345"');
    expect(csv).toContain('"1970-01-01T00:00:01.000Z"');
  });

  it('quotes embedded text and protects spreadsheet formulas', () => {
    const csv = exportPracticeCsv('pyram', [{ id: '=SUM(1,2)', at: 1_000, durationMs: 0, penalty: 'DNF', source: 'virtual', moves: 1, assisted: false, scramble: 'R "U"' }]);
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain('"DNF"');
    expect(csv).toContain('"R ""U"""');
  });
});
