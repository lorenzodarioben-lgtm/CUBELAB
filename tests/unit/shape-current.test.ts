import { describe, expect, it } from 'vitest';
import { puzzles } from 'cubing/puzzles';
import { createMemoryStore } from '../../src/core/persistence/storage';
import { loadShapeCurrent, saveShapeCurrent, shapeCurrentKey } from '../../src/core/shapes/current';
import { createShapeSession, scrambleShapeSession, turnShapeSession } from '../../src/core/shapes/session';

describe('shape current puzzle persistence', () => {
  it('restores exact moves without restarting the timer', async () => {
    const store = createMemoryStore();
    const kpuzzle = await puzzles.pyraminx!.kpuzzle();
    let session = scrambleShapeSession(createShapeSession('pyram', kpuzzle), 'U L');
    session = turnShapeSession(session, "L'", 100, 200, 'one');
    saveShapeCurrent(store, session);
    const restored = loadShapeCurrent(store, 'pyram', kpuzzle, []);
    expect(restored.pattern.isIdentical(session.pattern)).toBe(true);
    expect(restored.scramble).toBe('U L');
    expect(restored.phase).toBe('idle');
    expect(restored.startedAt).toBeNull();
    expect(restored.assisted).toBe(true);
  });

  it('backs up invalid saved moves', async () => {
    const store = createMemoryStore();
    const kpuzzle = await puzzles.skewb!.kpuzzle();
    store.setItem(shapeCurrentKey('skewb'), JSON.stringify({ v: 1, eventId: 'skewb', scramble: null, moves: ['impossible'] }));
    const restored = loadShapeCurrent(store, 'skewb', kpuzzle, []);
    expect(restored.moves).toHaveLength(0);
    expect(store.getItem('cubelab.backup.shape.skewb.current')).not.toBeNull();
  });
});
