/**
 * Turns the engine's motion events into a plan of sounds — pure and
 * deterministic, so every timing and level rule is unit-tested without a
 * browser. The Web Audio player (`sound.ts`) only executes the plan.
 *
 * One physical turn is one coherent sound made of three layers:
 *   1. slide  — friction while the layer moves, from the turn's start, with a
 *               level that follows the layer's actual angular speed along its
 *               easing curve, and brightness that rises with speed;
 *   2. rattle — one or two quiet knocks, only on fast turns;
 *   3. snap   — the magnetic alignment, at the commit (the instant the layer
 *               lands), louder and brighter for faster turns.
 * A double turn also passes a magnet half-way: a faint detent tick when the
 * layer crosses each intermediate quarter.
 *
 * Pointer twists: while the finger drags, a continuous friction voice follows
 * the smoothed angular velocity of the layer; release hands over to the turn
 * (which inherits the flick's speed), cancel springs back with a soft slide
 * and only a faint settle tick — never a full snap.
 *
 * Whole-cube rotations (x y z) are a re-grip in the hand: silent. Instant
 * turns (reduced motion, skipped scrambles) get one compact sound, rate-
 * limited so a batch of instant commits makes a single sound.
 */
import { easeInOutCubic, easeSnap } from '../engine/cubeEngine';
import type { DragMotionEvent, EngineEvent, MoveSource, TurnEasing, TurnStartEvent } from '../engine/cubeEngine';
import { isRotation, isSlice } from '../puzzle/notation';
import type { Move } from '../puzzle/notation';
import { BANK_SIZES, prng } from './synth';

export type Voice =
  | {
      readonly kind: 'slide';
      /** Engine time (ms) the sound starts. */
      readonly at: number;
      readonly durationMs: number;
      /** Level over the duration, evenly spaced samples in [0, 1]. */
      readonly envelope: readonly number[];
      readonly gain: number;
      /** 0…1: maps to the low-pass cutoff. */
      readonly brightness: number;
      readonly texture: number;
      /** Start offset into the loop (s), so consecutive turns never repeat. */
      readonly offset: number;
    }
  | { readonly kind: 'rattle'; readonly at: number; readonly gain: number; readonly variant: number; readonly rate: number }
  | { readonly kind: 'snap'; readonly at: number; readonly gain: number; readonly variant: number; readonly rate: number; readonly brightness: number }
  | { readonly kind: 'drag-start'; readonly at: number; readonly texture: number; readonly offset: number }
  | { readonly kind: 'drag-level'; readonly at: number; readonly gain: number; readonly brightness: number }
  | { readonly kind: 'drag-stop'; readonly at: number }
  | { readonly kind: 'stop-all'; readonly at: number };

/** Level of each source relative to the user's own turns. */
const SOURCE_GAIN: Readonly<Record<MoveSource, number>> = { manual: 1, undo: 0.9, redo: 0.9, solver: 0.75, scramble: 0.5 };

/** Angular speed (rad/s) mapped to 0…1 intensity: ~3 rad/s is a lazy turn, ~22 rad/s a hard flick. */
export function intensityOf(radPerSecond: number): number {
  const t = Math.min(1, Math.max(0, (Math.abs(radPerSecond) - 3) / 19));
  return t ** 0.8;
}

const EASINGS: Readonly<Record<TurnEasing, (t: number) => number>> = { snap: easeSnap, smooth: easeInOutCubic };
const ENVELOPE_POINTS = 24;

/**
 * Friction level over a turn: the layer's angular speed along its easing
 * (numerical derivative), normalised, with a perceptual exponent and a few-ms
 * attack unless the layer was already moving (a released drag).
 */
export function slideEnvelope(easing: TurnEasing, alreadyMoving: boolean): number[] {
  const ease = EASINGS[easing];
  const h = 1e-3;
  const speeds = Array.from({ length: ENVELOPE_POINTS }, (_, i) => {
    const t = Math.min(1 - h, Math.max(h, i / (ENVELOPE_POINTS - 1)));
    return Math.abs(ease(t + h) - ease(t - h)) / (2 * h);
  });
  const max = Math.max(...speeds, 1e-9);
  const env = speeds.map((v) => (v / max) ** 0.6);
  if (!alreadyMoving) env[0] = 0;
  env[env.length - 1] = 0;
  return env;
}

