import { expect, test } from '@playwright/test';
import { SOLVED, debug, dragCube, expectRenderMatchesModel, openStudio, trackErrors, waitIdle } from './helpers';

test.describe('CUBELAB studio (desktop, production build)', () => {
  test('loads without errors and shows the cube, timer and primary controls', async ({ page }) => {
    const errors = trackErrors(page);
    await openStudio(page);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('.readout')).toBeVisible();
    for (const name of ['New Scramble', 'Auto Solve', 'Reset']) {
      await expect(page.getByRole('button', { name: new RegExp(name) }).first()).toBeVisible();
    }
    await expect(page.getByRole('group', { name: 'Face turns' })).toBeVisible();
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    // No fabricated statistics on a fresh profile.
    await expect(page.getByText('No timed solves yet.')).toBeVisible();
    expect(errors()).toEqual([]);
  });

  test('orbiting moves the camera but never the puzzle', async ({ page }) => {
    await openStudio(page);
    const before = await debug.camera(page);
    const version = await debug.version(page);
    // Drag on empty background, left of the cube and right of the left rail.
    await page.mouse.move(420, 760);
    await page.mouse.down();
    await page.mouse.move(520, 700, { steps: 10 });
    await page.mouse.up();
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(400);
    const after = await debug.camera(page);
    expect(Math.abs(after.azimuth - before.azimuth)).toBeGreaterThan(0.1);
    expect(after.zoom).not.toBe(before.zoom);
    expect(await debug.version(page)).toBe(version);
    expect(await debug.facelets(page)).toBe(SOLVED);
    expect((await debug.timer(page)).phase).toBe('idle');

    await page.getByRole('button', { name: 'Reset camera (C)' }).first().click();
    await page.waitForTimeout(900);
    const home = await debug.camera(page);
    expect(Math.abs(home.polar - before.polar)).toBeLessThan(0.01);
    expect(home.zoom).toBeCloseTo(1, 2);
  });

  test("Move Pad R then R' restores the cube, logically and visually", async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: /^R: turn red face \(R\) clockwise/ }).click();
    const afterR = await expectRenderMatchesModel(page);
    expect(afterR).toBe('UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB');
    await page.getByRole('button', { name: /^R': turn red face \(R\) counter-clockwise/ }).click();
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
  });

  test('dragging stickers performs real face turns; middle slices are refused', async ({ page }) => {
    await openStudio(page);
    // Push the front-right column up: R.
    await dragCube(page, [1, 0, 1.5], [1, 1.35, 1.5]);
    expect(await expectRenderMatchesModel(page)).toBe('UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB');
    // Push the front top row left: U.
    await dragCube(page, [0, 1, 1.5], [-1.35, 1, 1.5]);
    const afterRU = await expectRenderMatchesModel(page);
    expect(afterRU).not.toBe(SOLVED);
    const version = await debug.version(page);
    // Centre sticker drag would be a slice move: nothing happens, a hint explains why.
    await dragCube(page, [0, 0, 1.5], [0, 1.3, 1.5]);
    await expect(page.locator('.stage-hint')).toContainText('Middle layers');
    await waitIdle(page);
    expect(await debug.version(page)).toBe(version);
    // Keyboard: U' then R' undoes both.
    await page.keyboard.press('Shift+U');
    await page.keyboard.press('Shift+R');
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
  });

  test('New Scramble applies a random-state scramble and readies the timer; first turn starts it', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: /New Scramble/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    const scramble = await debug.scramble(page);
    expect(scramble).toMatch(/^([UDLRFB]['2]? ?){15,30}$/);
    await expect(page.locator('.notation')).toContainText(scramble!.split(' ')[0]!);
    expect(await debug.solved(page)).toBe(false);
    await expectRenderMatchesModel(page);
    expect((await debug.timer(page)).startedAt).toBeNull();

    await page.keyboard.press('u');
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'running');
    const first = await page.locator('.readout').innerText();
    await page.waitForTimeout(600);
    const later = await page.locator('.readout').innerText();
    expect(later).not.toBe(first);
  });

  test('Auto Solve solves the current state after manual moves, without recording a PB', async ({ page }) => {
    await openStudio(page, { settings: { playbackSpeed: 'fast', scrambleStyle: 'instant' } });
    await page.getByRole('button', { name: /New Scramble/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    for (const key of ['r', 'u', 'Shift+F', 'l', 'd']) await page.keyboard.press(key);
    await waitIdle(page);
    expect((await debug.timer(page)).phase).toBe('running');

    await page.getByRole('button', { name: /Auto Solve/ }).click();
    await page.getByRole('button', { name: 'Solve it for me' }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 60_000 });
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    expect((await debug.timer(page)).phase).toBe('assisted');
    expect(await debug.historyCount(page)).toBe(0);
    await expect(page.getByText(/Solved in \d+ moves/)).toBeVisible();
  });

  test('playback pause, step, resume, stop, then re-solve', async ({ page }) => {
    await openStudio(page, { settings: { playbackSpeed: 'slow', scrambleStyle: 'instant' } });
    await page.getByRole('button', { name: /New Scramble/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    await page.getByRole('button', { name: /Auto Solve/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'playing', null, { timeout: 60_000 });
    await page.waitForFunction(() => window.__CUBELAB__.solver().cursor >= 2);

    await page.getByRole('button', { name: 'Pause (P)' }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'paused');
    await waitIdle(page);
    const paused = await debug.solver(page);
    await expectRenderMatchesModel(page);

    await page.getByRole('button', { name: 'Step back (,)' }).click();
    await waitIdle(page);
    expect((await debug.solver(page)).cursor).toBe(paused.cursor - 1);
    await page.getByRole('button', { name: 'Step forward (.)' }).click();
    await waitIdle(page);
    expect((await debug.solver(page)).cursor).toBe(paused.cursor);
    await expectRenderMatchesModel(page);

    await page.getByRole('button', { name: 'Play (P)' }).click();
    await page.waitForFunction((c) => window.__CUBELAB__.solver().cursor > c, paused.cursor);
    await page.getByRole('button', { name: /^Stop/ }).click();
    await waitIdle(page);
    expect((await debug.solver(page)).status).toBe('idle');
    expect(await debug.solved(page)).toBe(false);
    await expectRenderMatchesModel(page);

    // A manual turn on the partially solved cube, then a fresh solve of that state.
    await page.keyboard.press('f');
    await waitIdle(page);
    await page.getByRole('button', { name: /Auto Solve/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'playing', null, { timeout: 60_000 });
    await page.getByRole('radio', { name: 'Fast' }).check();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 90_000 });
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
  });

  test('undo, redo and reset behave and keep render and model in sync', async ({ page }) => {
    await openStudio(page);
    await page.keyboard.press('r');
    await waitIdle(page);
    const afterR = await debug.facelets(page);
    await page.keyboard.press('u');
    await waitIdle(page);
    const afterRU = await debug.facelets(page);
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
    expect(await expectRenderMatchesModel(page)).toBe(afterR);
    await page.keyboard.press('Control+Shift+Z');
    expect(await expectRenderMatchesModel(page)).toBe(afterRU);
    await page.keyboard.press('Control+Z');
    await page.keyboard.press('Control+Z');
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
    await page.keyboard.press('Control+Y');
    await page.keyboard.press('b');
    await waitIdle(page);
    await expect(page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' })).toBeDisabled();
    await page.getByRole('button', { name: /^Reset$/ }).click();
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
  });

  test('a real timed solve is recorded, and history + settings survive a reload', async ({ page }) => {
    await openStudio(page, { path: '/?scramble=R%20U', settings: { scrambleStyle: 'instant' } });
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    expect(await debug.scramble(page)).toBe('R U');
    await expect(page).toHaveURL(/\/$/); // share param consumed
    await page.keyboard.press('Shift+U');
    await page.keyboard.press('Shift+R');
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'solved');
    expect(await debug.historyCount(page)).toBe(1);
    await expect(page.locator('.stat-grid')).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog').getByRole('radio', { name: 'Matte' }).check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.reload();
    await page.waitForFunction(() => typeof window.__CUBELAB__?.historyCount === 'function');
    expect(await debug.historyCount(page)).toBe(1);
    await page.getByRole('button', { name: /History/ }).click();
    await expect(page.getByRole('dialog').locator('.solve')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog').getByRole('radio', { name: 'Matte' })).toBeChecked();
  });

  test('primary controls are keyboard reachable', async ({ page }) => {
    await openStudio(page, { settings: { scrambleStyle: 'instant' } });
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(() => document.activeElement?.textContent?.includes('New Scramble') ?? false);
    }
    expect(found).toBe(true);
    const focusRing = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(focusRing).not.toBe('none');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'How CUBELAB works' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('spacebar mode: hold to arm, release to start, solve stops it', async ({ page }) => {
    await openStudio(page, { path: '/?scramble=F', settings: { timerMode: 'spacebar', inspection: false, scrambleStyle: 'instant' } });
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    // Turning before the clock runs is refused.
    await page.keyboard.press('Shift+F');
    await waitIdle(page);
    expect(await debug.solved(page)).toBe(false);
    await page.keyboard.down('Space');
    await page.waitForTimeout(450);
    await expect(page.locator('.readout')).toHaveAttribute('data-armed', 'true');
    await page.keyboard.up('Space');
    expect((await debug.timer(page)).phase).toBe('running');
    await page.keyboard.press('Shift+F');
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'solved');
    expect(await debug.historyCount(page)).toBe(1);
  });
});
