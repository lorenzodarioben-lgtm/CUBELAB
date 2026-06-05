import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

test('production app reloads and opens other puzzles offline', async ({ page, context }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 60_000 });
  await expect.poll(async () => page.evaluate(async () => {
    const cacheNames = await caches.keys();
    return cacheNames.some((name) => name.startsWith('cubelab-offline-'));
  })).toBe(true);

  await context.setOffline(true);
  await page.goto('/?puzzle=444');
  await expect(page.getByRole('main', { name: '4×4×4 practice studio' })).toBeVisible();
  await page.locator('[title="Turn R clockwise"]').click();
  await expect(page.getByText('4×4 in progress')).toBeVisible();
  await page.getByRole('combobox', { name: 'Puzzle' }).selectOption('pyram');
  await expect(page.getByRole('main', { name: 'Pyraminx practice studio' })).toBeVisible();
  await page.getByRole('button', { name: 'New Scramble' }).click();
  await expect(page.getByText('First turn starts the clock')).toBeVisible({ timeout: 60_000 });
  expect(errors()).toEqual([]);
});
