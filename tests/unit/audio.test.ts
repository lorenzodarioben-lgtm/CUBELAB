/**
 * Turn audio: the recorded sample bank, the event → sound rules
 * (planner), and the real Web Audio player driven against a minimal fake
 * AudioContext (mute, voice caps, volume, failure handling). Subjective sound
 * quality is not something a unit test can judge; these pin the physical and
 * timing rules the sound is built on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineEvent, TurnStartEvent } from '../../src/core/engine/cubeEngine';
import { mv } from '../../src/core/puzzle/notation';
import type { Move } from '../../src/core/puzzle/notation';
import { BANK_SIZES, prng, renderSoundBank } from '../../src/core/audio/synth';
import { TurnPlanner, detentCrossings, intensityOf, slideEnvelope } from '../../src/core/audio/turnPlanner';
import type { Voice } from '../../src/core/audio/turnPlanner';
import { HARD_VOICE_CAP, createSoundPlayer, demoEvents } from '../../src/core/audio/sound';

const RATE = 48000;

const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('recorded cube samples', () => {
  it('load at the requested sample rate, contain distinct takes and stay below clipping', () => {
    const bank = renderSoundBank(RATE);
    expect(bank.rate).toBe(RATE);
    expect(bank.friction).toHaveLength(BANK_SIZES.friction);
    expect(bank.snaps).toHaveLength(BANK_SIZES.snaps);
    expect(bank.rattles).toHaveLength(BANK_SIZES.rattles);
    for (const x of [...bank.friction, ...bank.snaps, ...bank.rattles]) {
      expect(x.every(Number.isFinite)).toBe(true);
      expect(peak(x)).toBeLessThanOrEqual(1);
      expect(peak(x)).toBeGreaterThan(0.05);
    }
    expect(bank.snaps[0]).not.toEqual(bank.snaps[1]);
    expect(renderSoundBank(RATE).snaps[0]).toEqual(bank.snaps[0]);
  });

  it('has audible sliding texture without a hard loop seam', () => {
    for (const x of renderSoundBank(RATE).friction) {
      expect(x.length / RATE).toBeGreaterThan(0.4);
      expect(rms(x)).toBeGreaterThan(0.08);
      // The quiet slide remains present between contacts instead of a few
      // dry peaks carrying most of the sound.
      expect(peak(x) / rms(x)).toBeLessThan(7);
      let typical = 0;
      for (let i = 1; i < x.length; i++) typical += Math.abs(x[i]! - x[i - 1]!);
      typical /= x.length - 1;
      expect(Math.abs(x[0]! - x[x.length - 1]!)).toBeLessThan(typical * 6);
    }
  });

  it('keeps contact clicks short and varied', () => {
    const bank = renderSoundBank(RATE);
    for (const s of bank.snaps) {
      expect(s.length / RATE).toBeGreaterThan(0.1);
      expect(s.length / RATE).toBeLessThan(0.14);
      expect(peak(s)).toBeGreaterThan(0.5);
      expect(rms(s.slice(0, Math.floor(RATE * 0.08)))).toBeGreaterThan(rms(s.slice(Math.floor(RATE * 0.105))));
    }
    for (const r of bank.rattles) expect(r.length / RATE).toBeLessThan(0.025);
  });
});

/** A manual quarter turn of `move` lasting `ms`, starting at `at`. */
function turn(move: Move, at: number, ms: number, extra: Partial<TurnStartEvent> = {}): TurnStartEvent {
  const span = move.turns === 2 ? Math.PI : Math.PI / 2;
  return { type: 'turn', move, source: 'manual', at, durationMs: ms, from: 0, to: -span, easing: 'snap', fromDrag: false, ...extra };
}
function commit(move: Move, at: number, source: TurnStartEvent['source'] = 'manual'): EngineEvent {
  return { type: 'commit', move, source, tag: undefined, at, before: null!, after: null!, version: 0, solved: false };
}
const ofKind = <K extends Voice['kind']>(voices: Voice[], kind: K) => voices.filter((v): v is Extract<Voice, { kind: K }> => v.kind === kind);

