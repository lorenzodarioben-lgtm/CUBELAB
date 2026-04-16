/**
 * Versioned, validated local persistence (localStorage by default).
 *
 * Every value is wrapped as `{ v, data }`. Loading never trusts the stored
 * shape: unknown versions, corrupt JSON and invalid fields degrade to safe
 * defaults, and anything that has to be discarded is first copied to a
 * `cubelab.backup.*` key so user data is never silently destroyed.
 * Nothing here talks to a network.
 */
import { KPattern } from 'cubing/kpuzzle';
import type { KPuzzle } from 'cubing/kpuzzle';
import { agrees } from '../puzzle/cubeState';
import type { CubeState } from '../puzzle/cubeState';
import { CUBIE_DEFS } from '../puzzle/cubies';
import type { CubieOrientations } from '../puzzle/cubies';
import { CUBE_ROTATIONS, mulVec, rotationIndex } from '../puzzle/geometry';
import { isReachablePatternData, serializePattern } from '../puzzle/kpattern';
import { parseAlg } from '../puzzle/notation';
import type { Penalty, TimerMode } from '../timing/timerMachine';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings';
import type { Settings } from './settings';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEYS = {
  settings: 'cubelab.settings',
  history: 'cubelab.history',
  cube: 'cubelab.cube',
} as const;

export const SETTINGS_VERSION = 1;
export const HISTORY_VERSION = 1;
export const CUBE_VERSION = 1;
export const HISTORY_LIMIT = 1000;

export interface SolveRecord {
  readonly id: string;
  /** Epoch ms at completion. */
  readonly timestamp: number;
  /** Raw elapsed time, full precision. */
  readonly durationMs: number;
  readonly penalty: Penalty;
  readonly scramble: string;
  /** Face/half-turn metric: each U, U' or U2 counts 1. */
  readonly turnsHTM: number;
  /** Quarter-turn metric: U2 counts 2. */
  readonly turnsQTM: number;
  readonly mode: TimerMode;
  readonly inspectionMs: number | null;
  /** Undo/redo used during the attempt: practice only, never ranked. */
  readonly assisted: boolean;
  readonly note: 'inspection-timeout' | 'stopped-early' | null;
}

/** In-memory store used when localStorage is unavailable (private mode, tests). */
export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export function browserStore(): KeyValueStore {
  try {
    const probe = '__cubelab_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return createMemoryStore();
  }
}

interface Envelope {
  readonly v: number;
  readonly data: unknown;
}

function readEnvelope(store: KeyValueStore, key: string): { envelope: Envelope | null; raw: string | null } {
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
    if (raw === null) return { envelope: null, raw };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'v' in parsed && typeof parsed.v === 'number' && 'data' in parsed) {
      return { envelope: { v: parsed.v, data: parsed.data }, raw };
    }
    return { envelope: { v: 0, data: parsed }, raw };
  } catch {
    return { envelope: null, raw };
  }
}

function write(store: KeyValueStore, key: string, v: number, data: unknown): boolean {
  try {
    store.setItem(key, JSON.stringify({ v, data }));
    return true;
  } catch {
    return false;
  }
}

function backup(store: KeyValueStore, key: string, raw: string | null): void {
  if (!raw) return;
  try {
    store.setItem(`cubelab.backup.${key.replace(/^cubelab\./, '')}`, raw);
  } catch {
    /* storage full: nothing more we can do safely */
  }
}

// ── Settings ─────────────────────────────────────────────────────────────

export function loadSettings(store: KeyValueStore): Settings {
  const { envelope, raw } = readEnvelope(store, STORAGE_KEYS.settings);
  if (!envelope) {
    if (raw !== null) backup(store, STORAGE_KEYS.settings, raw);
    return DEFAULT_SETTINGS;
  }
  if (envelope.v > SETTINGS_VERSION) return DEFAULT_SETTINGS;
  return sanitizeSettings(envelope.data);
}

export function saveSettings(store: KeyValueStore, settings: Settings): boolean {
  return write(store, STORAGE_KEYS.settings, SETTINGS_VERSION, settings);
}

// ── Solve history ────────────────────────────────────────────────────────

const PENALTIES: readonly Penalty[] = ['none', '+2', 'DNF'];