/** Times (fraction of the turn) at which the layer crosses each quarter strictly between `from` and `to`. */
export function detentCrossings(easing: TurnEasing, from: number, to: number): number[] {
  const ease = EASINGS[easing];
  const quarter = Math.PI / 2;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const crossings: number[] = [];
  for (let k = Math.ceil((lo + 1e-6) / quarter); k * quarter < hi - 1e-6; k++) {
    if (k === 0) continue;
    const target = (k * quarter - from) / (to - from);
    // Bisection on the eased progress (monotonic up to the end, where easeSnap's overshoot lives).
    let a = 0;
    let b = 1;
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (ease(m) < target) a = m;
      else b = m;
    }
    crossings.push((a + b) / 2);
  }
  return crossings;
}

interface Pending {
  readonly move: Move;
  readonly source: MoveSource;
  readonly intensity: number;
}

export interface PlannerOptions {
  readonly seed?: number;
}

export class TurnPlanner {
  #rand: () => number;
  #pending: Pending | null = null;
  #lastCompact = -Infinity;
  #drag: { lastAt: number; lastAngle: number; velocity: number; level: number; quarter: number; active: boolean } | null = null;
  /** Intensity carried from a flick into the turn its release starts. */
  #releaseIntensity = 0;

  constructor(options: PlannerOptions = {}) {
    this.#rand = prng(options.seed ?? 1);
  }

  /** Forget any half-observed motion (sound just enabled, or state replaced). */
  reset(): void {
    this.#pending = null;
    this.#drag = null;
    this.#releaseIntensity = 0;
  }

  plan(event: EngineEvent): Voice[] {
    switch (event.type) {
      case 'turn':
        return this.#turn(event);
      case 'commit':
        return this.#commit(event.move, event.source, event.at);
      case 'drag':
        return this.#dragEvent(event);
      case 'replace': {
        this.reset();
        return [{ kind: 'stop-all', at: Number.NEGATIVE_INFINITY }];
      }
      default:
        return [];
    }
  }

