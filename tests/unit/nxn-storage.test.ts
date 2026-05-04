import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/core/persistence/storage';
import { loadNxHistory, nxHistoryKey, saveNxHistory } from '../../src/core/nxn/storage';

describe('event-scoped NxN history', () => {
  const solve = { id: 'one', at: 12, durationMs: 1234, scramble: 'R U', moves: 8, assisted: false };

  it('keeps puzzle records in separate versioned keys', () => {
    const store = createMemoryStore();
    expect(saveNxHistory(store, '222', [solve])).toBe(true);
    expect(loadNxHistory(store, '222')).toEqual([solve]);
    expect(loadNxHistory(store, '444')).toEqual([]);
    expect(nxHistoryKey('222')).not.toBe(nxHistoryKey('444'));
  });

  it('preserves a backup when stored history is corrupt', () => {
    const store = createMemoryStore({ [nxHistoryKey('222')]: '{broken' });
    expect(loadNxHistory(store, '222')).toEqual([]);
    expect(store.getItem('cubelab.backup.nxn.222.history')).toBe('{broken');
  });

  it('rejects records with invalid notation', () => {
    const store = createMemoryStore({
      [nxHistoryKey('222')]: JSON.stringify({ v: 1, data: [solve, { ...solve, id: 'bad', scramble: 'Rw' }] }),
    });
    expect(loadNxHistory(store, '222')).toEqual([solve]);
    expect(store.getItem('cubelab.backup.nxn.222.history')).not.toBeNull();
  });
});
