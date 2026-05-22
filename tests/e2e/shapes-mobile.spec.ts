import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

test('Pyraminx stage and turn controls work on a phone', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?puzzle=pyram');
  await expect(page.getByRole('main', { name: 'Pyraminx practice studio' })).toBeVisible();
  await expect.poll(() => page.locator('twisty-player').evaluate((element) => {
    const shadow = (element as typeof element & { shadow?: ShadowRoot }).shadow;
    return shadow?.querySelector('.visualization-wrapper')?.getBoundingClientRect().height ?? 0;
  })).toBeGreaterThan(100);
  if (process.env.CUBELAB_CAPTURE) await page.screenshot({ path: '.impeccable/review/pyram-mobile.png', fullPage: true });
  await page.locator('[title="Turn U clockwise"]').click();
  await expect(page.getByText('Pyraminx in progress')).toBeVisible();
  expect(errors()).toEqual([]);
});
