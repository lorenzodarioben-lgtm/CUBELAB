import { expect, test } from '@playwright/test';
import type { TwistyPlayer } from 'cubing/twisty';
import { trackErrors } from './helpers';

test.describe('shape puzzles', () => {
  for (const [event, name, face] of [['pyram', 'Pyraminx', 'U'], ['skewb', 'Skewb', 'R']] as const) {
    test(`${name} renders, turns, and generates its event scramble`, async ({ page }) => {
      const errors = trackErrors(page);
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
      await expect.poll(async () => page.locator('twisty-player').evaluate(async (element) => {
        const view = element as TwistyPlayer;
        const [pattern, kpuzzle] = await Promise.all([view.experimentalModel.currentPattern.get(), view.experimentalModel.kpuzzle.get()]);
        const scramble = document.querySelector('.nxn-scramble')?.textContent ?? '';
        return pattern.isIdentical(kpuzzle.defaultPattern().applyAlg(scramble));
      })).toBe(true);
      expect(errors()).toEqual([]);
    });
  }
});
