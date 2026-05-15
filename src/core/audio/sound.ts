/**
 * Speedcube turn audio on the Web Audio API.
 *
 * The engine's motion events (turn start, drag motion, commit) go through the
 * pure `TurnPlanner`, and the resulting voices are scheduled here on the audio
 * clock: friction loops shaped by gain curves and a low-pass, rattle pings
 * and magnetic snaps, all drawn from real cube recordings loaded once by
 * `synth.ts` (no network or per-turn decoding). Everything mixes into one
 * master gain (the volume setting) and a limiter, so rapid sequences can never
 * clip.
 *
 * Nothing plays unless the user enables sound. The AudioContext is created
 * lazily when sound is enabled and resumed on the next user gesture if the
 * browser started it suspended. Voices are capped; every node is released
 * when its source ends.
 */
import type { EngineEvent, TurnStartEvent } from '../engine/cubeEngine';
import { mv } from '../puzzle/notation';
import type { Move } from '../puzzle/notation';
import { moveQuarterTurns } from '../puzzle/geometry';
import { renderSoundBank } from './synth';
import { TurnPlanner } from './turnPlanner';
import type { Voice } from './turnPlanner';

export interface SoundStats {
  readonly enabled: boolean;
  readonly context: AudioContextState | 'none';
  /** Voices started since load, by kind. */
  readonly started: Readonly<Record<'slide' | 'snap' | 'rattle' | 'drag', number>>;
  /** Voices currently sounding, and the most at once. */
  readonly active: number;
  readonly peakActive: number;
  readonly dropped: number;
}

export interface SoundPlayer {
  setEnabled(enabled: boolean): void;
  /** 0…1 (perceptual: applied squared). */
  setVolume(volume: number): void;
  /** Every engine event; the player decides what is audible. */
  motion(event: EngineEvent): void;
  /** Reuse the recorded turn bank for a different cube size. */
  practiceTurn?(move: Move, durationMs: number, pitch?: number): void;
  solved(): void;
  arm(): void;
  /** Plays a short demonstration sequence without touching the cube. */
  preview(): void;
  stats(): SoundStats;
}

/** Above this many sounding voices, optional detail (rattles, detent ticks) is skipped. */
export const SOFT_VOICE_CAP = 24;
/** Hard ceiling: the oldest friction voice is stopped to make room. */
export const HARD_VOICE_CAP = 40;

interface Bank {
  readonly friction: readonly AudioBuffer[];
  readonly rattles: readonly AudioBuffer[];
  readonly snaps: readonly AudioBuffer[];
}

function toBuffers(ctx: BaseAudioContext): Bank {
  const bank = renderSoundBank(ctx.sampleRate);
  const make = (data: Float32Array) => {
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    return buffer;
  };
  return { friction: bank.friction.map(make), rattles: bank.rattles.map(make), snaps: bank.snaps.map(make) };
}

const cutoffFor = (brightness: number) => 2800 * 2.6 ** Math.min(1, Math.max(0, brightness));
// Lift the plastic contact slightly without raising the noisy rattle or filter cutoff.
const TURN_CONTACT_PITCH = 1.04;

/**
 * Schedules planner voices on any audio context — the live one, or an
 * OfflineAudioContext when rendering the demonstration for analysis.
 */
export class VoiceExecutor {
  readonly #ctx: BaseAudioContext;
  readonly #out: AudioNode;
  readonly #bank: Bank;
  readonly #timeOf: (atMs: number) => number;
  /**
   * Sounding voices with their scheduled end on the audio clock. Concurrency is
   * counted from these end times — not from 'ended' events, which reach the main
   * thread late when it is busy (exactly during fast turning).
   */
  readonly #active = new Map<AudioScheduledSourceNode, { kind: Voice['kind']; gain: GainNode; end: number }>();
  #drag: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  readonly started = { slide: 0, snap: 0, rattle: 0, drag: 0 };
  peakActive = 0;
  dropped = 0;

