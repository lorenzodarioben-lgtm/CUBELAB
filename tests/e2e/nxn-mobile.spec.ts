import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';
import { EXPERIMENTAL_PUZZLES } from '../../src/core/features';

// The other puzzles ship behind EXPERIMENTAL_PUZZLES (src/core/features.ts); with it off the build has the 3×3 only.
test.skip(!EXPERIMENTAL_PUZZLES, 'experimental puzzles are switched off in this build');

test('NxN studio fits a phone and keeps controls reachable', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?puzzle=444');
  await expect(page.getByRole('main', { name: '4×4×4 practice studio' })).toBeVisible();
  await expect(page.locator('.nxn-canvas canvas')).toBeVisible();
  if (process.env.CUBELAB_CAPTURE) await page.screenshot({ path: '.impeccable/review/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Wide 2' }).click();
  await page.locator('[title="Turn R clockwise"]').click();
  await expect(page.getByText('4×4 in progress')).toBeVisible();
  expect(errors()).toEqual([]);
});
