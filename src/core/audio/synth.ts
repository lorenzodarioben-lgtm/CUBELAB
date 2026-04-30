/**
 * Real Rubik's cube turn recordings, prepared as a compact PCM bank.
 * The original CC0 files and reproducible preparation script are documented in
 * src/assets/audio/README.md. No decoding or network request occurs per turn.
 */
import bankWav from '../../assets/audio/cube-turn-bank.wav?inline';
import segments from '../../assets/audio/segments.json';

/** Small deterministic PRNG (mulberry32), also used by the visual materials. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SoundBank {
  readonly rate: number;
  readonly friction: readonly Float32Array[];
  readonly rattles: readonly Float32Array[];
  readonly snaps: readonly Float32Array[];
}

export const BANK_SIZES = {
  friction: segments.friction.length,
  rattles: segments.rattles.length,
  snaps: segments.snaps.length,
} as const;

let source: SoundBank | null = null;

function unpack(): SoundBank {
  if (source) return source;
  const encoded = bankWav.slice(bankWav.indexOf(',') + 1);
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const read = ([start, length]: number[]): Float32Array => {
    const samples = new Float32Array(length!);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + (start! + i) * 2, true) / 32768;
    return samples;
  };
  source = {
    rate: segments.rate,
    friction: segments.friction.map(read),
    rattles: segments.rattles.map(read),
    snaps: segments.snaps.map(read),
  };
  return source;
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const output = new Float32Array(Math.max(1, Math.round(input.length * to / from)));
  for (let i = 0; i < output.length; i++) {
    const at = i * from / to;
    const left = Math.min(input.length - 1, Math.floor(at));
    const right = Math.min(input.length - 1, left + 1);
    const u = at - left;
    output[i] = input[left]! * (1 - u) + input[right]! * u;
  }
  return output;
}

/** Return fresh arrays because the Web Audio buffers own their copied samples. */
export function renderSoundBank(rate: number): SoundBank {
  const bank = unpack();
  const atRate = (samples: readonly Float32Array[]) => samples.map((x) => resample(x, bank.rate, rate).slice());
  return { rate, friction: atRate(bank.friction), rattles: atRate(bank.rattles), snaps: atRate(bank.snaps) };
}
