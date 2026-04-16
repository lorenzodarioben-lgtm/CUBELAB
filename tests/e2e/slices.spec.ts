import { expect, test } from '@playwright/test';
import { SOLVED, debug, dragCube, expectRenderMatchesModel, openStudio, trackErrors, waitIdle } from './helpers';

/** Facelets after one slice turn from solved (hand-derived; see tests/unit/slices.test.ts). */
const AFTER = {
  M: 'UBUUBUUBU' + 'RRRRRRRRR' + 'FUFFUFFUF' + 'DFDDFDDFD' + 'LLLLLLLLL' + 'BDBBDBBDB',
  "M'": 'UFUUFUUFU' + 'RRRRRRRRR' + 'FDFFDFFDF' + 'DBDDBDDBD' + 'LLLLLLLLL' + 'BUBBUBBUB',
  E: 'UUUUUUUUU' + 'RRRFFFRRR' + 'FFFLLLFFF' + 'DDDDDDDDD' + 'LLLBBBLLL' + 'BBBRRRBBB',
  S: 'UUULLLUUU' + 'RURRURRUR' + 'FFFFFFFFF' + 'DDDRRRDDD' + 'LDLLDLLDL' + 'BBBBBBBBB',
  M2: 'UDUUDUUDU' + 'RRRRRRRRR' + 'FBFFBFFBF' + 'DUDDUDDUD' + 'LLLLLLLLL' + 'BFBBFBBFB',
};

test.describe('M / E / S middle slices (desktop, production build)', () => {
  test('mouse drags on the middle strips turn M, E and S with matching preview notation', async ({ page }) => {
    const errors = trackErrors(page);
    await openStudio(page);

    // Front centre column, pushed up → M'.
    await dragCube(page, [0, 0, 1.5], [0, 1.35, 1.5]);
    expect(await expectRenderMatchesModel(page)).toBe(AFTER["M'"]);
    await page.keyboard.press('m'); // undo it with the keyboard
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);

    // Front centre row, pushed right → E.
    await dragCube(page, [0, 0, 1.5], [1.35, 0, 1.5]);
    expect(await expectRenderMatchesModel(page)).toBe(AFTER.E);
    await page.keyboard.press('Shift+E');
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);

    // Top face middle row (z = 0), pushed toward R → S.
    await dragCube(page, [0, 1.5, 0], [1.35, 1.5, 0]);
    expect(await expectRenderMatchesModel(page)).toBe(AFTER.S);
    await page.keyboard.press('Shift+S');
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);

    // The live preview label names the slice while dragging, before release.
    const a = await debug.project(page, [0, -1, 1.5]);
    const b = await debug.project(page, [0, -2.4, 1.5]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
    await expect(page.locator('.twist-label')).toHaveText('M');
    await expect(page.locator('.twist-label')).toHaveAttribute('data-ready', 'true');
    await page.mouse.up();
    expect(await expectRenderMatchesModel(page)).toBe(AFTER.M);
    expect(await debug.moveLog(page)).toBe("M' M E E' S S' M");
    expect(errors()).toEqual([]);
  });

  test('slices still resolve correctly after orbiting the camera', async ({ page }) => {
    await openStudio(page);
    // Orbit with the keyboard to look from the front-left (L, F and U visible).
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => window.__CUBELAB__.camera().azimuth < -0.5);
    await page.waitForTimeout(500);
    // Left face middle row pushed toward the back: L → B is E'.
    await dragCube(page, [-1.5, 0, 0.6], [-1.5, 0, -0.9]);
    await expectRenderMatchesModel(page);
    expect(await debug.moveLog(page)).toBe("E'");
    // Front face middle column pushed down: M.
    await dragCube(page, [0, 0, 1.5], [0, -1.35, 1.5]);
    await expectRenderMatchesModel(page);
    expect(await debug.moveLog(page)).toBe("E' M");
    // The adjacent outer column still turns the outer face (pushing F's left column down is L).
    await dragCube(page, [-1, 0, 1.5], [-1, -1.35, 1.5]);
    await expectRenderMatchesModel(page);
    expect(await debug.moveLog(page)).toBe("E' M L");
  });

  test('Move Pad slice bank, undo/redo, save/reload and auto-solve after slices', async ({ page }) => {
    await openStudio(page, { settings: { playbackSpeed: 'fast' } });
    await page.getByRole('radio', { name: 'Slices' }).check();
    await page.getByRole('button', { name: /^M2: turn M slice/ }).click();
    expect(await expectRenderMatchesModel(page)).toBe(AFTER.M2);
    await page.getByRole('button', { name: /^E': turn E slice/ }).click();
    await page.getByRole('button', { name: /^S: turn S slice/ }).click();
    await waitIdle(page);
    const afterThree = await debug.facelets(page);
    expect(await debug.moveLog(page)).toBe("M2 E' S");

    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
    await waitIdle(page);
    expect(await debug.moveLog(page)).toBe("M2 E'");
    await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click();
    expect(await expectRenderMatchesModel(page)).toBe(afterThree);

    // Reload: the slice-turned cube (displaced centres included) comes back exactly.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.stage')?.classList.contains('stage--ready'));
    expect(await expectRenderMatchesModel(page)).toBe(afterThree);
    await expect(page.getByRole('radio', { name: 'Slices' })).toBeChecked();

    // Auto Solve the restored state (no move history survives a reload).
    await page.getByRole('button', { name: /Auto Solve/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 60_000 });
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
  });

  test('scramble, then mixed face and slice turns, then auto-solve; timer counts slices', async ({ page }) => {
    await openStudio(page, { settings: { scrambleStyle: 'instant', playbackSpeed: 'fast' } });
    await page.getByRole('button', { name: /New Scramble/ }).click();
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
    for (const key of ['m', 'Shift+E', 'r', 's', 'Shift+M', 'u']) await page.keyboard.press(key);
    await waitIdle(page);
    expect((await debug.timer(page)).phase).toBe('running');
    expect((await debug.timer(page)).turns).toBe(6);
    await expectRenderMatchesModel(page);
    await page.getByRole('button', { name: /Auto Solve/ }).click();
    await page.getByRole('button', { name: 'Solve it for me' }).click();
    await page.waitForFunction(() => window.__CUBELAB__.solver().status === 'done', null, { timeout: 60_000 });
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    expect(await debug.historyCount(page)).toBe(0);
  });
});
