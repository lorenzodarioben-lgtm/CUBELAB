// Captures reference screenshots of the production build into artifacts/.
// Usage: npm run build && npm run preview (port 4317) in another shell, then:
//        node scripts/capture-screenshots.mjs [outDir]
import { chromium, devices } from '@playwright/test';

const BASE = process.env.CUBELAB_URL ?? 'http://localhost:4317/';
const OUT = process.argv[2] ?? 'artifacts';
const args = process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const browser = await chromium.launch({ args });

async function open(viewport, { mobile = false, settings = null, path = '' } = {}) {
  const context = await browser.newContext(
    mobile ? { ...devices['Pixel 7'], viewport } : { viewport, deviceScaleFactor: 1 },
  );
  await context.addInitScript((s) => {
    localStorage.setItem('cubelab.gestureHintSeen', '1');
    if (s) localStorage.setItem('cubelab.settings', JSON.stringify({ v: 1, data: s }));
  }, settings);
  const page = await context.newPage();
  await page.goto(BASE + path);
  await page.waitForFunction(() => document.querySelector('.stage')?.classList.contains('stage--ready'), null, { timeout: 60000 });
  await page.waitForTimeout(600);
  return { context, page };
}

const ready = (page) => page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 60000 });
const idle = (page) => page.waitForFunction(() => window.__CUBELAB__.idle());
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

{
  const { context, page } = await open({ width: 1440, height: 900 }, { settings: { scrambleStyle: 'instant' } });
  await shot(page, 'desktop-1440-fresh');
  await page.getByRole('button', { name: /New Scramble/ }).click();
  await ready(page);
  await page.mouse.move(700, 120);
  await page.waitForTimeout(400);
  await shot(page, 'desktop-1440-scrambled');
  await page.keyboard.press('r');
  await page.waitForTimeout(1400);
  await shot(page, 'desktop-1440-timing');
  await page.getByRole('button', { name: /Auto Solve/ }).click();
  await page.getByRole('button', { name: 'Solve it for me' }).click();
  await page.waitForFunction(() => window.__CUBELAB__.solver().cursor >= 6, null, { timeout: 60000 });
  await page.getByRole('button', { name: 'Pause (P)' }).click();
  await idle(page);
  await page.waitForTimeout(300);
  await shot(page, 'desktop-1440-playback');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'desktop-1440-settings');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await page.waitForTimeout(500);
  await shot(page, 'desktop-1440-help');
  await page.keyboard.press('Escape');
  await context.close();
}

{
  // A few real solves (shared scrambles, solved by hand through the keyboard) to populate stats.
  const { context, page } = await open({ width: 1440, height: 900 }, { settings: { scrambleStyle: 'instant', turnSpeed: 'snappy' } });
  const solves = [["R U F", "Shift+F Shift+U Shift+R"], ["L D B'", "b Shift+D Shift+L"], ["U2 R'", "r u u"], ["F R U'", "u Shift+R Shift+F"], ["B L2", "l l Shift+B"], ["D' F2 R", "Shift+R f f d"]];
  for (const [scramble, keys] of solves) {
    await page.goto(BASE + '?scramble=' + encodeURIComponent(scramble));
    await page.waitForFunction(() => typeof window.__CUBELAB__?.timer === 'function' && window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 60000 });
    for (const k of keys.split(' ')) {
      await page.waitForTimeout(250 + Math.random() * 400);
      await page.keyboard.press(k);
    }
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'solved', null, { timeout: 30000 });
  }
  await page.waitForTimeout(500);
  await shot(page, 'desktop-1440-solved-stats');
  await page.getByRole('button', { name: /History/ }).click();
  await page.waitForTimeout(500);
  await page.locator('.solve__summary').first().click();
  await page.waitForTimeout(300);
  await shot(page, 'desktop-1440-history');
  await page.keyboard.press('Escape');
  await page.keyboard.press('z');
  await page.waitForTimeout(700);
  await shot(page, 'desktop-1440-zen');
  await context.close();
}

{
  const { context, page } = await open({ width: 1280, height: 720 });
  await shot(page, 'laptop-1280x720');
  await context.close();
}

{
  const { context, page } = await open({ width: 768, height: 1024 }, { mobile: true });
  await shot(page, 'tablet-768');
  await context.close();
}

{
  const { context, page } = await open({ width: 390, height: 844 }, { mobile: true, settings: { scrambleStyle: 'instant' } });
  await shot(page, 'mobile-390-fresh');
  await page.locator('.panel-actions').getByRole('button', { name: /New Scramble/ }).tap();
  await ready(page);
  await page.waitForTimeout(400);
  await shot(page, 'mobile-390-scrambled');
  await page.screenshot({ path: `${OUT}/mobile-390-full.png`, fullPage: true });
  await page.locator('.panel-actions').getByRole('button', { name: /Auto Solve/ }).tap();
  await page.waitForFunction(() => window.__CUBELAB__.solver().cursor >= 4, null, { timeout: 60000 });
  await page.getByRole('button', { name: 'Pause (P)' }).tap();
  await idle(page);
  await page.waitForTimeout(300);
  await shot(page, 'mobile-390-playback');
  await context.close();
}

await browser.close();
console.log('screenshots written to', OUT);
