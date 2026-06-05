import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/core/persistence/storage';
import { loadNxCurrent, nxCurrentKey, saveNxCurrent } from '../../src/core/nxn/current';
import { isNxSolved } from '../../src/core/nxn/model';
import { parseNxAlg } from '../../src/core/nxn/notation';
import { createNxSession, scrambleNxSession, turnNxSession } from '../../src/core/nxn/session';

describe('NxN current puzzle persistence', () => {
  it('restores the scramble and committed turns without reviving its timer', () => {
    const store = createMemoryStore();
    let session = scrambleNxSession(createNxSession(4), { text: 'Rw U', moves: parseNxAlg('Rw U', 4) });
    session = turnNxSession(session, parseNxAlg("R'", 4)[0]!, 100, 200, 'one');
    saveNxCurrent(store, '444', session);
    const restored = loadNxCurrent(store, '444', 4, []);
    expect(restored.cube).toEqual(session.cube);
    expect(restored.scramble).toBe('Rw U');
    expect(restored.phase).toBe('idle');
    expect(restored.startedAt).toBeNull();
    expect(restored.assisted).toBe(true);
  });

  it('keeps saved puzzle state event-specific and backs up corrupt data', () => {
    const store = createMemoryStore();
    const turned = turnNxSession(createNxSession(2), parseNxAlg('R', 2)[0]!, 100, 200, 'one');
    saveNxCurrent(store, '222', turned);
    expect(isNxSolved(loadNxCurrent(store, '222', 2, []).cube)).toBe(false);
    expect(isNxSolved(loadNxCurrent(store, '444', 4, []).cube)).toBe(true);
    store.setItem(nxCurrentKey('222'), '{bad');
    expect(isNxSolved(loadNxCurrent(store, '222', 2, []).cube)).toBe(true);
    expect(store.getItem('cubelab.backup.nxn.222.current')).toBe('{bad');
  });
});
