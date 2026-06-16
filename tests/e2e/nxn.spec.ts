import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
    await expect.poll(async () => (await canvas.boundingBox())?.height ?? 0, {
      message: 'the WebGL canvas has resized to its stage',
    }).toBeGreaterThan(500);
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
    await expect(page.locator('.nxn-records dl > div').filter({ hasText: 'Clean solves' }).locator('dd')).toHaveText('0');
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

  test('event statistics use ao5 for 2×2 and mo3 for 6×6', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    const add = async (seconds: string) => {
      await page.getByRole('button', { name: 'Add physical solve' }).click();
      await page.getByRole('textbox', { name: 'Time' }).fill(seconds);
      await page.getByRole('button', { name: 'Save result' }).click();
    };
    for (const seconds of ['10.00', '11.00', '12.00', '13.00', '14.00']) await add(seconds);
    await expect(page.locator('.nxn-records dl > div').filter({ hasText: 'Current ao5' }).locator('dd')).toHaveText('12.00');
    await expect(page.getByRole('img', { name: 'Recent solve times, from 10.00 to 14.00' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Puzzle' }).selectOption('666');
    for (const seconds of ['20.00', '21.00', '22.00']) await add(seconds);
    await expect(page.locator('.nxn-records dl > div').filter({ hasText: 'Current mo3' }).locator('dd')).toHaveText('21.00');
    expect(errors()).toEqual([]);
  });

  test('penalty corrections update a saved personal best', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    await page.getByRole('button', { name: 'Add physical solve' }).click();
    await page.getByRole('textbox', { name: 'Time' }).fill('20.00');
    await page.getByRole('button', { name: 'Save result' }).click();
    const best = page.locator('.nxn-records dd').first();
    await expect(best).toHaveText('20.00');
    const penalty = page.locator('.nxn-history select');
    await penalty.selectOption('+2');
    await expect(best).toHaveText('22.00');
    await penalty.selectOption('DNF');
    await expect(best).toHaveText('—');
    expect(errors()).toEqual([]);
  });

  test('solve removal requires a second action and updates statistics', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    await page.getByRole('button', { name: 'Add physical solve' }).click();
    await page.getByRole('textbox', { name: 'Time' }).fill('20.00');
    await page.getByRole('button', { name: 'Save result' }).click();
    await page.locator('.nxn-history__delete').click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.nxn-records dd').first()).toHaveText('20.00');
    await page.locator('.nxn-history__delete').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.nxn-records dd').first()).toHaveText('—');
    await expect(page.locator('.nxn-history li')).toHaveCount(0);
    expect(errors()).toEqual([]);
  });

  test('exports and restores event results', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    await page.getByRole('button', { name: 'Add physical solve' }).click();
    await page.getByRole('textbox', { name: 'Time' }).fill('18.42');
    await page.getByRole('button', { name: 'Save result' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export results' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^cubelab-222-results-.*\.json$/);
    await page.locator('.nxn-history__delete').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.nxn-records dd').first()).toHaveText('—');
    await page.getByLabel('Import results file').setInputFiles(await download.path());
    await expect(page.locator('.nxn-records dd').first()).toHaveText('18.42');
    expect(errors()).toEqual([]);
  });

  test('reload restores the current cube without resuming an interrupted timer', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=444');
    await page.getByRole('button', { name: 'New Scramble' }).click();
    await expect(page.getByText('First turn starts the clock')).toBeVisible({ timeout: 60_000 });
    const scramble = await page.locator('.nxn-scramble').textContent();
    await page.locator('[title="Turn R clockwise"]').click();
    await expect(page.locator('.nxn-last-turn strong')).toHaveText('R');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('cubelab.nxn.444.current') ?? '{}').moves === 'R');
    await page.reload();
    await expect(page.locator('.nxn-scramble')).toHaveText(scramble!);
    await expect(page.locator('.nxn-last-turn strong')).toHaveText('R');
    await expect(page.getByText('PRACTICE TIMER')).toBeVisible();
    await expect(page.getByText('4×4 in progress')).toBeVisible();
    expect(errors()).toEqual([]);
  });

  test('exports exact per-event results as CSV', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=444');
    await page.getByRole('button', { name: 'Add physical solve' }).click();
    await page.getByRole('textbox', { name: 'Time' }).fill('12.345');
    await page.getByRole('combobox', { name: 'Penalty' }).selectOption('+2');
    await page.getByRole('button', { name: 'Save result' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^cubelab-444-results-.*\.csv$/);
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv).toContain('"12.345","\'+2","14.345"');
    expect(csv).toContain('"444"');
    expect(errors()).toEqual([]);
  });

  test('opens the full history beyond the recent eight results', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    for (let i = 0; i < 9; i++) {
      await page.getByRole('button', { name: 'Add physical solve' }).click();
      await page.getByRole('textbox', { name: 'Time' }).fill(`${10 + i}.00`);
      await page.getByRole('button', { name: 'Save result' }).click();
    }
    await expect(page.locator('.nxn-history li')).toHaveCount(8);
    await page.getByRole('button', { name: 'Show all 9 solves' }).click();
    await expect(page.locator('.nxn-history li')).toHaveCount(9);
    await expect(page.locator('.nxn-history li').last()).toContainText('10.00');
    await page.getByRole('button', { name: 'Show recent 8' }).click();
    await expect(page.locator('.nxn-history li')).toHaveCount(8);
    expect(errors()).toEqual([]);
  });

  test('shared sound volume is adjustable across puzzle modes', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=222');
    const slider = page.getByRole('slider', { name: 'Turn sound volume' });
    await expect(slider).toBeDisabled();
    await page.getByRole('button', { name: 'Enable sound' }).click();
    await expect(slider).toBeEnabled();
    await slider.press('Home');
    await expect(page.locator('.puzzle-sound output')).toHaveText('0%');
    await slider.press('End');
    await expect(page.locator('.puzzle-sound output')).toHaveText('100%');
    await page.getByRole('combobox', { name: 'Puzzle' }).selectOption('skewb');
    await expect(page.getByRole('slider', { name: 'Turn sound volume' })).toHaveValue('1');
    expect(errors()).toEqual([]);
  });
});
