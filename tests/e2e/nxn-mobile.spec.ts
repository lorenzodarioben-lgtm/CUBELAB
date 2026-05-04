import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

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
