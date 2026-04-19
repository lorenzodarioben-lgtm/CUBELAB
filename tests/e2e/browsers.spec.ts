import { expect, test } from '@playwright/test';
import { SOLVED, debug } from './helpers';

/**
 * Cross-browser smoke: runs on Chromium, Firefox and WebKit. Uses the 3D stage
 * when the browser provides WebGL, otherwise asserts the 2D fallback.
 */
test('loads, turns a slice, scrambles and auto-solves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('cubelab.gestureHintSeen', '1');
    localStorage.setItem('cubelab.settings', JSON.stringify({ v: 1, data: { scrambleStyle: 'instant', playbackSpeed: 'fast' } }));
  });
  await page.goto('/');
  await page.waitForFunction(
    () => document.querySelector('.stage--ready, .stage--unsupported, .stage--error') !== null && typeof window.__CUBELAB__?.facelets === 'function',
    null,
    { timeout: 60_000 },
  );
  const has3d = await page.evaluate(() => document.querySelector('.stage--ready') !== null);
  test.info().annotations.push({ type: 'renderer', description: has3d ? 'WebGL 3D stage' : '2D fallback' });

  await page.keyboard.press('m');
  await page.waitForFunction(() => window.__CUBELAB__.idle() && window.__CUBELAB__.version() === 1);
  expect(await debug.facelets(page)).toBe('UBUUBUUBU' + 'RRRRRRRRR' + 'FUFFUFFUF' + 'DFDDFDDFD' + 'LLLLLLLLL' + 'BDBBDBBDB');
  if (has3d) expect(await debug.visual(page)).toBe(await debug.facelets(page));

  await page.getByRole('button', { name: /New Scramble/ }).click();
  await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 60_000 });
  await page.getByRole('button', { name: /Auto Solve/ }).click();
  await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 90_000 });
  expect(await debug.facelets(page)).toBe(SOLVED);
  expect(errors).toEqual([]);
});
