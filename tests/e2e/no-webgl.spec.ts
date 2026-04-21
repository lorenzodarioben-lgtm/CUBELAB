import { expect, test } from '@playwright/test';
import { FACE_COLORS } from '../../src/core/puzzle/colors';
import { SOLVED, debug, trackErrors } from './helpers';

/** `#rrggbb` → the `rgb(r, g, b)` form computed styles report. */
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

// Launch Chromium with every 3D API disabled.
test.use({ launchOptions: { args: ['--disable-3d-apis', '--disable-webgl'] } });

test.describe('without WebGL', () => {
  test('falls back to a 2D net and the whole studio still works', async ({ page }) => {
    const errors = trackErrors(page);
    await page.addInitScript(() => localStorage.setItem('cubelab.settings', JSON.stringify({ v: 1, data: { scrambleStyle: 'instant', playbackSpeed: 'fast' } })));
    await page.goto('/');
    await expect(page.locator('.face-net')).toBeVisible();
    await expect(page.getByText(/3D needs WebGL/)).toBeVisible();
    expect(await page.locator('canvas').count()).toBe(0);

    await page.getByRole('button', { name: /^R: turn red face/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.idle() && window.__CUBELAB__.version() === 1);
    expect(await debug.facelets(page)).toBe('UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB');
    // The net mirrors the model sticker for sticker (U face right column turned green).
    await expect(page.locator('.face-net__face').first().locator('.face-net__sticker').nth(2)).toHaveCSS('background-color', rgb(FACE_COLORS.F.hex));

    await page.getByRole('button', { name: /New Scramble/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    await page.getByRole('button', { name: /Auto Solve/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 60_000 });
    expect(await debug.facelets(page)).toBe(SOLVED);
    expect(errors()).toEqual([]);
  });
});
