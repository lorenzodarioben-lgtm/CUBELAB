import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { debug, expectRenderMatchesModel, openStudio, SOLVED, trackErrors, waitIdle } from './helpers';

const out = 'artifacts/mobile-v21/after';
mkdirSync(out, { recursive: true });
async function ready(page: Page) {
  await page.waitForFunction(() => window.__CUBELAB__?.project && !window.__CUBELAB__.lookPending?.());
  await waitIdle(page);
}
async function solve(page: Page) {
  await page.getByRole('button', { name: 'Auto Solve', exact: true }).click();
  await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 60_000 });
  await waitIdle(page);
}
async function closeDetails(page: Page) {
  await page.getByRole('dialog', { name: 'Solution details' }).getByRole('button', { name: 'Close', exact: true }).click();
}

test('390px solve completes compactly; details, stepping, replay and collapse preserve playback', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const page = await context.newPage(), errors = trackErrors(page);
    await openStudio(page, { settings: { cubeStyle: 'stickerless', sound: false, scrambleStyle: 'instant', playbackSpeed: 'fast' } });
    await ready(page); await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/390-normal.png` });
    await page.getByRole('button', { name: 'New Scramble', exact: true }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready');
    await solve(page);
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    await expect(page.locator('.mobile-solution')).toContainText(/^Solved · \d+ movesDetails$/);
    expect((await page.locator('.mobile-solution').boundingBox())!.height).toBeLessThanOrEqual(54);
    await expect(page.getByRole('button', { name: /Scramble/ })).toHaveCount(1);
    await expect(page.getByRole('radiogroup', { name: 'Playback speed' })).toBeHidden();
    await expect(page.locator('.panel-timer__hint')).toHaveCount(0);
    await expect(page.locator('.panel-timer .status-pill')).toContainText('Assisted');
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${out}/390-completed.png` });

    const state = await debug.facelets(page), progress = await debug.solver(page);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Solution details' });
    await expect(sheet.getByRole('list', { name: 'Solution moves' })).toBeVisible();
    await expect(sheet.getByRole('radio', { name: 'Fast', exact: true })).toBeChecked();
    await sheet.evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
    expect(await debug.facelets(page)).toBe(state); expect(await debug.solver(page)).toEqual(progress);
    await page.screenshot({ path: `${out}/390-details.png` });
    await closeDetails(page);
    expect(await debug.facelets(page)).toBe(state); expect(await debug.solver(page)).toEqual(progress);

    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await sheet.getByRole('button', { name: 'Step back (,)', exact: true }).click(); await waitIdle(page);
    expect((await debug.solver(page)).cursor).toBe(progress.total - 1);
    await sheet.getByRole('button', { name: 'Step forward (.)', exact: true }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done');
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await sheet.getByRole('radio', { name: 'Slow', exact: true }).check();
    await sheet.getByRole('button', { name: 'Replay from the start', exact: true }).click();
    await sheet.getByRole('button', { name: 'Pause (P)', exact: true }).click(); await waitIdle(page);
    const paused = await debug.solver(page), partial = await debug.facelets(page);
    await closeDetails(page); await page.waitForTimeout(700);
    expect(await debug.solver(page)).toEqual(paused); expect(await debug.facelets(page)).toBe(partial);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(sheet.getByRole('radio', { name: 'Slow', exact: true })).toBeChecked();
    await sheet.getByRole('radio', { name: 'Fast', exact: true }).check();
    await sheet.getByRole('button', { name: 'Play (P)', exact: true }).click();
    await closeDetails(page);
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done');
    await expect(sheet).toBeHidden(); expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    await page.getByRole('button', { name: 'Close solution', exact: true }).click();
    await expect(page.locator('.mobile-solution')).toHaveCount(0);
    await page.keyboard.press('r'); await expectRenderMatchesModel(page);
    expect(await debug.solved(page)).toBe(false); expect(errors()).toEqual([]);
  } finally { await context.close(); }
});

