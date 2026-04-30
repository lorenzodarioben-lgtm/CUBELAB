/** Build the compact PCM bank from SpaceJoe's CC0 Rubik Cube Turn recordings.
 * Source and licence: src/assets/audio/README.md. Run: node scripts/build-cube-samples.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const ROOT = 'src/assets/audio';
const IDS = [486580, 486581, 486582, 486583, 486584, 486585];
const RATE = 44100;
const browser = await chromium.launch(process.env.CUBELAB_USE_CHROME === '1' ? { channel: 'chrome' } : {});
const page = await browser.newPage();
await page.goto('about:blank');
const sources = [];
for (const id of IDS) {
  const bytes = readFileSync(`${ROOT}/source/${id}.mp3`);
  const decoded = await page.evaluate(async (input) => {
    const ctx = new AudioContext();
    const audio = await ctx.decodeAudioData(new Uint8Array(input).buffer);
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const channel = audio.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / audio.numberOfChannels;
    }
    await ctx.close();
    return { rate: audio.sampleRate, samples: [...mono] };
  }, [...bytes]);
  if (decoded.rate !== RATE) throw new Error(`Unexpected sample rate: ${decoded.rate}`);
  sources.push(Float32Array.from(decoded.samples));
}
await browser.close();

const crop = (source, start, end) => sources[source].slice(Math.round(start * RATE), Math.round(end * RATE));
const rms = (x) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
const peak = (x) => x.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
const fade = (x, inMs, outMs) => {
  const attack = Math.round(inMs * RATE / 1000);
  const release = Math.round(outMs * RATE / 1000);
  for (let i = 0; i < Math.min(attack, x.length); i++) x[i] *= i / attack;
  for (let i = 0; i < Math.min(release, x.length); i++) x[x.length - 1 - i] *= i / release;
  return x;
};
const highpass = (x) => {
  const a = Math.exp(-2 * Math.PI * 130 / RATE);
  let prevX = 0, prevY = 0;
  for (let i = 0; i < x.length; i++) {
    const y = a * (prevY + x[i] - prevX);
    prevX = x[i]; prevY = y; x[i] = y;
  }
  return x;
};
const normalise = (x, targetRms, maxPeak = 0.9) => {
  highpass(x);
  const gain = Math.min(targetRms / Math.max(1e-8, rms(x)), maxPeak / Math.max(1e-8, peak(x)));
  return x.map((v) => v * gain);
};
// A lubricated layer still has real plastic texture, but its small contacts
// should sit inside the glide instead of dominating it as sharp peaks.
const smoothSlide = (x) => {
  highpass(x);
  const initial = 0.9 / Math.max(1e-8, peak(x));
  let envelope = 0;
  const release = Math.exp(-1 / (RATE * .018));
  const treble = Math.exp(-2 * Math.PI * 3800 / RATE);
  let warm = 0;
  for (let i = 0; i < x.length; i++) {
    const sample = x[i] * initial;
    envelope = Math.max(Math.abs(sample), envelope * release);
    const compression = envelope > .11 ? (.11 / envelope) ** .55 : 1;
    warm = (1 - treble) * sample + treble * warm;
    x[i] = compression * (.75 * sample + .25 * warm);
  }
  const gain = Math.min(.14 / Math.max(1e-8, rms(x)), .72 / Math.max(1e-8, peak(x)));
  return x.map((v) => v * gain);
};
const join = (chunks, overlapMs = 8) => {
  const overlap = Math.round(overlapMs * RATE / 1000);
  let out = chunks[0].slice();
  for (const next of chunks.slice(1)) {
    const joined = new Float32Array(out.length + next.length - overlap);
    joined.set(out);
    for (let i = 0; i < overlap; i++) {
      const u = i / overlap;
      joined[out.length - overlap + i] = out[out.length - overlap + i] * Math.cos(u * Math.PI / 2) + next[i] * Math.sin(u * Math.PI / 2);
    }
    joined.set(next.subarray(overlap), out.length);
    out = joined;
  }
  return out;
};

// These are the sliding portions before the large alignment impacts. Joining
// different real contacts avoids a synthetic, periodic noise bed.
const slides = [
  crop(0, .420, .495), crop(1, .402, .460), crop(2, .380, .445),
  crop(3, .400, .495), crop(4, .510, .550), crop(5, .340, .425),
].map((x) => fade(x, 2, 2));
const friction = [
  [0, 2, 4, 1, 3, 5, 0, 4, 2],
  [3, 1, 5, 0, 4, 2, 3, 5, 1],
  [5, 4, 1, 3, 2, 0, 5, 1, 4],
].map((order) => smoothSlide(fade(join(order.map((i) => slides[i])), 12, 12)));

// Natural plastic contacts, including a little settling noise after each hit.
const snaps = [
  crop(0, .490, .605), crop(1, .515, .630), crop(2, .460, .575),
  crop(3, .520, .650), crop(4, .645, .765), crop(5, .450, .565),
  crop(1, .455, .570), crop(4, .545, .660),
].map((x) => normalise(fade(x, 1, 22), .10));

const rattles = [
  crop(0, .462, .485), crop(1, .461, .484), crop(2, .395, .418),
  crop(3, .438, .461), crop(4, .512, .535), crop(5, .344, .367),
].map((x) => normalise(fade(x, 1, 7), .10));

const all = [...friction, ...rattles, ...snaps];
const segments = [];
let total = 0;
for (const x of all) { segments.push([total, x.length]); total += x.length; }
const wav = Buffer.alloc(44 + total * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(total * 2, 40);
let pos = 44;
for (const x of all) for (const v of x) { wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), pos); pos += 2; }
writeFileSync(`${ROOT}/cube-turn-bank.wav`, wav);
writeFileSync(`${ROOT}/segments.json`, JSON.stringify({ rate: RATE, friction: segments.slice(0, 3), rattles: segments.slice(3, 9), snaps: segments.slice(9) }, null, 2) + '\n');
console.log(`Wrote ${all.length} real-sound samples, ${(wav.length / 1024).toFixed(0)} KiB`);