describe('turn planner', () => {
  it('a turn slides from its first frame and snaps exactly when it lands', () => {
    const p = new TurnPlanner({ seed: 3 });
    const start = p.plan(turn(mv('R', 1), 1000, 175));
    const [slide] = ofKind(start, 'slide');
    expect(slide!.at).toBe(1000);
    expect(slide!.durationMs).toBeGreaterThanOrEqual(175);
    expect(slide!.envelope[0]).toBe(0);
    expect(slide!.envelope[slide!.envelope.length - 1]).toBe(0);
    expect(ofKind(start, 'snap')).toHaveLength(0); // no snap before the layer lands
    const land = p.plan(commit(mv('R', 1), 1175));
    expect(land).toHaveLength(1);
    expect(land[0]).toMatchObject({ kind: 'snap', at: 1175 });
  });

  it('faster turns are louder and brighter; slow turns stay soft', () => {
    const play = (ms: number) => {
      const p = new TurnPlanner({ seed: 1 });
      const slide = ofKind(p.plan(turn(mv('U', 1), 0, ms)), 'slide')[0]!;
      const snap = ofKind(p.plan(commit(mv('U', 1), ms)), 'snap')[0]!;
      return { slide, snap };
    };
    const slow = play(600);
    const normal = play(175);
    const fast = play(80);
    expect(slow.slide.gain).toBeLessThan(normal.slide.gain);
    expect(normal.slide.gain).toBeLessThan(fast.slide.gain);
    expect(slow.slide.brightness).toBeLessThan(fast.slide.brightness);
    expect(slow.snap.gain).toBeLessThan(fast.snap.gain);
    expect(intensityOf(2)).toBe(0);
    expect(intensityOf(40)).toBe(1);
  });

  it('the slide follows the layer: strongest early for a snapping user turn, mid-turn for smooth playback', () => {
    const snap = slideEnvelope('snap', false);
    const smooth = slideEnvelope('smooth', false);
    const argmax = (e: number[]) => e.indexOf(Math.max(...e));
    expect(argmax(snap)).toBeLessThan(snap.length / 3);
    expect(Math.abs(argmax(smooth) - smooth.length / 2)).toBeLessThan(3);
    // A released drag is already moving: no fade-in.
    expect(slideEnvelope('snap', true)[0]).toBeGreaterThan(0.5);
  });

  it('only fast turns rattle, and only a few knocks', () => {
    const slow = new TurnPlanner({ seed: 2 }).plan(turn(mv('F', 1), 0, 400));
    expect(ofKind(slow, 'rattle')).toHaveLength(0);
    const fast = new TurnPlanner({ seed: 2 }).plan(turn(mv('F', 1), 0, 70));
    expect(ofKind(fast, 'rattle').length).toBeGreaterThan(0);
    expect(ofKind(fast, 'rattle').length).toBeLessThanOrEqual(2);
    for (const r of ofKind(fast, 'rattle')) {
      expect(r.at).toBeGreaterThan(0);
      expect(r.at).toBeLessThan(70);
      expect(r.gain).toBeLessThan(0.15);
    }
  });

  it('a double turn passes one magnet half-way (a faint detent tick); a quarter passes none', () => {
    const double = new TurnPlanner({ seed: 4 }).plan(turn(mv('R', 2), 0, 254));
    const ticks = ofKind(double, 'snap');
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.at).toBeGreaterThan(0);
    expect(ticks[0]!.at).toBeLessThan(254);
    expect(ticks[0]!.gain).toBeLessThan(0.2);
    expect(detentCrossings('snap', 0, -Math.PI / 2)).toHaveLength(0);
    expect(detentCrossings('smooth', 0, Math.PI)).toEqual([expect.closeTo(0.5, 2)]);
  });

  it('slices sound like turns, a shade darker; whole-cube rotations are silent', () => {
    const face = ofKind(new TurnPlanner({ seed: 5 }).plan(turn(mv('R', 1), 0, 175)), 'slide')[0]!;
    const slice = ofKind(new TurnPlanner({ seed: 5 }).plan(turn(mv('M', 1), 0, 175)), 'slide')[0]!;
    expect(slice.brightness).toBeLessThan(face.brightness);
    expect(slice.gain).toBeGreaterThan(face.gain * 0.8);
    const p = new TurnPlanner();
    expect(p.plan(turn(mv('x', 1), 0, 175))).toEqual([]);
    expect(p.plan(commit(mv('x', 1), 175))).toEqual([]);
  });

  it('scramble and solver playback are quieter than your own turns', () => {
    const at = (source: TurnStartEvent['source']) => ofKind(new TurnPlanner({ seed: 1 }).plan(turn(mv('R', 1), 0, 175, { source })), 'slide')[0]!.gain;
    expect(at('scramble')).toBeLessThan(at('solver'));
    expect(at('solver')).toBeLessThan(at('manual'));
  });

  it('instant turns make one compact sound, and a batch of them makes only one', () => {
    const p = new TurnPlanner({ seed: 6 });
    const first = p.plan(commit(mv('R', 1), 500));
    expect(ofKind(first, 'slide')).toHaveLength(1);
    expect(ofKind(first, 'snap')).toHaveLength(1);
    let more = 0;
    for (let i = 0; i < 25; i++) more += p.plan(commit(mv('U', 1), 500, 'scramble')).length;
    expect(more).toBe(0);
    expect(p.plan(commit(mv('U', 1), 600)).length).toBe(2);
  });

  it('a drag follows the smoothed layer speed; a single noisy jump cannot blast', () => {
    const p = new TurnPlanner({ seed: 7 });
    expect(p.plan({ type: 'drag', phase: 'begin', at: 0, angle: 0 })).toEqual([]);
    const first = p.plan({ type: 'drag', phase: 'move', at: 16, angle: 0.02 });
    expect(ofKind(first, 'drag-start')).toHaveLength(1);
    // Slow, steady drag.
    let level = 0;
    for (let i = 2; i < 10; i++) level = ofKind(p.plan({ type: 'drag', phase: 'move', at: i * 16, angle: 0.02 * i }), 'drag-level')[0]!.gain;
    expect(level).toBeLessThan(0.1);
    // One wild pointer sample: clamped and smoothed, so well below full level.
    const spike = ofKind(p.plan({ type: 'drag', phase: 'move', at: 161, angle: 1.4 }), 'drag-level')[0]!.gain;
    expect(spike).toBeLessThan(0.3);
    expect(spike).toBeGreaterThan(level);
  });

  it('a cancelled drag springs back with a soft slide and a faint settle — never a full snap', () => {
    const p = new TurnPlanner({ seed: 8 });
    p.plan({ type: 'drag', phase: 'begin', at: 0, angle: 0 });
    for (let i = 1; i <= 6; i++) p.plan({ type: 'drag', phase: 'move', at: i * 16, angle: 0.07 * i });
    const back = p.plan({ type: 'drag', phase: 'cancel', at: 120, angle: 0.42, settleMs: 160 });
    expect(ofKind(back, 'drag-stop')).toHaveLength(1);
    expect(ofKind(back, 'slide')).toHaveLength(1);
    const settle = ofKind(back, 'snap');
    expect(settle).toHaveLength(1);
    expect(settle[0]!.gain).toBeLessThan(0.1);
    // A nudge that barely moved makes no sound at all beyond stopping the drag voice.
    const q = new TurnPlanner();
    q.plan({ type: 'drag', phase: 'begin', at: 0, angle: 0 });
    q.plan({ type: 'drag', phase: 'move', at: 16, angle: 0.03 });
    expect(q.plan({ type: 'drag', phase: 'cancel', at: 40, angle: 0.03, settleMs: 160 }).map((v) => v.kind)).toEqual(['drag-stop']);
  });

  it('a flick hands its speed to the turn its release starts, which snaps on landing', () => {
    const p = new TurnPlanner({ seed: 9 });
    p.plan({ type: 'drag', phase: 'begin', at: 0, angle: 0 });
    for (let i = 1; i <= 8; i++) p.plan({ type: 'drag', phase: 'move', at: i * 8, angle: 0.12 * i });
    expect(p.plan({ type: 'drag', phase: 'release', at: 70, angle: 0.96 }).map((v) => v.kind)).toEqual(['drag-stop']);
    // The continuation is slow on its own (0.6 rad in 200 ms), but inherits the flick.
    const voices = p.plan(turn(mv('R', 1), 70, 200, { from: 0.96, to: Math.PI / 2, fromDrag: true }));
    const flicked = ofKind(voices, 'slide')[0]!;
    const calm = ofKind(new TurnPlanner({ seed: 9 }).plan(turn(mv('R', 1), 70, 200, { from: 0.96, to: Math.PI / 2, fromDrag: true })), 'slide')[0]!;
    expect(flicked.gain).toBeGreaterThan(calm.gain);
    expect(flicked.envelope[0]).toBeGreaterThan(0.5);
    expect(ofKind(p.plan(commit(mv('R', 1), 270)), 'snap')).toHaveLength(1);
  });

  it('a state replacement silences everything and forgets the turn in flight', () => {
    const p = new TurnPlanner();
    p.plan(turn(mv('R', 1), 0, 175));
    expect(p.plan({ type: 'replace', state: null!, version: 1, reason: 'reset' })).toEqual([{ kind: 'stop-all', at: Number.NEGATIVE_INFINITY }]);
    // The abandoned turn never commits; a later instant commit is treated as instant.
    expect(ofKind(p.plan(commit(mv('U', 1), 1000)), 'slide')).toHaveLength(1);
  });

  it('rapid turning stays bounded: never more than a handful of voices per turn', () => {
    const p = new TurnPlanner({ seed: 10 });
    let t = 0;
    for (let i = 0; i < 300; i++) {
      const m = mv((['R', 'U', 'F', 'M', 'E', 'L'] as const)[i % 6], ((i % 3) + 1) as 1 | 2 | 3);
      const voices = [...p.plan(turn(m, t, 60)), ...p.plan(commit(m, t + 60))];
      expect(voices.length).toBeLessThanOrEqual(1 + 2 + 1 + 1);
      expect(voices.every((v) => !('gain' in v) || (v.gain >= 0 && v.gain <= 1))).toBe(true);
      t += 62;
    }
  });

  it('the demonstration covers slow, normal, fast, double and slice turns, in order', () => {
    const events = demoEvents(0);
    const turns = events.filter((e): e is TurnStartEvent => e.type === 'turn');
    expect(turns.map((e) => e.durationMs)).toEqual([420, 175, 95, 95, 95, 95, 255, 175]);
    expect(turns.map((e) => e.move.family + e.move.turns).join(' ')).toBe('R1 U1 R1 U1 R3 U3 R2 M1');
    for (let i = 1; i < events.length; i++) expect(events[i]!.type === 'drag' || (events[i] as { at: number }).at >= (events[i - 1] as { at: number }).at).toBe(true);
  });
});