  constructor(ctx: BaseAudioContext, out: AudioNode, bank: Bank, timeOf: (atMs: number) => number) {
    this.#ctx = ctx;
    this.#out = out;
    this.#bank = bank;
    this.#timeOf = timeOf;
  }

  get active(): number {
    this.#prune();
    return this.#active.size;
  }

  #prune(): void {
    const now = this.#ctx.currentTime;
    for (const [src, v] of this.#active) if (v.end <= now) this.#active.delete(src);
  }

  #track(src: AudioScheduledSourceNode, kind: Voice['kind'], gain: GainNode, end: number): void {
    this.#active.set(src, { kind, gain, end });
    this.peakActive = Math.max(this.peakActive, this.#active.size);
    src.onended = () => {
      this.#active.delete(src);
      src.disconnect();
      gain.disconnect();
    };
  }

  #roomFor(kind: Voice['kind'], optional: boolean): boolean {
    this.#prune();
    if (optional && this.#active.size >= SOFT_VOICE_CAP) {
      this.dropped++;
      return false;
    }
    if (this.#active.size >= HARD_VOICE_CAP) {
      const oldest = [...this.#active.entries()].find(([, v]) => v.kind === 'slide');
      if (!oldest) {
        this.dropped++;
        return false;
      }
      try {
        oldest[0].stop();
      } catch {
        /* already stopped */
      }
      this.#active.delete(oldest[0]);
    }
    return kind !== 'stop-all';
  }

