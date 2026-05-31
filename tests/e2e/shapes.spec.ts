import { expect, test } from '@playwright/test';
import type { TwistyPlayer } from 'cubing/twisty';
import { trackErrors } from './helpers';

test.describe('shape puzzles', () => {
  for (const [event, name, face] of [['pyram', 'Pyraminx', 'U'], ['skewb', 'Skewb', 'R'], ['minx', 'Megaminx', 'R']] as const) {
    test(`${name} renders, turns, and generates its event scramble`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto(`/?puzzle=${event}`);
      await expect(page.getByRole('main', { name: `${name} practice studio` })).toBeVisible();
      await expect(page.locator('twisty-player')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => page.locator('twisty-player').evaluate((element) => {
        const shadow = (element as typeof element & { shadow?: ShadowRoot }).shadow;
        return shadow?.querySelector('.visualization-wrapper')?.getBoundingClientRect().height ?? 0;
      })).toBeGreaterThan(300);
      if (process.env.CUBELAB_CAPTURE) {
        await page.waitForTimeout(500);
        await page.screenshot({ path: `.impeccable/review/${event}.png` });
      }
      await page.locator(`[title="Turn ${face} clockwise"]`).click();
      await expect(page.getByText(`${name} in progress`)).toBeVisible();
      await page.locator(`[title="Turn ${face} counter-clockwise"]`).click();
      await expect(page.getByText('Puzzle solved')).toBeVisible();
      await page.getByRole('button', { name: 'New Scramble' }).click();
      await expect(page.getByText('First turn starts the clock')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.nxn-scramble')).not.toContainText('Generate a scramble to begin.');
      await page.getByRole('button', { name: 'Copy scramble' }).click();
      const normalize = (value: string | null) => value?.replace(/\s+/g, ' ').trim();
      expect(normalize(await page.evaluate(() => navigator.clipboard.readText()))).toBe(normalize(await page.locator('.nxn-scramble').textContent()));
      await expect.poll(async () => page.locator('twisty-player').evaluate(async (element) => {
        const view = element as TwistyPlayer;
        const [pattern, kpuzzle] = await Promise.all([view.experimentalModel.currentPattern.get(), view.experimentalModel.kpuzzle.get()]);
        const scramble = document.querySelector('.nxn-scramble')?.textContent ?? '';
        return pattern.isIdentical(kpuzzle.defaultPattern().applyAlg(scramble));
      })).toBe(true);
      expect(errors()).toEqual([]);
    });
  }

  test('physical shape results stay with their own event', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=skewb');
    await page.getByRole('button', { name: 'Add physical solve' }).click();
    await page.getByRole('textbox', { name: 'Time' }).fill('13.48');
    await page.getByRole('combobox', { name: 'Penalty' }).selectOption('+2');
    await page.getByRole('button', { name: 'Save result' }).click();
    await expect(page.locator('.nxn-records dd').first()).toHaveText('15.48');
    await page.getByRole('combobox', { name: 'Puzzle' }).selectOption('pyram');
    await expect(page.locator('.nxn-records dd').first()).toHaveText('—');
    await page.getByRole('combobox', { name: 'Puzzle' }).selectOption('skewb');
    await expect(page.locator('.nxn-records dd').first()).toHaveText('15.48');
    expect(errors()).toEqual([]);
  });

  test('shape penalties can be corrected after saving', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=skewb');
    await page.getByRole('button', { name: 'Add physical solve' }).click();
    await page.getByRole('textbox', { name: 'Time' }).fill('13.48');
    await page.getByRole('button', { name: 'Save result' }).click();
    const best = page.locator('.nxn-records dd').first();
    await expect(best).toHaveText('13.48');
    const penalty = page.locator('.nxn-history select');
    await penalty.selectOption('+2');
    await expect(best).toHaveText('15.48');
    await penalty.selectOption('DNF');
    await expect(best).toHaveText('—');
    expect(errors()).toEqual([]);
  });

  test('shape result removal takes two actions', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=skewb');
    await page.getByRole('button', { name: 'Add physical solve' }).click();
    await page.getByRole('textbox', { name: 'Time' }).fill('13.48');
    await page.getByRole('button', { name: 'Save result' }).click();
    await page.locator('.nxn-history__delete').click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.nxn-records dd').first()).toHaveText('13.48');
    await page.locator('.nxn-history__delete').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.nxn-records dd').first()).toHaveText('—');
    expect(errors()).toEqual([]);
  });

  test('backs up and restores shape results', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/?puzzle=skewb');
    await page.getByRole('button', { name: 'Add physical solve' }).click();
    await page.getByRole('textbox', { name: 'Time' }).fill('13.48');
    await page.getByRole('button', { name: 'Save result' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export results' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^cubelab-skewb-results-.*\.json$/);
    await page.locator('.nxn-history__delete').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByLabel('Import results file').setInputFiles(await download.path());
    await expect(page.locator('.nxn-records dd').first()).toHaveText('13.48');
    expect(errors()).toEqual([]);
  });
});
