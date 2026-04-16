import { expect, test } from '@playwright/test';
import { SOLVED, absorbEmulatedTap, debug, expectRenderMatchesModel, openStudio, touchDrag, trackErrors, waitIdle } from './helpers';

test.describe('CUBELAB on a phone (390×844, touch)', () => {
  test('no sideways scrolling, controls reachable, touch twist and orbit work', async ({ page }) => {
    const errors = trackErrors(page);
    await openStudio(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Primary actions live in a bottom bar within thumb reach.
    const bar = page.locator('.panel-actions');
    await expect(bar).toBeInViewport();
    const box = (await bar.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
    for (const name of ['New Scramble', 'Auto Solve', 'Reset']) {
      const button = bar.getByRole('button', { name: new RegExp(name) });
      await expect(button).toBeVisible();
      const b = (await button.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
    }

    // Touch twist: push the front-right column up with a finger → R.
    const cdp = await page.context().newCDPSession(page);
    const from = await debug.project(page, [1, 0, 1.5]);
    const to = await debug.project(page, [1, 1.35, 1.5]);
    await touchDrag(cdp, from, to);
    expect(await expectRenderMatchesModel(page)).toBe('UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB');

    // Touch on the background orbits instead (stage edge, away from the cube).
    const camera = await debug.camera(page);
    const stage = (await page.locator('.studio__stage').boundingBox())!;
    await touchDrag(cdp, { x: stage.x + 20, y: stage.y + stage.height - 70 }, { x: stage.x + 120, y: stage.y + stage.height - 70 });
    await page.waitForTimeout(300);
    expect((await debug.camera(page)).azimuth).not.toBeCloseTo(camera.azimuth, 2);

    // Orbit mode: the same finger drag on the cube orbits and does not turn.
    await absorbEmulatedTap(page);
    await page.getByRole('radio', { name: 'Orbit' }).check();
    const version = await debug.version(page);
    await touchDrag(cdp, await debug.project(page, [1, 0, 1.5]), await debug.project(page, [1, 1.35, 1.5]));
    await waitIdle(page);
    expect(await debug.version(page)).toBe(version);
    await page.getByRole('radio', { name: 'Twist' }).check();

    // Move Pad is reachable by scrolling and works with taps.
    await absorbEmulatedTap(page);
    const rPrime = page.getByRole('button', { name: /^R': turn red face/ });
    await rPrime.scrollIntoViewIfNeeded();
    await rPrime.tap();
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);

    // Help and settings open as accessible sheets.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Help & shortcuts (?)' }).tap();
    await expect(page.getByRole('dialog', { name: 'How CUBELAB works' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).tap();
    await page.getByRole('button', { name: 'Settings' }).tap();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).tap();
    expect(errors()).toEqual([]);
  });

  test('scramble and auto-solve from the bottom bar', async ({ page }) => {
    await openStudio(page, { settings: { scrambleStyle: 'instant', playbackSpeed: 'fast' } });
    const bar = page.locator('.panel-actions');
    await bar.getByRole('button', { name: /New Scramble/ }).tap();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    await bar.getByRole('button', { name: /Auto Solve/ }).tap();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 60_000 });
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
