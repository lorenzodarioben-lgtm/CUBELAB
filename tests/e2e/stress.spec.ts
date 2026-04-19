import { expect, test } from '@playwright/test';
import { SOLVED, expectRenderMatchesModel, openStudio, trackErrors } from './helpers';

const KEYS = ['u', 'd', 'l', 'r', 'f', 'b', 'm', 'e', 's'];

test.describe('hardening (desktop, production build)', () => {
  test('300 mixed face/slice turns keep render and model identical and leak nothing', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackErrors(page);
    await openStudio(page, { settings: { turnSpeed: 'instant' } });
    const before = await page.evaluate(() => window.__CUBELAB__.renderInfo!());

    // Deterministic pseudo-random sequence, then its exact inverse.
    let seed = 20261012;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const presses: string[] = [];
    for (let i = 0; i < 150; i++) {
      const key = KEYS[Math.floor(rand() * KEYS.length)]!;
      presses.push(rand() < 0.5 ? key : `Shift+${key.toUpperCase()}`);
    }
    for (const key of presses) await page.keyboard.press(key);
    expect(await page.evaluate(() => window.__CUBELAB__.moveLog().split(' ').length)).toBe(150);
    await expectRenderMatchesModel(page);
    for (const key of [...presses].reverse()) {
      await page.keyboard.press(key.startsWith('Shift+') ? key.slice(6).toLowerCase() : `Shift+${key.toUpperCase()}`);
    }
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    expect(await page.evaluate(() => window.__CUBELAB__.version())).toBe(300);

    // Switching render quality / finish rebuilds and disposes resources; nothing accumulates.
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('dialog').getByRole('radio', { name: 'Matte' }).check();
      await page.getByRole('dialog').getByRole('radio', { name: 'Low' }).check();
      await page.waitForTimeout(200);
      await page.getByRole('dialog').getByRole('radio', { name: 'Gloss' }).check();
      await page.getByRole('dialog').getByRole('radio', { name: 'Auto' }).check();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    await page.keyboard.press('r');
    await page.keyboard.press('Shift+R');
    const after = await page.evaluate(() => window.__CUBELAB__.renderInfo!());
    expect(after.geometries).toBeLessThanOrEqual(before.geometries + 2);
    expect(after.textures).toBeLessThanOrEqual(before.textures + 2);
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    expect(errors()).toEqual([]);
  });
});
