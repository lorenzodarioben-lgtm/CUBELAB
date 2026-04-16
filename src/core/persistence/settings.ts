/** User preferences, persisted locally. Every field is validated on load. */
import type { TimerMode } from '../timing/timerMachine';

export type TurnSpeed = 'relaxed' | 'normal' | 'snappy' | 'instant';
export type PlaybackSpeed = 'slow' | 'normal' | 'fast';
export type ScrambleStyle = 'animate' | 'instant';
export type Quality = 'auto' | 'high' | 'low';
export type Finish = 'gloss' | 'matte';
export type MotionPreference = 'system' | 'reduce' | 'full';
export type KeyMap = 'faces' | 'speed';
export type TouchMode = 'twist' | 'orbit';
export type PadLayers = 'faces' | 'slices';

export interface Settings {
  readonly turnSpeed: TurnSpeed;
  readonly playbackSpeed: PlaybackSpeed;
  readonly scrambleStyle: ScrambleStyle;
  readonly timerMode: TimerMode;
  readonly inspection: boolean;
  readonly quality: Quality;
  readonly finish: Finish;
  readonly faceLabels: boolean;
  readonly sound: boolean;
  readonly motion: MotionPreference;
  readonly orbitSensitivity: number;
  readonly keyMap: KeyMap;
  readonly touchMode: TouchMode;
  readonly movePadOpen: boolean;
  /** Which bank the Move Pad shows: the six faces or the three slices. */
  readonly padLayers: PadLayers;
}

export const DEFAULT_SETTINGS: Settings = {
  turnSpeed: 'normal',
  playbackSpeed: 'normal',
  scrambleStyle: 'animate',
  timerMode: 'casual',
  inspection: true,
  quality: 'auto',
  finish: 'gloss',
  faceLabels: false,
  sound: false,
  motion: 'system',
  orbitSensitivity: 1,
  keyMap: 'faces',
  touchMode: 'twist',
  movePadOpen: true,
  padLayers: 'faces',
};

/** Quarter-turn animation length for manual turns. */
export const TURN_DURATION_MS: Readonly<Record<TurnSpeed, number>> = {
  relaxed: 260,
  normal: 175,
  snappy: 110,
  instant: 0,
};

/** Per-move duration for solver playback. */
export const PLAYBACK_DURATION_MS: Readonly<Record<PlaybackSpeed, number>> = {
  slow: 620,
  normal: 340,
  fast: 150,
};

/** Per-move duration for animated scrambles (deliberately brisk). */
export const SCRAMBLE_DURATION_MS = 85;

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Coerces arbitrary data into valid settings, field by field. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    turnSpeed: pick(r.turnSpeed, ['relaxed', 'normal', 'snappy', 'instant'], d.turnSpeed),
    playbackSpeed: pick(r.playbackSpeed, ['slow', 'normal', 'fast'], d.playbackSpeed),
    scrambleStyle: pick(r.scrambleStyle, ['animate', 'instant'], d.scrambleStyle),
    timerMode: pick(r.timerMode, ['casual', 'spacebar'], d.timerMode),
    inspection: bool(r.inspection, d.inspection),
    quality: pick(r.quality, ['auto', 'high', 'low'], d.quality),
    finish: pick(r.finish, ['gloss', 'matte'], d.finish),
    faceLabels: bool(r.faceLabels, d.faceLabels),
    sound: bool(r.sound, d.sound),
    motion: pick(r.motion, ['system', 'reduce', 'full'], d.motion),
    orbitSensitivity: num(r.orbitSensitivity, 0.4, 2, d.orbitSensitivity),
    keyMap: pick(r.keyMap, ['faces', 'speed'], d.keyMap),
    touchMode: pick(r.touchMode, ['twist', 'orbit'], d.touchMode),
    movePadOpen: bool(r.movePadOpen, d.movePadOpen),
    padLayers: pick(r.padLayers, ['faces', 'slices'], d.padLayers),
  };
}