/** A minimal Web Audio stand-in: records sources and lets tests end them. */
class FakeParam {
  value = 0;
  setValueCurveAtTime() {}
  setTargetAtTime(v: number) {
    this.value = v;
  }
  setValueAtTime(v: number) {
    this.value = v;
  }
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
}
class FakeNode {
  connect(next: FakeNode) {
    return next;
  }
  disconnect() {}
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeParam();
  frequency = new FakeParam();
  type = '';
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
class FakeContext {
  static instances: FakeContext[] = [];
  sources: FakeSource[] = [];
  gains: Array<{ gain: FakeParam }> = [];
  currentTime = 0;
  sampleRate = 8000;
  state: 'running' | 'suspended' = 'running';
  destination = new FakeNode();
  constructor() {
    FakeContext.instances.push(this);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createBuffer(_c: number, length: number) {
    return { length, copyToChannel() {} };
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createOscillator() {
    return this.createBufferSource();
  }
  createGain() {
    const g = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(g);
    return g;
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
}

describe('Web Audio player', () => {
  beforeEach(() => {
    FakeContext.instances = [];
    (globalThis as Record<string, unknown>).AudioContext = FakeContext;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).AudioContext;
  });

  const quarter = (at: number): EngineEvent[] => [turn(mv('R', 1), at, 175), commit(mv('R', 1), at + 175)];

  it('stays completely silent (no AudioContext at all) until sound is enabled', () => {
    const player = createSoundPlayer();
    for (const e of quarter(0)) player.motion(e);
    player.preview();
    player.solved();
    expect(FakeContext.instances).toHaveLength(0);
    expect(player.stats().started).toEqual({ slide: 0, snap: 0, rattle: 0, drag: 0 });
  });

  it('plays a slide and a snap per turn when enabled, and nothing once muted again', () => {
    const player = createSoundPlayer();
    player.setEnabled(true);
    expect(FakeContext.instances).toHaveLength(1);
    for (const e of quarter(performance.now())) player.motion(e);
    expect(player.stats().started.slide).toBe(1);
    expect(player.stats().started.snap).toBe(1);
    player.setEnabled(false);
    for (const e of quarter(performance.now())) player.motion(e);
    expect(player.stats().started.slide).toBe(1);
    expect(FakeContext.instances).toHaveLength(1);
  });

  it('reuses the recorded turn bank for other cube sizes with restrained pitch', () => {
    const player = createSoundPlayer();
    player.setEnabled(true);
    player.practiceTurn?.(mv('R', 1), 175, 1.065);
    expect(player.stats().started.slide).toBe(1);
    expect(player.stats().started.snap).toBe(1);
    const slide = FakeContext.instances[0]!.sources.find((source) => source.loop)!;
    expect(slide.playbackRate.value).toBeCloseTo(1.04 * 1.065);
  });

  it('caps simultaneous voices during a frantic burst, and frees nodes as they end', () => {
    const player = createSoundPlayer();
    player.setEnabled(true);
    const ctx = FakeContext.instances[0]!;
    let t = performance.now();
    for (let i = 0; i < 200; i++) {
      for (const e of [turn(mv('U', 1), t, 50), commit(mv('U', 1), t + 50)]) player.motion(e);
      t += 1;
    }
    const stats = player.stats();
    expect(stats.peakActive).toBeLessThanOrEqual(HARD_VOICE_CAP);
    expect(stats.active).toBeLessThanOrEqual(HARD_VOICE_CAP);
    // End every source: the player releases them all.
    for (const s of ctx.sources) s.onended?.();
    expect(player.stats().active).toBe(0);
  });

  it('volume is clamped to 0…1 and applied perceptually (squared)', () => {
    const player = createSoundPlayer();
    player.setVolume(5);
    player.setEnabled(true);
    const master = FakeContext.instances[0]!.gains[0]!;
    expect(master.gain.value).toBe(1);
    player.setVolume(0.5);
    expect(master.gain.value).toBeCloseTo(0.25);
    player.setVolume(-1);
    expect(master.gain.value).toBe(0);
  });

  it('resumes a suspended context on the next sound and never throws when Web Audio is missing', () => {
    const player = createSoundPlayer();
    player.setEnabled(true);
    const ctx = FakeContext.instances[0]!;
    ctx.state = 'suspended';
    player.motion(turn(mv('R', 1), performance.now(), 100));
    expect(ctx.state).toBe('running');
    delete (globalThis as Record<string, unknown>).AudioContext;
    const orphan = createSoundPlayer();
    expect(() => {
      orphan.setEnabled(true);
      for (const e of quarter(0)) orphan.motion(e);
      orphan.preview();
    }).not.toThrow();
    expect(orphan.stats().context).toBe('none');
  });

  it('the preview plays the demonstration without any cube events', () => {
    const player = createSoundPlayer();
    player.setEnabled(true);
    player.preview();
    const s = player.stats().started;
    expect(s.slide).toBe(8);
    expect(s.snap).toBeGreaterThanOrEqual(8);
  });

  it('a deterministic seed reproduces the same plan (no per-render randomness)', () => {
    const a = new TurnPlanner({ seed: 77 });
    const b = new TurnPlanner({ seed: 77 });
    for (const e of demoEvents(0)) expect(a.plan(e)).toEqual(b.plan(e));
    expect(prng(1)()).toBe(prng(1)());
  });
});
