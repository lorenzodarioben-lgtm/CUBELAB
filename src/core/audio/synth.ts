/**
 * Procedural speedcube sound sources, rendered once into sample arrays.
 *
 * No recordings are used (none with clear provenance were available); every
 * sound is synthesised from a small physical model of plastic parts:
 *
 *  - Friction (the sliding layer): a dense train of micro stick-slip impacts
 *    plus a little continuous noise, exciting banks of strongly damped
 *    resonators — the modes of small ABS pieces sit around 1–9 kHz and die
 *    within a couple of milliseconds. Impacts are spread over three slightly
 *    different banks (several pieces rub at once), so no mode rings as a
 *    pitch; a breath of broadband noise fills between them. The result is a
 *    dry, finely textured "shh" rather than hiss or whistle. Rendered as long seamless loops; level and brightness
 *    are shaped at play time to follow the turn.
 *  - Rattle: isolated, slightly brighter pings — loose pieces knocking during
 *    fast turns.
 *  - Snap (magnetic alignment): a hard, very short contact pulse into lighter-
 *    damped modes plus a low body mode, followed by a smaller second contact a
 *    few milliseconds later as the piece settles against its neighbour.
 *
 * Everything is deterministic (seeded PRNG), pure and side-effect free, so it
 * renders identically on every load and is unit-tested without a browser.
 */

/** Small deterministic PRNG (mulberry32). */
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

interface Mode {
  /** Frequency (Hz). */
  readonly f: number;
  /** Exponential decay time constant (s). */
  readonly tau: number;
  /** Relative amplitude. */
  readonly a: number;
}

/**
 * Two-pole resonator bank: y[n] = 2r·cos(ω)·y[n−1] − r²·y[n−2] + g·x[n] per
 * mode, summed. Each mode's impulse response is a decaying sine of time
 * constant tau. The gain normalises modes to comparable peak response.
 */
function resonate(input: Float32Array, rate: number, modes: readonly Mode[]): Float32Array {
  const out = new Float32Array(input.length);
  for (const m of modes) {
    if (m.f >= rate * 0.45) continue;
    const r = Math.exp(-1 / (m.tau * rate));
    const w = (2 * Math.PI * m.f) / rate;
    const c1 = 2 * r * Math.cos(w);
    const c2 = -r * r;
    const g = m.a * Math.sin(w);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const y = c1 * y1 + c2 * y2 + g * input[i]!;
      out[i]! += y;
      y2 = y1;
      y1 = y;
    }
  }
  return out;
}

function peakOf(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!));
  return p;
}

function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
}

/**
 * Soft-limits peaks above `knee` (tanh), so the spiky stick-slip impacts keep
 * their texture but no sample can exceed 1.
 */
function softLimit(x: Float32Array, knee = 0.7): Float32Array {
  const room = 1 - knee;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]!);
    if (v > knee) x[i] = Math.sign(x[i]!) * (knee + room * Math.tanh((v - knee) / room));
  }
  return x;
}

function scale(x: Float32Array, k: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i]! *= k;
  return x;
}

/** One-pole high-pass (removes any rumble/DC). */
function highpass(x: Float32Array, rate: number, cutoff: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * cutoff) / rate);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < x.length; i++) {
    const y = a * (prevY + x[i]! - prevX);
    prevX = x[i]!;
    prevY = y;
    x[i] = y;
  }
  return x;
}

/** Jitters every mode frequency by up to ±spread (fraction). */
function jitterModes(modes: readonly Mode[], rand: () => number, spread: number): Mode[] {
  return modes.map((m) => ({ ...m, f: m.f * (1 + (rand() * 2 - 1) * spread) }));
}

/** Damped modes of the sliding plastic (friction). */
const FRICTION_MODES: readonly Mode[] = [
  { f: 1150, tau: 0.0026, a: 0.55 },
  { f: 1900, tau: 0.0023, a: 0.8 },
  { f: 2750, tau: 0.002, a: 1 },
  { f: 3900, tau: 0.0017, a: 0.9 },
  { f: 5400, tau: 0.0014, a: 0.7 },
  { f: 7300, tau: 0.0011, a: 0.5 },
  { f: 9600, tau: 0.0009, a: 0.3 },
];

/** Lighter-damped modes of a small piece struck at alignment (snap). */
const SNAP_MODES: readonly Mode[] = [
  { f: 560, tau: 0.009, a: 0.35 },
  { f: 1480, tau: 0.014, a: 0.55 },
  { f: 2380, tau: 0.011, a: 1 },
  { f: 3520, tau: 0.008, a: 0.8 },
  { f: 4850, tau: 0.006, a: 0.6 },
  { f: 6450, tau: 0.0042, a: 0.42 },
  { f: 8650, tau: 0.003, a: 0.26 },
];

/** Bright, short modes of a loose piece knocking (rattle). */
const RATTLE_MODES: readonly Mode[] = [
  { f: 3100, tau: 0.003, a: 1 },
  { f: 4700, tau: 0.0024, a: 0.8 },
  { f: 6300, tau: 0.0018, a: 0.6 },
  { f: 8800, tau: 0.0013, a: 0.4 },
];

