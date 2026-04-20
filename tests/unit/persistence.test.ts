import { beforeAll, describe, expect, it } from 'vitest';
import type { KPuzzle } from 'cubing/kpuzzle';
import { applyMoves, createSolvedState, sameLogicalState, stateFacelets } from '../../src/core/puzzle/cubeState';
import { loadKPuzzle } from '../../src/core/puzzle/kpattern';
import { parseAlg } from '../../src/core/puzzle/notation';
import { DEFAULT_SETTINGS } from '../../src/core/persistence/settings';
import {
  STORAGE_KEYS,
  createMemoryStore,
  loadCube,
  loadHistory,
  loadSettings,
  saveCube,
  saveHistory,
  saveSettings,
} from '../../src/core/persistence/storage';
import type { SolveRecord } from '../../src/core/persistence/storage';

let kpuzzle: KPuzzle;
beforeAll(async () => {
  kpuzzle = await loadKPuzzle();
});

const record = (over: Partial<SolveRecord> = {}): SolveRecord => ({
  id: 'a1',
  timestamp: 1_700_000_000_000,
  durationMs: 12_345.6,
  penalty: 'none',
  scramble: "R U F'",
  turnsSTM: 40,
  turnsHTM: 40,
  turnsQTM: 46,
  mode: 'casual',
  inspectionMs: null,
  assisted: false,
  note: null,
  ...over,
});

describe('settings', () => {
  it('round-trips and survives a reload', () => {
    const store = createMemoryStore();
    saveSettings(store, { ...DEFAULT_SETTINGS, sound: true, timerMode: 'spacebar', orbitSensitivity: 1.4 });
    const loaded = loadSettings(store);
    expect(loaded.sound).toBe(true);
    expect(loaded.timerMode).toBe('spacebar');
    expect(loaded.orbitSensitivity).toBe(1.4);
  });

  it('falls back field-by-field on invalid values', () => {
    const store = createMemoryStore({
      [STORAGE_KEYS.settings]: JSON.stringify({ v: 1, data: { sound: 'yes', quality: 'ultra', orbitSensitivity: 99, finish: 'matte' } }),
    });
    const loaded = loadSettings(store);
    expect(loaded.sound).toBe(DEFAULT_SETTINGS.sound);
    expect(loaded.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(loaded.orbitSensitivity).toBe(2);
    expect(loaded.finish).toBe('matte');
  });

  it('handles corrupt JSON and missing data safely, keeping a backup', () => {
    const store = createMemoryStore({ [STORAGE_KEYS.settings]: '{not json' });
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(store.getItem('cubelab.backup.settings')).toBe('{not json');
    expect(loadSettings(createMemoryStore())).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores data from a newer schema', () => {
    const store = createMemoryStore({ [STORAGE_KEYS.settings]: JSON.stringify({ v: 99, data: { sound: true } }) });
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('history', () => {
  it('round-trips records', () => {
    const store = createMemoryStore();
    saveHistory(store, [record(), record({ id: 'b2', penalty: 'DNF', timestamp: 1_700_000_000_100 })]);
    const { records, dropped } = loadHistory(store);
    expect(dropped).toBe(0);
    expect(records.map((r) => r.id)).toEqual(['a1', 'b2']);
    expect(records[0]!.durationMs).toBe(12_345.6);
  });

  it('drops invalid and duplicate records but keeps the rest', () => {
    const store = createMemoryStore({
      [STORAGE_KEYS.history]: JSON.stringify({
        v: 1,
        data: [record(), record(), { id: 'x', durationMs: -5 }, record({ id: 'c3', scramble: 'Rw r' }), 'junk', record({ id: 'd4' })],
      }),
    });
    const { records, dropped } = loadHistory(store);
    expect(records.map((r) => r.id)).toEqual(['a1', 'd4']);
    expect(dropped).toBe(4);
    expect(store.getItem('cubelab.backup.history')).not.toBeNull();
  });

  it('treats a bare legacy array as schema v0 and validates each entry', () => {
    const store = createMemoryStore({ [STORAGE_KEYS.history]: JSON.stringify([record({ id: 'legacy' }), { time: 12 }]) });
    const { records, dropped } = loadHistory(store);
    expect(records.map((r) => r.id)).toEqual(['legacy']);
    expect(dropped).toBe(1);
  });

  it('survives corrupt JSON', () => {
    const store = createMemoryStore({ [STORAGE_KEYS.history]: '[[[' });
    expect(loadHistory(store).records).toEqual([]);
  });
});

describe('cube snapshot', () => {
  it('restores the exact scrambled state including cubie identities', () => {
    const store = createMemoryStore();
    const state = applyMoves(createSolvedState(kpuzzle), parseAlg("R U2 F' L D2 B R'"));
    saveCube(store, state, "R U2 F' L D2 B R'");
    const restored = loadCube(store, kpuzzle)!;
    expect(restored).not.toBeNull();
    expect(sameLogicalState(restored.state, state)).toBe(true);
    expect(stateFacelets(restored.state)).toBe(stateFacelets(state));
    expect(restored.scramble).toBe("R U2 F' L D2 B R'");
  });

  it('rejects tampered or inconsistent snapshots', () => {
    const store = createMemoryStore();
    const state = applyMoves(createSolvedState(kpuzzle), parseAlg('R U'));
    saveCube(store, state, null);
    const raw = JSON.parse(store.getItem(STORAGE_KEYS.cube)!);

    const twisted = structuredClone(raw);
    twisted.data.pattern.CORNERS.orientation[0] = (twisted.data.pattern.CORNERS.orientation[0] + 1) % 3;
    store.setItem(STORAGE_KEYS.cube, JSON.stringify(twisted));
    expect(loadCube(store, kpuzzle)).toBeNull();

    const mismatched = structuredClone(raw);
    mismatched.data.cubies = mismatched.data.cubies.map(() => 0);
    store.setItem(STORAGE_KEYS.cube, JSON.stringify(mismatched));
    expect(loadCube(store, kpuzzle)).toBeNull();

    store.setItem(STORAGE_KEYS.cube, 'garbage');
    expect(loadCube(store, kpuzzle)).toBeNull();
  });
});
