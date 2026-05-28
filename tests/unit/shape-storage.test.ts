import { describe, expect, it } from 'vitest';
import { puzzles } from 'cubing/puzzles';
import { createMemoryStore } from '../../src/core/persistence/storage';
import { addManualShapeSolve, createShapeSession, scrambleShapeSession, setShapePenalty, turnShapeSession } from '../../src/core/shapes/session';
import { loadShapeHistory, saveShapeHistory, shapeHistoryKey } from '../../src/core/shapes/storage';

describe('shape event history', () => {
  it('keeps Pyraminx and Skewb results in separate validated stores', async () => {
    const store = createMemoryStore();
    const pyram = await puzzles.pyraminx!.kpuzzle();
    const skewb = await puzzles.skewb!.kpuzzle();
    const solved = turnShapeSession(scrambleShapeSession(createShapeSession('pyram', pyram), 'U'), "U'", 100, 200, 'one');
    expect(saveShapeHistory(store, 'pyram', solved.solves)).toBe(true);
    expect(loadShapeHistory(store, 'pyram', pyram)).toEqual(solved.solves);
    expect(loadShapeHistory(store, 'skewb', skewb)).toEqual([]);
    store.setItem(shapeHistoryKey('skewb'), store.getItem(shapeHistoryKey('pyram'))!);
    expect(loadShapeHistory(store, 'skewb', skewb)).toEqual([]);
    expect(store.getItem('cubelab.backup.shape.skewb.history')).not.toBeNull();
  });

  it('preserves a physical result and its penalty', async () => {
    const store = createMemoryStore();
    const kpuzzle = await puzzles.skewb!.kpuzzle();
    const session = addManualShapeSolve(createShapeSession('skewb', kpuzzle), 12_340, '+2', 1234, 'physical');
    saveShapeHistory(store, 'skewb', session.solves);
    expect(loadShapeHistory(store, 'skewb', kpuzzle)).toEqual(session.solves);
  });

  it('recomputes a shape personal best after penalty correction', async () => {
    const kpuzzle = await puzzles.skewb!.kpuzzle();
    const session = addManualShapeSolve(createShapeSession('skewb', kpuzzle), 12_340, 'none', 1234, 'one');
    expect(setShapePenalty(session, 'one', '+2').solves[0]?.penalty).toBe('+2');
    expect(setShapePenalty(session, 'missing', 'DNF')).toBe(session);
  });
});
