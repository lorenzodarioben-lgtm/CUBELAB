// Renders the turn-sound demonstration (slow R, normal U, fast R U R' U', R2, M)
// offline in Chromium — the same planner, voices, master gain and limiter as
// live playback — and writes it as a 16-bit mono WAV for listening.
// Usage: npm run build && npm run preview (port 4317) in another shell, then:
//        node scripts/render-audio-demo.mjs [out.wav]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.CUBELAB_URL ?? 'http://localhost:4317/';
const OUT = process.argv[2] ?? 'artifacts/audio/turn-demo.wav';
mkdirSync(dirname(OUT), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE);
await page.waitForFunction(() => typeof window.__CUBELAB__?.renderAudioDemo === 'function', null, { timeout: 60000 });
const { rate, samples, wav } = await page.evaluate(() => window.__CUBELAB__.renderAudioDemo());
writeFileSync(OUT, Buffer.from(wav, 'base64'));
const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
console.log(`${OUT}: ${(samples.length / rate).toFixed(2)} s at ${rate} Hz, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
await browser.close();
