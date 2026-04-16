import { expect, test } from '@playwright/test';

test.describe('reduced motion', () => {
  test('turns apply instantly and nothing animates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('cubelab.gestureHintSeen', '1'));
    await page.goto('/');
    await page.waitForFunction(() => document.querySelector('.stage')?.classList.contains('stage--ready'));
    await page.getByRole('button', { name: /^F: turn green face/ }).click();
    // Committed synchronously: no animation frames needed.
    expect(await page.evaluate(() => window.__CUBELAB__.version())).toBe(1);
    expect(await page.evaluate(() => window.__CUBELAB__.idle())).toBe(true);
    const animation = await page.locator('.stage__orbits .dashed').evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe('none');
  });
});