test('mobile stop, stale retry and a new scramble keep the cube valid and clear obsolete UI', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 320, height: 568 }, hasTouch: true });
  try {
    const page = await context.newPage(), errors = trackErrors(page);
    await openStudio(page, { settings: { scrambleStyle: 'instant', playbackSpeed: 'slow' }, path: '/?scramble=R%20U%20F' });
    await ready(page);
    await page.getByRole('button', { name: 'Auto Solve', exact: true }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'playing');
    await page.getByRole('button', { name: 'Stop — keep the cube as it is', exact: true }).click();
    await expect(page.locator('.mobile-solution')).toHaveCount(0); await expectRenderMatchesModel(page);
    await page.getByRole('button', { name: 'New Scramble', exact: true }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready');
    await page.getByRole('button', { name: 'Auto Solve', exact: true }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'playing');
    await page.getByRole('button', { name: 'Pause (P)', exact: true }).click(); await waitIdle(page);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByRole('dialog').getByRole('radio', { name: 'Fast', exact: true }).check();
    await closeDetails(page);
    await page.keyboard.press('r'); await waitIdle(page);
    await expect(page.locator('.mobile-solution')).toContainText('Solution out of date');
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Solve current state', exact: true }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    await page.getByRole('button', { name: 'New Scramble', exact: true }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready');
    await expect(page.locator('.mobile-solution')).toHaveCount(0);
    expect(await debug.solved(page)).toBe(false); expect(errors()).toEqual([]);
  } finally { await context.close(); }
});

test('mobile sound defaults on silently, starts on a gesture, and saved mute survives reload', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const page = await context.newPage(), errors = trackErrors(page);
    await openStudio(page); await ready(page);
    expect(await page.evaluate(() => window.__CUBELAB__.audio())).toMatchObject({ enabled: true, active: 0, started: { slide: 0, snap: 0, rattle: 0, drag: 0 } });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Sound', exact: true })).toBeChecked();
    await expect(page.getByRole('slider', { name: 'Sound volume', exact: true })).toHaveValue('0.7');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.keyboard.press('r'); await waitIdle(page);
    expect((await page.evaluate(() => window.__CUBELAB__.audio())).started.slide).toBe(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Sound', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const cube = await debug.facelets(page);
    await page.reload(); await ready(page);
    expect(await debug.facelets(page)).toBe(cube);
    expect(await page.evaluate(() => window.__CUBELAB__.audio())).toMatchObject({ enabled: false, context: 'none', active: 0 });
    await page.keyboard.press('u'); await waitIdle(page);
    expect((await page.evaluate(() => window.__CUBELAB__.audio())).started.slide).toBe(0);
    expect(errors()).toEqual([]);
  } finally { await context.close(); }
});

test('desktop keeps its camera, timer guidance and full playback controls', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStudio(page, { settings: { cubeStyle: 'stickerless', sound: false, scrambleStyle: 'instant', playbackSpeed: 'fast' } }); await ready(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/1440-normal.png` });
  const width = await page.evaluate(() => {
    const points = [-1.5,1.5].flatMap(x => [-1.5,1.5].flatMap(y => [-1.5,1.5].map(z => window.__CUBELAB__.project!([x,y,z]))));
    return Math.max(...points.map(p => p.x))-Math.min(...points.map(p => p.x));
  });
  expect(width).toBeCloseTo(532.9705858887689, 3);
  await page.getByRole('button', { name: 'New Scramble', exact: true }).click();
  await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready');
  await solve(page);
  await expect(page.locator('.panel-playback .transport')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Fast', exact: true })).toBeVisible();
  await expect(page.locator('.panel-playback').getByRole('button', { name: 'New Scramble', exact: true })).toBeVisible();
  await expect(page.locator('.mobile-solution')).toHaveCount(0);
  await expect(page.locator('.panel-timer__hint')).toContainText('Auto Solve was used');
  expect(errors()).toEqual([]);
});