/**
 * A seamless friction loop of `seconds`. `density` is the stick-slip rate
 * (impacts per second); the loop's last 40 ms are cross-faded into its start.
 * Normalised to an RMS of 0.25, with the rare impact peaks soft-limited below 1.
 */
export function frictionLoop(rate: number, seconds: number, seed: number, density = 1400): Float32Array {
  const rand = prng(seed);
  const fade = Math.floor(rate * 0.04);
  const n = Math.floor(rate * seconds);
  const total = n + fade;
  // Three rubbing contacts, each its own slightly different piece.
  const STREAMS = 3;
  const streams = Array.from({ length: STREAMS }, () => new Float32Array(total));
  // Continuous micro-roughness.
  for (const s of streams) for (let i = 0; i < total; i++) s[i] = (rand() * 2 - 1) * 0.18;
  // Stick-slip impacts: Poisson arrivals with exponentially distributed strength.
  let t = 0;
  while (true) {
    t += -Math.log(1 - rand()) / density;
    const i = Math.floor(t * rate);
    if (i >= total) break;
    const strength = -Math.log(1 - rand()) * (rand() < 0.5 ? -1 : 1);
    streams[Math.floor(rand() * STREAMS)]![i]! += strength;
  }
  const body = new Float32Array(total);
  for (const s of streams) {
    const rung = resonate(s, rate, jitterModes(FRICTION_MODES, rand, 0.12));
    for (let i = 0; i < total; i++) body[i]! += rung[i]!;
  }
  // A breath of broadband noise between the modes.
  const level = rmsOf(body);
  for (let i = 0; i < total; i++) body[i]! += (rand() * 2 - 1) * level * 0.35;
  highpass(body, rate, 300);
  // Loop seam: blend the overrun into the start (equal-power).
  const out = body.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = out[i]! * Math.sin((k * Math.PI) / 2) + body[n + i]! * Math.cos((k * Math.PI) / 2);
  }
  return softLimit(scale(out, 0.25 / Math.max(1e-9, rmsOf(out))));
}

/** A single rattle ping (~8 ms). Peak normalised to 0.8. */
export function rattleGrain(rate: number, seed: number): Float32Array {
  const rand = prng(seed);
  const n = Math.floor(rate * 0.012);
  const excitation = new Float32Array(n);
  const width = Math.max(2, Math.floor(rate * 0.0003));
  for (let i = 0; i < width; i++) excitation[i] = Math.sin((Math.PI * i) / width) * (0.7 + 0.3 * rand());
  for (let i = 0; i < Math.floor(rate * 0.0015); i++) excitation[i]! += (rand() * 2 - 1) * 0.15;
  const out = highpass(resonate(excitation, rate, jitterModes(RATTLE_MODES, rand, 0.08)), rate, 600);
  return scale(out, 0.8 / Math.max(1e-9, peakOf(out)));
}

/**
 * A magnetic alignment snap (~70 ms): a hard contact (a sub-millisecond
 * half-sine plus a breath of noise) into the snap modes, then a second, softer
 * contact 2.5–5 ms later as the piece settles. Peak normalised to 0.9.
 */
export function snapSample(rate: number, seed: number): Float32Array {
  const rand = prng(seed);
  const n = Math.floor(rate * 0.07);
  const excitation = new Float32Array(n);
  const hit = (start: number, amplitude: number, widthS: number) => {
    const i0 = Math.floor(start * rate);
    const width = Math.max(2, Math.floor(widthS * rate));
    for (let i = 0; i < width && i0 + i < n; i++) excitation[i0 + i]! += amplitude * Math.sin((Math.PI * i) / width);
    for (let i = 0; i < Math.floor(rate * 0.0006) && i0 + i < n; i++) excitation[i0 + i]! += (rand() * 2 - 1) * amplitude * 0.3;
  };
  hit(0, 1, 0.00022 + rand() * 0.00008);
  hit(0.0025 + rand() * 0.0025, 0.3 + rand() * 0.2, 0.0003);
  const out = highpass(resonate(excitation, rate, jitterModes(SNAP_MODES, rand, 0.04)), rate, 200);
  return scale(out, 0.9 / Math.max(1e-9, peakOf(out)));
}

/** The pre-rendered set the player draws from (a few variants of each). */
export interface SoundBank {
  readonly rate: number;
  readonly friction: readonly Float32Array[];
  readonly rattles: readonly Float32Array[];
  readonly snaps: readonly Float32Array[];
}

export const BANK_SIZES = { friction: 3, rattles: 6, snaps: 8 } as const;

export function renderSoundBank(rate: number): SoundBank {
  return {
    rate,
    friction: Array.from({ length: BANK_SIZES.friction }, (_, i) => frictionLoop(rate, 1.1, 101 + i * 17)),
    rattles: Array.from({ length: BANK_SIZES.rattles }, (_, i) => rattleGrain(rate, 211 + i * 13)),
    snaps: Array.from({ length: BANK_SIZES.snaps }, (_, i) => snapSample(rate, 307 + i * 11)),
  };
}
