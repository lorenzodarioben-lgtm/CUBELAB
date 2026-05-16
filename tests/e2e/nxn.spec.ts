import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

test.describe('NxN practice studio', () => {
  test('2×2 renders, turns, and returns to solved', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    await expect(page.getByRole('main', { name: '2×2×2 practice studio' })).toBeVisible();
    await expect(page.locator('.nxn-canvas canvas')).toBeVisible();
    if (process.env.CUBELAB_CAPTURE) await page.screenshot({ path: '.impeccable/review/desktop.png' });
    await page.locator('[title="Turn R clockwise"]').click();
    await expect(page.getByText('2×2 in progress')).toBeVisible();
    await page.locator('[title="Turn R counter-clockwise"]').click();
    await expect(page.getByText('Puzzle solved')).toBeVisible();
    expect(errors()).toEqual([]);
  });

  test('4×4 wide turns and puzzle selection stay separate', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=444');
    await expect(page.getByRole('main', { name: '4×4×4 practice studio' })).toBeVisible();
    await page.getByRole('button', { name: 'Wide 2' }).click();
    await page.locator('[title="Turn U clockwise"]').click();
    await expect(page.getByText('4×4 in progress')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Puzzle solved')).toBeVisible();
    await page.getByRole('combobox', { name: 'Puzzle' }).selectOption('222');
    await expect(page.getByRole('main', { name: '2×2×2 practice studio' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('puzzle')).toBe('222');
    expect(errors()).toEqual([]);
  });

  test('dragging a 2×2 sticker turns the row under the pointer', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    const canvas = page.locator('.nxn-canvas canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width * 0.35;
    const y = box.y + box.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 110, y, { steps: 9 });
    await page.mouse.up();
    await expect(page.locator('.nxn-last-turn strong')).toHaveText('U');
    expect(errors()).toEqual([]);
  });

  test('2×2 event generator produces a playable scramble', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    await page.getByRole('button', { name: 'New Scramble' }).click();
    await expect(page.getByText('First turn starts the clock')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.nxn-scramble')).not.toContainText('Generate a scramble to begin.');
    await page.keyboard.press('r');
    await expect(page.getByText('Solve the puzzle to stop')).toBeVisible();
    expect(errors()).toEqual([]);
  });

  test('2×2 solution applies without creating a timed record', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    await page.locator('[title="Turn R clockwise"]').click();
    await expect(page.getByText('2×2 in progress')).toBeVisible();
    await page.getByRole('button', { name: 'Find Solution' }).click();
    await expect(page.getByRole('button', { name: 'Apply solution' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Apply solution' }).click();
    await expect(page.getByText('Puzzle solved')).toBeVisible();
    await expect(page.locator('.nxn-records dd').nth(1)).toHaveText('0');
    expect(errors()).toEqual([]);
  });

  test('every large cube accepts its actual event scramble', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=444');
    for (const event of ['444', '555', '666', '777']) {
      await page.getByRole('combobox', { name: 'Puzzle' }).selectOption(event);
      await page.getByRole('button', { name: 'New Scramble' }).click();
      await expect(page.getByText('First turn starts the clock')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.nxn-scramble')).not.toContainText('Generate a scramble to begin.');
      await expect(page.getByText('Puzzle solved')).toHaveCount(0);
    }
    expect(errors()).toEqual([]);
  });

  test('NxN turns use the recorded cube sound when enabled', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    await page.getByRole('button', { name: 'Enable sound' }).click();
    await page.waitForFunction(() => window.__CUBELAB__.audio().context === 'running');
    await page.locator('[title="Turn R clockwise"]').click();
    await expect(page.locator('.nxn-last-turn strong')).toHaveText('R');
    const started = await page.evaluate(() => window.__CUBELAB__.audio().started);
    expect(started.slide).toBe(1);
    expect(started.snap).toBe(1);
    expect(errors()).toEqual([]);
  });

  test('physical solve times persist only for their puzzle event', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=444');
    await page.getByRole('button', { name: 'Add physical solve' }).click();
    await page.getByRole('textbox', { name: 'Time' }).fill('32.47');
    await page.getByRole('combobox', { name: 'Penalty' }).selectOption('+2');
    await page.getByRole('button', { name: 'Save result' }).click();
    await expect(page.locator('.nxn-records dd').first()).toHaveText('34.47');
    await expect(page.locator('.nxn-history small').filter({ hasText: 'physical' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Puzzle' }).selectOption('222');
    await expect(page.locator('.nxn-records dd').first()).toHaveText('—');
    await page.getByRole('combobox', { name: 'Puzzle' }).selectOption('444');
    await expect(page.locator('.nxn-records dd').first()).toHaveText('34.47');
    expect(errors()).toEqual([]);
  });
});
