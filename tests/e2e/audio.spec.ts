import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { debug, openStudio, trackErrors, waitIdle } from './helpers';

const audio = (page: Page) => page.evaluate(() => window.__CUBELAB__.audio());
const voices = async (page: Page) => {
  const s = (await audio(page)).started;
  return s.slide + s.snap + s.rattle + s.drag;
};

test.describe('speedcube turn audio', () => {
  test('only real turns make sound: not rotations, the view, style switches or a muted cube', async ({ page }) => {
    const errors = trackErrors(page);
    await openStudio(page);
    expect((await audio(page)).context).toBe('none'); // nothing exists until sound is enabled
    // Enable with a real click (a user gesture, so the browser lets audio start).
    await page.getByRole('button', { name: 'Enable sound' }).click();
    await page.waitForFunction(() => window.__CUBELAB__.audio().context === 'running', null, { timeout: 10_000 });

    // One quarter turn: one slide when it starts, one snap when it lands.
    await page.keyboard.press('r');
    await waitIdle(page);
    let s = (await audio(page)).started;
    expect(s.slide).toBe(1);
    expect(s.snap).toBe(1);

    // A slice and a double turn sound too (the double also ticks once half-way).
    await page.keyboard.press('m');
    await waitIdle(page);
    expect((await audio(page)).started.slide).toBe(2);

    // Whole-cube rotations are a re-grip: silent.
    const before = await voices(page);
    await page.keyboard.press('x');
    await page.keyboard.press('Shift+X');
    await waitIdle(page);
    expect(await voices(page)).toBe(before);

    // Tumbling the view: silent.
    await page.mouse.move(720, 860);
    await page.mouse.down();
    await page.mouse.move(700, 600, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await voices(page)).toBe(before);

    // Changing the cube style: silent.
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.getByRole('radio', { name: /Classic Stickered/ }).check();
    await page.waitForFunction(() => window.__CUBELAB__.renderedStyle?.() === 'stickered');
    expect(await voices(page)).toBe(before);

    // The preview plays the demonstration without touching the cube.
    const version = await debug.version(page);
    await page.getByRole('button', { name: 'Preview' }).click();
    s = (await audio(page)).started;
    expect(s.slide).toBe(2 + 8);
    expect(await debug.version(page)).toBe(version);
    await page.keyboard.press('Escape');

    // Muted: turns are silent.
    await page.getByRole('button', { name: 'Mute sound' }).click();
    const muted = await voices(page);
    await page.keyboard.press('u');
    await waitIdle(page);
    expect(await voices(page)).toBe(muted);
    expect(errors()).toEqual([]);
  });

  test('a rapid burst stays bounded and every voice is released afterwards', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: 'Enable sound' }).click();
    await page.waitForFunction(() => window.__CUBELAB__.audio().context === 'running', null, { timeout: 10_000 });
    for (let i = 0; i < 40; i++) await page.keyboard.press(['r', 'u', 'Shift+R', 'Shift+U'][i % 4]!);
    await waitIdle(page);
    // Keys beyond the engine's queued-turn limit are refused (as always); every
    // turn that did happen sounded exactly once: one slide and one landing snap.
    const turns = (await debug.moveLog(page)).split(' ').length;
    expect(turns).toBeGreaterThan(20);
    const s = await audio(page);
    expect(s.started.slide).toBe(turns);
    expect(s.started.snap).toBe(turns);
    expect(s.peakActive).toBeLessThanOrEqual(40);
    await page.waitForFunction(() => window.__CUBELAB__.audio().active === 0, null, { timeout: 5_000 });
  });

  test('the rendered demonstration never clips, slides audibly, and fast turns are brighter than slow ones', async ({ page }) => {
    await openStudio(page);
    const { rate, samples } = await page.evaluate(() => window.__CUBELAB__.renderAudioDemo());
    const x = Float32Array.from(samples);
    const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(0.98);
    // Windows (ms) from demoEvents(200): the slow R moves 200–620, a fast R 1290–1385.
    const span = (from: number, to: number) => x.slice(Math.floor((from / 1000) * rate), Math.floor((to / 1000) * rate));
    const rms = (w: Float32Array) => Math.sqrt(w.reduce((s, v) => s + v * v, 0) / w.length);
    // Brightness proxy: zero-crossing rate.
    const zcr = (w: Float32Array) => {
      let n = 0;
      for (let i = 1; i < w.length; i++) if (w[i - 1]! < 0 !== w[i]! < 0) n++;
      return n / w.length;
    };
    const slowSlide = span(260, 560);
    const fastSlide = span(1300, 1370);
    const silence = span(20, 180);
    expect(rms(slowSlide)).toBeGreaterThan(rms(silence) * 20 + 1e-4); // the slide is heard, not only the snap
    expect(rms(fastSlide)).toBeGreaterThan(rms(slowSlide));
    expect(zcr(fastSlide)).toBeGreaterThan(zcr(slowSlide));
  });
});
