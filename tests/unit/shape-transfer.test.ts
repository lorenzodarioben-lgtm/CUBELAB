import { describe, expect, it } from 'vitest';
import { puzzles } from 'cubing/puzzles';
import { addManualShapeSolve, createShapeSession, setShapePenalty } from '../../src/core/shapes/session';
import { exportShapeHistory, importShapeHistory, mergeShapeHistory } from '../../src/core/shapes/transfer';

describe('shape result transfer', () => {
  it('round trips a Skewb result and keeps local penalty edits on merge', async () => {
    const kpuzzle = await puzzles.skewb!.kpuzzle();
    const original = addManualShapeSolve(createShapeSession('skewb', kpuzzle), 12_340, 'none', 1234, 'one').solves;
    const text = exportShapeHistory('skewb', original, 4567);
    expect(importShapeHistory(text, 'skewb', kpuzzle)).toEqual(original);
    const local = setShapePenalty(createShapeSession('skewb', kpuzzle, original), 'one', '+2').solves;
    expect(mergeShapeHistory(local, importShapeHistory(text, 'skewb', kpuzzle))[0]?.penalty).toBe('+2');
  });

  it('rejects an event mismatch and malformed records', async () => {
    const kpuzzle = await puzzles.pyraminx!.kpuzzle();
    const text = exportShapeHistory('skewb', []);
    expect(() => importShapeHistory(text, 'pyram', kpuzzle)).toThrow('not pyram');
    const bad = JSON.parse(exportShapeHistory('pyram', []));
    bad.solves.push({ id: 'x' });
    expect(() => importShapeHistory(JSON.stringify(bad), 'pyram', kpuzzle)).toThrow('invalid');
  });
});
