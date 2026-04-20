import { expect, test } from '@playwright/test';
import { SOLVED, debug, dragCube, expectRenderMatchesModel, openStudio, trackErrors, waitIdle } from './helpers';

/** Cube-space centre of each face. */
const CENTRE = { U: [0, 1.5, 0], D: [0, -1.5, 0] } as const;

test.describe('turning the cube over', () => {
  test('dragging the background tumbles freely until white faces the floor; twists still work upside down', async ({ page }) => {
    const errors = trackErrors(page);
    await openStudio(page);
    const version = await debug.version(page);
    expect((await debug.camera(page)).up[1]).toBeGreaterThan(0.5);

    // One long upward drag from the empty floor below the cube rolls it over.
    await page.mouse.move(720, 860);
    await page.mouse.down();
    for (let i = 1; i <= 26; i++) await page.mouse.move(720, 860 - i * 30);
    await page.mouse.up();
    await page.waitForFunction(() => window.__CUBELAB__.camera().up[1] < -0.5);
    await page.waitForTimeout(600);

    // White (U) is now at the bottom of the screen, yellow (D) at the top.
    const white = await debug.project(page, [...CENTRE.U]);
    const yellow = await debug.project(page, [...CENTRE.D]);
    expect(white.y).toBeGreaterThan(yellow.y + 80);
    // Only the view changed: the puzzle, its notation and the clock are untouched.
    expect(await debug.version(page)).toBe(version);
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    expect((await debug.timer(page)).phase).toBe('idle');

    // The D face now faces up: its middle column pushed toward the front is M'.
    await dragCube(page, [0, -1.5, 0], [0, -1.5, 1.4]);
    await expectRenderMatchesModel(page);
    expect(await debug.moveLog(page)).toBe("M'");

    // C brings the view home, upright again.
    await page.keyboard.press('c');
    await page.waitForFunction(() => window.__CUBELAB__.camera().up[1] > 0.5);
    expect(errors()).toEqual([]);
  });

  test('x2 re-grips the cube: yellow on top, U turns it, and the clock ignores rotations', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: /New Scramble/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    const scrambled = await debug.facelets(page);

    await page.keyboard.press('x');
    await page.keyboard.press('x');
    await waitIdle(page);
    const regripped = await expectRenderMatchesModel(page);
    expect(regripped).not.toBe(scrambled);
    expect(regripped[4]).toBe('D'); // the U centre is yellow
    expect(regripped[31]).toBe('U'); // the D centre is white
    expect(await debug.moveLog(page)).toBe('x x');
    expect((await debug.timer(page)).phase).toBe('ready');
    await expect(page.locator('.moves__count')).toHaveText(/^0/);

    // U now turns the yellow layer and starts the clock.
    await page.keyboard.press('u');
    await expectRenderMatchesModel(page);
    expect((await debug.timer(page)).phase).toBe('running');
    await expect(page.locator('.moves__count')).toHaveText(/^1/);
  });

  test('the Rotate bank turns the whole cube and auto solve keeps the chosen orientation', async ({ page }) => {
    await openStudio(page, { settings: { playbackSpeed: 'fast' } });
    await page.getByRole('radio', { name: 'Rotate' }).check();
    await expect(page.getByRole('group', { name: 'Whole-cube rotations' })).toBeVisible();
    await page.getByRole('button', { name: /^x2: turn the whole cube/ }).click();
    await waitIdle(page);
    await page.getByRole('radio', { name: 'Faces' }).check();
    await page.getByRole('button', { name: /^R: turn/ }).click();
    await page.getByRole('button', { name: /^U': turn/ }).click();
    await waitIdle(page);
    expect(await debug.moveLog(page)).toBe("x2 R U'");

    await page.getByRole('button', { name: /Auto Solve/ }).first().click();
    await page.waitForFunction(() => window.__CUBELAB__.solved() && window.__CUBELAB__.idle(), null, { timeout: 30_000 });
    const end = await expectRenderMatchesModel(page);
    expect(end.slice(0, 9)).toBe('DDDDDDDDD'); // still yellow on top
  });
});