/** Validates one stored record; returns null if it cannot be trusted. */
export function sanitizeRecord(raw: unknown): SolveRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const isCount = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100_000;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 64) return null;
  if (typeof r.timestamp !== 'number' || !Number.isFinite(r.timestamp) || r.timestamp <= 0) return null;
  if (typeof r.durationMs !== 'number' || !Number.isFinite(r.durationMs) || r.durationMs < 0 || r.durationMs > 864e5) return null;
  if (!PENALTIES.includes(r.penalty as Penalty)) return null;
  if (typeof r.scramble !== 'string' || r.scramble.length > 400) return null;
  if (r.scramble !== '') {
    try {
      parseAlg(r.scramble);
    } catch {
      return null;
    }
  }
  if (!isCount(r.turnsHTM) || !isCount(r.turnsQTM)) return null;
  if (r.mode !== 'casual' && r.mode !== 'spacebar') return null;
  const inspectionMs =
    typeof r.inspectionMs === 'number' && Number.isFinite(r.inspectionMs) && r.inspectionMs >= 0 ? r.inspectionMs : null;
  const note = r.note === 'inspection-timeout' || r.note === 'stopped-early' ? r.note : null;
  return {
    id: r.id,
    timestamp: r.timestamp,
    durationMs: r.durationMs,
    penalty: r.penalty as Penalty,
    scramble: r.scramble,
    turnsHTM: r.turnsHTM as number,
    turnsQTM: r.turnsQTM as number,
    mode: r.mode,
    inspectionMs,
    assisted: r.assisted === true,
    note,
  };
}

export interface LoadedHistory {
  readonly records: SolveRecord[];
  /** Number of stored entries that failed validation and were dropped. */
  readonly dropped: number;
}

export function loadHistory(store: KeyValueStore): LoadedHistory {
  const { envelope, raw } = readEnvelope(store, STORAGE_KEYS.history);
  if (!envelope) {
    if (raw !== null) backup(store, STORAGE_KEYS.history, raw);
    return { records: [], dropped: raw === null ? 0 : 1 };
  }
  if (envelope.v > HISTORY_VERSION || !Array.isArray(envelope.data)) {
    backup(store, STORAGE_KEYS.history, raw);
    return { records: [], dropped: Array.isArray(envelope.data) ? envelope.data.length : 1 };
  }
  const records: SolveRecord[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of envelope.data as unknown[]) {
    const record = sanitizeRecord(item);
    if (record && !seen.has(record.id)) {
      seen.add(record.id);
      records.push(record);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) backup(store, STORAGE_KEYS.history, raw);
  records.sort((a, b) => a.timestamp - b.timestamp);
  return { records: records.slice(-HISTORY_LIMIT), dropped };
}

export function saveHistory(store: KeyValueStore, records: readonly SolveRecord[]): boolean {
  return write(store, STORAGE_KEYS.history, HISTORY_VERSION, records.slice(-HISTORY_LIMIT));
}

// ── Cube snapshot ────────────────────────────────────────────────────────

export interface CubeSnapshot {
  readonly state: CubeState;
  readonly scramble: string | null;
}

export function saveCube(store: KeyValueStore, state: CubeState, scramble: string | null): boolean {
  return write(store, STORAGE_KEYS.cube, CUBE_VERSION, {
    pattern: serializePattern(state.pattern),
    cubies: state.cubies.map(rotationIndex),
    scramble,
  });
}

function restoreOrientations(raw: unknown): CubieOrientations | null {
  if (!Array.isArray(raw) || raw.length !== CUBIE_DEFS.length) return null;
  const orientations = raw.map((i) => (Number.isInteger(i) && i >= 0 && i < CUBE_ROTATIONS.length ? CUBE_ROTATIONS[i as number]! : null));
  if (orientations.some((o) => o === null)) return null;
  const occupied = new Set<string>();
  for (const def of CUBIE_DEFS) {
    const pos = mulVec(orientations[def.id]!, def.home);
    const nonZero = pos.filter((c) => c !== 0).length;
    if (nonZero !== def.stickers.length) return null; // corner must sit in a corner slot, etc.
    const key = pos.join(',');
    if (occupied.has(key)) return null;
    occupied.add(key);
  }
  return orientations as CubieOrientations;
}

/** Restores a persisted cube if, and only if, it is legal and self-consistent. */
export function loadCube(store: KeyValueStore, kpuzzle: KPuzzle): CubeSnapshot | null {
  const { envelope } = readEnvelope(store, STORAGE_KEYS.cube);
  if (!envelope || envelope.v !== CUBE_VERSION) return null;
  const data = envelope.data as { pattern?: unknown; cubies?: unknown; scramble?: unknown } | null;
  if (!data || !isReachablePatternData(data.pattern)) return null;
  const cubies = restoreOrientations(data.cubies);
  if (!cubies) return null;
  let state: CubeState;
  try {
    state = { pattern: new KPattern(kpuzzle, data.pattern), cubies };
  } catch {
    return null;
  }
  if (!agrees(state)) return null;
  let scramble: string | null = null;
  if (typeof data.scramble === 'string' && data.scramble.length <= 400) {
    try {
      parseAlg(data.scramble);
      scramble = data.scramble;
    } catch {
      scramble = null;
    }
  }
  return { state, scramble };
}

export function clearKey(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}
