import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SOLVED, debug, dragCube, expectRenderMatchesModel, openStudio, trackErrors, waitIdle } from './helpers';

type Style = 'stickered' | 'stickerless';

const renderedStyle = (page: Page) => page.evaluate(() => window.__CUBELAB__.renderedStyle?.() ?? null);

/** Picks a style in Settings and closes the dialog, waiting until the 3D scene shows it. */
async function chooseStyle(page: Page, style: Style): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('radio', { name: style === 'stickered' ? /Classic Stickered/ : /Premium Stickerless/ }).check();
  await page.waitForFunction((s) => window.__CUBELAB__.renderedStyle?.() === s, style);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
}

/** Everything a style change must leave untouched. */
async function sessionState(page: Page) {
  return page.evaluate(() => {
    const api = window.__CUBELAB__;
    return {
      version: api.version(),
      facelets: api.facelets(),
      pattern: api.patternFacelets(),
      timer: api.timer(),
      scramble: api.scramble(),
      moveLog: api.moveLog(),
      history: api.historyCount(),
      solver: api.solver(),
      camera: api.camera(),
    };
  });
}

test.describe('cube styles', () => {
  test('stickerless by default; Settings switches the live cube and the choice persists', async ({ page }) => {
    const errors = trackErrors(page);
    await openStudio(page);
    expect(await renderedStyle(page)).toBe('stickerless');
    await chooseStyle(page, 'stickered');
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    await page.reload();
    await page.waitForFunction(() => window.__CUBELAB__?.renderedStyle?.() === 'stickered', null, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await expect(page.getByRole('radio', { name: /Classic Stickered/ })).toBeChecked();
    await page.keyboard.press('Escape');
    expect(errors()).toEqual([]);
  });

  test('switching mid-session keeps the exact cube, clock, log and view, and the solver still works', async ({ page }) => {
    await openStudio(page, { settings: { scrambleStyle: 'instant', playbackSpeed: 'fast' } });
    await page.getByRole('button', { name: /New Scramble/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    // R U M E' x2 F2, then tumble the view.
    for (const key of ['r', 'u', 'm', 'Shift+E', 'x', 'x', 'f', 'f']) await page.keyboard.press(key);
    await waitIdle(page);
    await page.mouse.move(720, 860);
    await page.mouse.down();
    await page.mouse.move(700, 600, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    expect((await debug.timer(page)).phase).toBe('running');
    const before = await sessionState(page);

    await chooseStyle(page, 'stickered');
    const after = await sessionState(page);
    expect(after).toEqual(before);
    await expectRenderMatchesModel(page);

    // Keep turning on the stickered model, then switch back and auto-solve.
    await page.keyboard.press('r');
    await page.keyboard.press('Shift+U');
    await waitIdle(page);
    await expectRenderMatchesModel(page);
    const log = await debug.moveLog(page);
    await chooseStyle(page, 'stickerless');
    expect(await debug.moveLog(page)).toBe(log);
    await expectRenderMatchesModel(page);
    await page.getByRole('button', { name: /Auto Solve/ }).first().click();
    await page.getByRole('button', { name: 'Solve it for me' }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 60_000 });
    await expectRenderMatchesModel(page);
    expect(await debug.solved(page)).toBe(true);
    expect(await debug.historyCount(page)).toBe(0);
  });

  test('every way of turning works on the Classic Stickered model', async ({ page }) => {
    await openStudio(page, { settings: { cubeStyle: 'stickered' } });
    expect(await renderedStyle(page)).toBe('stickered');
    await dragCube(page, [1, 0, 1.5], [1, 1.35, 1.5]); // R
    await dragCube(page, [0, 0, 1.5], [0, 1.35, 1.5]); // M'
    await expectRenderMatchesModel(page);
    await page.keyboard.press('Shift+E');
    await page.keyboard.press('y');
    await page.getByRole('radio', { name: 'Slices' }).check();
    await page.getByRole('button', { name: /^S2: turn S slice/ }).click();
    await waitIdle(page);
    expect(await debug.moveLog(page)).toBe("R M' E' y S2");
    await expectRenderMatchesModel(page);
    // Undo everything: back to solved, rendered exactly.
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
    await waitIdle(page);
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
  });

  test('switching during inspection and during solver playback is safe', async ({ page }) => {
    await openStudio(page, { settings: { scrambleStyle: 'instant', timerMode: 'spacebar', inspection: true, playbackSpeed: 'slow' } });
    await page.getByRole('button', { name: /New Scramble/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'inspecting');
    const inspecting = await debug.timer(page);
    await chooseStyle(page, 'stickered');
    expect(await debug.timer(page)).toEqual(inspecting);

    // Solver playback at slow speed; switch while moves are animating.
    await page.getByRole('button', { name: /Auto Solve/ }).first().click();
    const confirm = page.getByRole('button', { name: 'Solve it for me' });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'playing' && window.__CUBELAB__.solver().cursor >= 1, null, { timeout: 60_000 });
    await chooseStyle(page, 'stickerless');
    await chooseStyle(page, 'stickered');
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 90_000 });
    await expectRenderMatchesModel(page);
    expect(await debug.solved(page)).toBe(true);
  });

  test('100 style switches leave GPU resources stable', async ({ page }) => {
    test.setTimeout(120_000);
    await openStudio(page, { settings: { scrambleStyle: 'instant', quality: 'high' } });
    await page.getByRole('button', { name: /New Scramble/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Settings' }).first().click();
    const radio = (style: Style) => page.getByRole('radio', { name: style === 'stickered' ? /Classic Stickered/ : /Premium Stickerless/ });
    const flip = async (i: number) => {
      const style: Style = i % 2 === 0 ? 'stickered' : 'stickerless';
      await radio(style).check();
      await page.waitForFunction((s) => window.__CUBELAB__.renderedStyle?.() === s, style);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    };
    // Warm-up: both models shown once (first upload and shader compile).
    await flip(0);
    await flip(1);
    const warm = await page.evaluate(() => window.__CUBELAB__.renderInfo!());
    for (let i = 2; i < 100; i++) await flip(i);
    const end = await page.evaluate(() => window.__CUBELAB__.renderInfo!());
    expect(end.geometries).toBe(warm.geometries);
    expect(end.textures).toBe(warm.textures);
    expect(end.programs).toBe(warm.programs);
    await page.keyboard.press('Escape');
    await expectRenderMatchesModel(page);
  });
});
