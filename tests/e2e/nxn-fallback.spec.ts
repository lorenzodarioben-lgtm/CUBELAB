import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

test.use({ launchOptions: { args: ['--disable-3d-apis', '--disable-webgl'] } });

test('NxN falls back to a playable net without WebGL', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?puzzle=444');
  await expect(page.getByRole('group', { name: '4×4 cube net' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('button', { name: /Turn R face/ }).click();
  await expect(page.getByText('4×4 in progress')).toBeVisible();
  await page.getByRole('button', { name: /Turn R face/ }).click({ modifiers: ['Shift'] });
  await expect(page.getByText('Puzzle solved')).toBeVisible();
  expect(errors()).toEqual([]);
});