  play(voice: Voice, pitch = 1): void {
    const ctx = this.#ctx;
    const t = Math.max(ctx.currentTime, this.#timeOf(voice.at));
    switch (voice.kind) {
      case 'slide': {
        if (!this.#roomFor('slide', false)) return;
        const seconds = voice.durationMs / 1000;
        const src = ctx.createBufferSource();
        src.buffer = this.#bank.friction[voice.texture]!;
        src.loop = true;
        src.playbackRate.value = TURN_CONTACT_PITCH * pitch;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoffFor(voice.brightness);
        filter.Q.value = 0.5;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.gain.setValueCurveAtTime(Float32Array.from(voice.envelope, (v) => v * voice.gain), t, Math.max(0.01, seconds));
        src.connect(filter).connect(gain).connect(this.#out);
        src.start(t, voice.offset);
        src.stop(t + seconds + 0.02);
        this.#track(src, 'slide', gain, t + seconds + 0.02);
        this.started.slide++;
        return;
      }
      case 'snap':
      case 'rattle': {
        const optional = voice.kind === 'rattle' || voice.gain < 0.2;
        if (!this.#roomFor(voice.kind, optional)) return;
        const src = ctx.createBufferSource();
        src.buffer = voice.kind === 'snap' ? this.#bank.snaps[voice.variant]! : this.#bank.rattles[voice.variant]!;
        src.playbackRate.value = voice.rate * (voice.kind === 'snap' ? TURN_CONTACT_PITCH : 1) * pitch;
        const gain = ctx.createGain();
        gain.gain.value = voice.gain;
        if (voice.kind === 'snap') {
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 3000 * (1 + 1.4 * voice.brightness);
          filter.Q.value = 0.4;
          src.connect(filter).connect(gain).connect(this.#out);
        } else {
          src.connect(gain).connect(this.#out);
        }
        src.start(t);
        this.#track(src, voice.kind, gain, t + src.buffer.duration / src.playbackRate.value);
        this.started[voice.kind]++;
        return;
      }
      case 'drag-start': {
        this.#stopDrag(t);
        const src = ctx.createBufferSource();
        src.buffer = this.#bank.friction[voice.texture]!;
        src.loop = true;
        src.playbackRate.value = TURN_CONTACT_PITCH;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoffFor(0.3);
        filter.Q.value = 0.5;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(filter).connect(gain).connect(this.#out);
        src.start(t, voice.offset);
        this.#drag = { src, gain, filter };
        this.#track(src, 'drag-start', gain, Number.POSITIVE_INFINITY);
        this.started.drag++;
        return;
      }
      case 'drag-level': {
        const d = this.#drag;
        if (!d) return;
        d.gain.gain.setTargetAtTime(voice.gain, t, 0.025);
        d.filter.frequency.setTargetAtTime(cutoffFor(voice.brightness), t, 0.04);
        return;
      }
      case 'drag-stop':
        this.#stopDrag(t);
        return;
      case 'stop-all': {
        const now = ctx.currentTime;
        this.#stopDrag(now);
        for (const [src, v] of this.#active) {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setTargetAtTime(0, now, 0.015);
          v.end = Math.min(v.end, now + 0.08);
          try {
            src.stop(now + 0.08);
          } catch {
            /* already stopping */
          }
        }
        return;
      }
    }
  }

  #stopDrag(t: number): void {
    const d = this.#drag;
    if (!d) return;
    this.#drag = null;
    d.gain.gain.cancelScheduledValues(t);
    d.gain.gain.setTargetAtTime(0, t, 0.02);
    const tracked = this.#active.get(d.src);
    if (tracked) tracked.end = t + 0.15;
    try {
      d.src.stop(t + 0.15);
    } catch {
      /* already stopping */
    }
  }
}

/**
 * The demonstration sequence (engine events, times in ms from `start`): a slow
 * R, a normal U, a fast R U R' U', a double turn, an M slice and a cancelled
 * nudge — the same events the cube itself would emit.
 */
export function demoEvents(start: number): EngineEvent[] {
  const events: EngineEvent[] = [];
  let at = start;
  const turn = (move: Move, durationMs: number, gapMs: number) => {
    const span = move.turns === 2 ? Math.PI : Math.PI / 2;
    events.push({ type: 'turn', move, source: 'manual', at, durationMs, from: 0, to: move.turns === 3 ? span : -span, easing: 'snap', fromDrag: false });
    events.push({ type: 'commit', move, source: 'manual', tag: undefined, at: at + durationMs, before: null!, after: null!, version: 0, solved: false });
    at += durationMs + gapMs;
  };
  turn(mv('R', 1), 420, 260);
  turn(mv('U', 1), 175, 260);
  for (const move of [mv('R', 1), mv('U', 1), mv('R', 3), mv('U', 3)]) turn(move, 95, 15);
  at += 250;
  turn(mv('R', 2), 255, 300);
  turn(mv('M', 1), 175, 0);
  return events;
}

function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset: number, s: string) => [...s].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  data.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, 'data');
  data.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Uint8Array(data.buffer);
}

/**
 * Renders the demonstration offline through the same planner, executor,
 * master gain and limiter as live playback. Returns the samples and a 16-bit
 * WAV of them (for listening and signal analysis outside the browser).
 */
export async function renderDemo(volume = 0.7, rate = 48000): Promise<{ rate: number; samples: Float32Array; wav: Uint8Array }> {
  const events = demoEvents(200);
  const last = events[events.length - 1]!;
  const ctx = new OfflineAudioContext(1, Math.ceil(((last.type === 'commit' ? last.at : 0) / 1000 + 0.6) * rate), rate);
  const { input } = masterChain(ctx, volume);
  const executor = new VoiceExecutor(ctx, input, toBuffers(ctx), (at) => at / 1000);
  const planner = new TurnPlanner({ seed: 7 });
  for (const event of events) for (const voice of planner.plan(event)) executor.play(voice);
  const buffer = await ctx.startRendering();
  const samples = buffer.getChannelData(0).slice();
  return { rate, samples, wav: encodeWav(samples, rate) };
}

function masterChain(ctx: BaseAudioContext, volume: number): { input: GainNode; master: GainNode } {
  const master = ctx.createGain();
  master.gain.value = volume * volume;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  master.connect(limiter).connect(ctx.destination);
  return { input: master, master };
}

export function createSoundPlayer(): SoundPlayer {
  let enabled = false;
  let volume = 0.7;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let executor: VoiceExecutor | null = null;
  const planner = new TurnPlanner({ seed: Date.now() });
  let unlockInstalled = false;

  const installUnlock = () => {
    if (unlockInstalled || typeof window === 'undefined') return;
    unlockInstalled = true;
    // Browsers start an AudioContext suspended outside a gesture: resume on the next one.
    const resume = () => {
      if (ctx && ctx.state === 'suspended') void ctx.resume();
    };
    window.addEventListener('pointerdown', resume, { capture: true });
    window.addEventListener('keydown', resume, { capture: true });
  };

  const live = (): { ctx: AudioContext; executor: VoiceExecutor; master: GainNode } | null => {
    if (!enabled) return null;
    try {
      if (!ctx) {
        ctx = new AudioContext({ latencyHint: 'interactive' });
        const chain = masterChain(ctx, volume);
        master = chain.master;
        const c = ctx;
        executor = new VoiceExecutor(c, chain.input, toBuffers(c), (at) => c.currentTime + Math.max(0, (at - performance.now()) / 1000) + 0.006);
        installUnlock();
      }
      if (ctx.state === 'suspended') void ctx.resume();
      return { ctx, executor: executor!, master: master! };
    } catch {
      return null;
    }
  };

  const tone = (freq: number, type: OscillatorType, start: number, peak: number, length: number) => {
    const l = live();
    if (!l) return;
    const t = l.ctx.currentTime + start;
    const osc = l.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = l.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(l.master);
    osc.start(t);
    osc.stop(t + length + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  };

  return {
    setEnabled(value) {
      if (value && !enabled) planner.reset();
      enabled = value;
      if (value) live();
      else executor?.play({ kind: 'stop-all', at: 0 });
    },
    setVolume(value) {
      volume = Math.min(1, Math.max(0, value));
      if (master && ctx) master.gain.setTargetAtTime(volume * volume, ctx.currentTime, 0.02);
    },
    motion(event) {
      const l = live();
      if (!l) return;
      for (const voice of planner.plan(event)) l.executor.play(voice);
    },
    practiceTurn(move, durationMs, pitch = 1) {
      const l = live();
      if (!l) return;
      const at = performance.now();
      const source = 'manual' as const;
      const turn: TurnStartEvent = {
        type: 'turn', move, source, at, durationMs, from: 0,
        to: moveQuarterTurns(move) * Math.PI / 2,
        easing: 'snap', fromDrag: false,
      };
      const voices = durationMs > 0
        ? [...planner.plan(turn), ...planner.complete(move, source, at + durationMs)]
        : planner.complete(move, source, at);
      for (const voice of voices) l.executor.play(voice, pitch);
    },
    solved() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 'sine', i * 0.07, 0.09, 0.9));
    },
    arm() {
      tone(880, 'triangle', 0, 0.05, 0.12);
    },
    preview() {
      const l = live();
      if (!l) return;
      const demo = new TurnPlanner({ seed: Math.floor(Math.random() * 1e9) });
      for (const event of demoEvents(performance.now() + 60)) for (const voice of demo.plan(event)) l.executor.play(voice);
    },
    stats() {
      const e = executor;
      return {
        enabled,
        context: ctx?.state ?? 'none',
        started: e ? { ...e.started } : { slide: 0, snap: 0, rattle: 0, drag: 0 },
        active: e?.active ?? 0,
        peakActive: e?.peakActive ?? 0,
        dropped: e?.dropped ?? 0,
      };
    },
  };
}

export const silentPlayer: SoundPlayer = {
  setEnabled() {},
  setVolume() {},
  motion() {},
  solved() {},
  arm() {},
  preview() {},
  stats: () => ({ enabled: false, context: 'none', started: { slide: 0, snap: 0, rattle: 0, drag: 0 }, active: 0, peakActive: 0, dropped: 0 }),
};
