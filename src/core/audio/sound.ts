/**
 * Tiny Web Audio synth for optional feedback. Nothing plays unless the user
 * enables sound; the AudioContext is created lazily on that first enable (a
 * user gesture), and every call is fire-and-forget so input is never delayed.
 */
export interface SoundPlayer {
  setEnabled(enabled: boolean): void;
  turn(kind: 'manual' | 'auto'): void;
  solved(): void;
  arm(): void;
}

export function createSoundPlayer(): SoundPlayer {
  let enabled = false;
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;

  const context = (): AudioContext | null => {
    if (!enabled) return null;
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  };

  const noiseBuffer = (c: AudioContext): AudioBuffer => {
    if (noise) return noise;
    const buffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.06), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    noise = buffer;
    return buffer;
  };

  return {
    setEnabled(value) {
      enabled = value;
      if (value) context();
    },
    turn(kind) {
      const c = context();
      if (!c) return;
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c);
      src.playbackRate.value = kind === 'manual' ? 0.9 + Math.random() * 0.25 : 1.2;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = kind === 'manual' ? 1900 : 2600;
      filter.Q.value = 1.1;
      const gain = c.createGain();
      gain.gain.setValueAtTime(kind === 'manual' ? 0.32 : 0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      src.connect(filter).connect(gain).connect(c.destination);
      src.start(t);
      src.stop(t + 0.07);
    },
    solved() {
      const c = context();
      if (!c) return;
      const t = c.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = c.createGain();
        const start = t + i * 0.07;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
        osc.connect(gain).connect(c.destination);
        osc.start(start);
        osc.stop(start + 0.95);
      });
    },
    arm() {
      const c = context();
      if (!c) return;
      const t = c.currentTime;
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 880;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    },
  };
}

export const silentPlayer: SoundPlayer = { setEnabled() {}, turn() {}, solved() {}, arm() {} };
