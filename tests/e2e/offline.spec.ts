import { expect, test } from '@playwright/test';
import { EXPERIMENTAL_PUZZLES } from '../../src/core/features';
import { trackErrors, waitForStage } from './helpers';

test('production app reloads offline', async ({ page, context }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 60_000 });
  await expect.poll(async () => page.evaluate(async () => {
    const cacheNames = await caches.keys();
    return cacheNames.some((name) => name.startsWith('cubelab-offline-'));
  })).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await waitForStage(page);
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__CUBELAB__.moveLog() === 'R');
  expect(errors()).toEqual([]);
});

test('production app opens other puzzles offline', async ({ page, context }) => {
  // The other puzzles ship behind EXPERIMENTAL_PUZZLES (src/core/features.ts); with it off the build has the 3×3 only.
  test.skip(!EXPERIMENTAL_PUZZLES, 'experimental puzzles are switched off in this build');
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