  #pick(n: number): number {
    return Math.min(n - 1, Math.floor(this.#rand() * n));
  }

  #turn(e: TurnStartEvent): Voice[] {
    if (isRotation(e.move.family)) {
      this.#pending = null;
      return [];
    }
    const span = Math.abs(e.to - e.from);
    const seconds = Math.max(1e-3, e.durationMs / 1000);
    let intensity = intensityOf(span / seconds);
    if (e.fromDrag) intensity = Math.max(intensity, this.#releaseIntensity);
    this.#releaseIntensity = 0;
    this.#pending = { move: e.move, source: e.source, intensity };
    const g = SOURCE_GAIN[e.source];
    const slice = isSlice(e.move.family);
    const voices: Voice[] = [
      {
        kind: 'slide',
        at: e.at,
        durationMs: e.durationMs + 25,
        envelope: slideEnvelope(e.easing, e.fromDrag),
        gain: g * (0.27 + 0.3 * intensity) * (slice ? 0.95 : 1),
        brightness: Math.min(1, (0.25 + 0.75 * intensity) * (slice ? 0.85 : 1)),
        texture: this.#pick(BANK_SIZES.friction),
        offset: this.#rand() * 0.8,
      },
    ];
    // Passing a magnet half-way through a double turn.
    for (const t of detentCrossings(e.easing, e.from, e.to)) {
      voices.push({ kind: 'snap', at: e.at + t * e.durationMs, gain: g * (0.1 + 0.08 * intensity), variant: this.#pick(BANK_SIZES.snaps), rate: 1.08, brightness: intensity });
    }
    // Loose pieces knock on fast turns.
    if (intensity > 0.35) {
      // Up to two quiet knocks: a fast sequence should rattle, not chatter.
      const count = Math.min(2, Math.round(intensity * intensity * 2.2 * Math.min(2, span / (Math.PI / 2))));
      for (let i = 0; i < count; i++) {
        voices.push({
          kind: 'rattle',
          at: e.at + (0.15 + 0.65 * this.#rand()) * e.durationMs,
          gain: g * (0.05 + 0.07 * this.#rand()) * intensity,
          variant: this.#pick(BANK_SIZES.rattles),
          rate: 0.92 + 0.16 * this.#rand(),
        });
      }
    }
    return voices;
  }

  #commit(move: Move, source: MoveSource, at: number): Voice[] {
    const pending = this.#pending;
    this.#pending = null;
    if (isRotation(move.family)) return [];
    const g = SOURCE_GAIN[source];
    if (pending) {
      const s = pending.intensity;
      return [
        {
          kind: 'snap',
          at,
          gain: g * (0.21 + 0.22 * s),
          variant: this.#pick(BANK_SIZES.snaps),
          rate: 0.96 + 0.06 * this.#rand() + 0.03 * s,
          brightness: s,
        },
      ];
    }
    // Instant turn: one compact sound, at most one per 50 ms (a skipped scramble is one sound).
    if (at - this.#lastCompact < 50) return [];
    this.#lastCompact = at;
    return [
      {
        kind: 'slide',
        at,
        durationMs: 60,
        envelope: slideEnvelope('snap', false),
        gain: g * 0.24,
        brightness: 0.6,
        texture: this.#pick(BANK_SIZES.friction),
        offset: this.#rand() * 0.8,
      },
      { kind: 'snap', at: at + 45, gain: g * 0.36, variant: this.#pick(BANK_SIZES.snaps), rate: 1, brightness: 0.5 },
    ];
  }

  #dragEvent(e: DragMotionEvent): Voice[] {
    switch (e.phase) {
      case 'begin':
        this.#drag = { lastAt: e.at, lastAngle: 0, velocity: 0, level: 0, quarter: 0, active: false };
        this.#releaseIntensity = 0;
        return [];
      case 'move': {
        const d = this.#drag;
        if (!d) return [];
        const voices: Voice[] = [];
        if (!d.active) {
          d.active = true;
          d.lastAngle = e.angle;
          d.lastAt = e.at;
          voices.push({ kind: 'drag-start', at: e.at, texture: this.#pick(BANK_SIZES.friction), offset: this.#rand() * 0.8 });
        }
        const dt = Math.max(1, e.at - d.lastAt);
        const raw = ((e.angle - d.lastAngle) / dt) * 1000;
        // Smooth the noisy pointer-derived velocity (~40 ms time constant) and clamp it.
        const k = 1 - Math.exp(-dt / 40);
        d.velocity += (Math.max(-40, Math.min(40, raw)) - d.velocity) * k;
        d.level = intensityOf(d.velocity);
        d.lastAngle = e.angle;
        d.lastAt = e.at;
        voices.push({ kind: 'drag-level', at: e.at, gain: 0.3 * d.level ** 0.7, brightness: 0.3 + 0.6 * d.level });
        // Dragging the layer past a magnet (each quarter) ticks faintly.
        const quarter = Math.trunc(e.angle / (Math.PI / 2));
        if (quarter !== d.quarter) {
          d.quarter = quarter;
          voices.push({ kind: 'snap', at: e.at, gain: 0.12, variant: this.#pick(BANK_SIZES.snaps), rate: 1.06, brightness: d.level });
        }
        return voices;
      }
      case 'release': {
        const d = this.#drag;
        this.#drag = null;
        this.#releaseIntensity = d ? d.level : 0;
        return d?.active ? [{ kind: 'drag-stop', at: e.at }] : [];
      }
      case 'cancel': {
        const d = this.#drag;
        this.#drag = null;
        this.#releaseIntensity = 0;
        const voices: Voice[] = d?.active ? [{ kind: 'drag-stop', at: e.at }] : [];
        const settle = e.settleMs ?? 0;
        const displacement = Math.min(1, Math.abs(e.angle) / (Math.PI / 4));
        if (settle > 0 && Math.abs(e.angle) > 0.08) {
          // Springing back: a soft slide and only a faint settle — not a magnetic snap.
          voices.push({
            kind: 'slide',
            at: e.at,
            durationMs: settle,
            envelope: slideEnvelope('smooth', true),
            gain: 0.14 * displacement,
            brightness: 0.3,
            texture: this.#pick(BANK_SIZES.friction),
            offset: this.#rand() * 0.8,
          });
          voices.push({ kind: 'snap', at: e.at + settle, gain: 0.07 * displacement, variant: this.#pick(BANK_SIZES.snaps), rate: 1.1, brightness: 0.2 });
        }
        return voices;
      }
    }
  }
}
