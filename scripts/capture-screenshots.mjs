// Captures reference screenshots of the production build.
// Usage: npm run build && npm run preview (port 4317) in another shell, then:
//        node scripts/capture-screenshots.mjs [outDir]
// Everything shown is produced by real interaction: shared scrambles, keyboard
// solves, mouse drags (including a paused mid-turn slice) and the real solver.
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.CUBELAB_URL ?? 'http://localhost:4317/';
const OUT = process.argv[2] ?? 'artifacts/after';
mkdirSync(OUT, { recursive: true });
const args = process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const browser = await chromium.launch({ args });
const errors = [];

async function open(viewport, { mobile = false, settings = null, path = '' } = {}) {
  const context = await browser.newContext(mobile ? { ...devices['Pixel 7'], viewport } : { viewport, deviceScaleFactor: 1 });
  await context.addInitScript((s) => {
    localStorage.setItem('cubelab.gestureHintSeen', '1');
    if (s) localStorage.setItem('cubelab.settings', JSON.stringify({ v: 1, data: s }));
  }, settings);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  await page.goto(BASE + path);
  await page.waitForFunction(() => document.querySelector('.stage')?.classList.contains('stage--ready'), null, { timeout: 60000 });
  await page.waitForTimeout(700);
  return { context, page };
}

const ready = (page) => page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 60000 });
const idle = (page) => page.waitForFunction(() => window.__CUBELAB__.idle());
const shot = (page, name, clip) => page.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) });
const project = (page, p) => page.evaluate((pt) => window.__CUBELAB__.project(pt), p);

/** Presses on `from`, drags part-way toward `to` and holds (for a mid-turn capture). */
async function holdDrag(page, from, to, fraction = 0.55) {
  const a = await project(page, from);
  const b = await project(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(a.x + ((b.x - a.x) * fraction * i) / 14, a.y + ((b.y - a.y) * fraction * i) / 14);
  await page.waitForTimeout(250);
}

const SCRAMBLE = "R U F' L2 D B2 R' U2 F L' D2 B'";

{
  const { context, page } = await open({ width: 1440, height: 900 }, { settings: { scrambleStyle: 'instant' } });
  await shot(page, 'desktop-1440-solved');
  await page.goto(BASE + '?scramble=' + encodeURIComponent(SCRAMBLE));
  await ready(page);
  await page.waitForTimeout(600);
  await shot(page, 'desktop-1440-scrambled');
  for (const k of ['m', 'r', 'Shift+E', 'u', 's']) await page.keyboard.press(k);
  await idle(page);
  await page.waitForTimeout(1200);
  await shot(page, 'desktop-1440-timing-with-slices');

  // Mid-turn slice captures, held by a real mouse drag.
  for (const [name, from, to] of [
    ['M', [0, 0, 1.5], [0, 1.4, 1.5]],
    ['E', [0, 0, 1.5], [1.4, 0, 1.5]],
    ['S', [0, 1.5, 0], [1.4, 1.5, 0]],
  ]) {
    await holdDrag(page, from, to);
    await shot(page, `cube-midturn-${name}`, { x: 400, y: 120, width: 640, height: 660 });
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await idle(page);
  }

  // Macro close-up.
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -120);
  await page.mouse.move(720, 870);
  await page.waitForTimeout(900);
  await shot(page, 'cube-macro', { x: 420, y: 150, width: 600, height: 600 });
  await page.keyboard.press('c');
  await page.waitForTimeout(900);

  // Free view: one long upward background drag rolls the cube over (white faces the floor).
  await page.mouse.move(720, 860);
  await page.mouse.down();
  for (let i = 1; i <= 26; i++) await page.mouse.move(720, 860 - i * 30);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await shot(page, 'cube-white-down', { x: 400, y: 120, width: 640, height: 660 });
  await page.keyboard.press('c');
  await page.waitForTimeout(900);

  await page.getByRole('radio', { name: 'Slices' }).check();
  await page.waitForTimeout(300);
  await shot(page, 'desktop-1440-slice-pad');
  await page.getByRole('radio', { name: 'Rotate' }).check();
  await page.waitForTimeout(300);
  await shot(page, 'desktop-1440-rotate-pad');
  await page.getByRole('radio', { name: 'Faces' }).check();

  await page.getByRole('button', { name: /Auto Solve/ }).click();
  await page.getByRole('button', { name: 'Solve it for me' }).click();
  await page.waitForFunction(() => window.__CUBELAB__.solver().cursor >= 6, null, { timeout: 60000 });
  await page.getByRole('button', { name: 'Pause (P)' }).click();
  await idle(page);
  await page.waitForTimeout(400);
  await shot(page, 'desktop-1440-playback');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(450);
  await shot(page, 'desktop-1440-settings');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await page.waitForTimeout(450);
  await shot(page, 'desktop-1440-help');
  await page.keyboard.press('Escape');
  await context.close();
}

{
  // Real solves (shared scrambles solved by hand through the keyboard, slices included).
  const { context, page } = await open({ width: 1440, height: 900 }, { settings: { scrambleStyle: 'instant', turnSpeed: 'snappy' } });
  const solves = [
    ["R U F", "Shift+F Shift+U Shift+R"],
    ["M E S", "Shift+S Shift+E Shift+M"],
    ["U2 R'", "r u u"],
    ["F R U'", "u Shift+R Shift+F"],
    ["M2 L", "Shift+L m m"],
    ["D' F2 R", "Shift+R f f d"],
    ["S' U", "Shift+U s"],
  ];
  for (const [scramble, keys] of solves) {
    await page.goto(BASE + '?scramble=' + encodeURIComponent(scramble));
    await page.waitForFunction(() => typeof window.__CUBELAB__?.timer === 'function' && window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 60000 });
    for (const k of keys.split(' ')) {
      await page.waitForTimeout(220 + Math.random() * 380);
      await page.keyboard.press(k);
    }
    await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'solved', null, { timeout: 30000 });
  }
  await page.waitForTimeout(500);
  await shot(page, 'desktop-1440-session-stats');
  await page.getByRole('button', { name: /History/ }).click();
  await page.waitForTimeout(450);
  await page.locator('.solve__summary').nth(1).click();
  await page.waitForTimeout(300);
  await shot(page, 'desktop-1440-history');
  await page.keyboard.press('Escape');
  await page.keyboard.press('z');
  await page.waitForTimeout(700);
  await shot(page, 'desktop-1440-zen');
  await context.close();
}

{
  const { context, page } = await open({ width: 1920, height: 1080 }, { path: '?scramble=' + encodeURIComponent(SCRAMBLE) });
  await page.waitForTimeout(500);
  await shot(page, 'desktop-1920-scrambled');
  await context.close();
}

{
  const { context, page } = await open({ width: 1280, height: 720 }, { settings: { scrambleStyle: 'instant' }, path: '?scramble=' + encodeURIComponent(SCRAMBLE) });
  await page.waitForTimeout(500);
  await shot(page, 'laptop-1280x720');
  await page.getByRole('button', { name: /Auto Solve/ }).click();
  await page.waitForFunction(() => window.__CUBELAB__.solver().cursor >= 3, null, { timeout: 60000 });
  await page.getByRole('button', { name: 'Pause (P)' }).click();
  await idle(page);
  await page.waitForTimeout(500);
  await shot(page, 'laptop-1280x720-playback');
  await context.close();
}

{
  const { context, page } = await open({ width: 768, height: 1024 }, { mobile: true, path: '?scramble=' + encodeURIComponent(SCRAMBLE) });
  await page.waitForTimeout(500);
  await shot(page, 'tablet-768');
  await context.close();
}

for (const width of [390, 320]) {
  const { context, page } = await open({ width, height: 844 }, { mobile: true, settings: { scrambleStyle: 'instant', playbackSpeed: 'slow' } });
  await shot(page, `mobile-${width}-solved`);
  await page.locator('.panel-actions').getByRole('button', { name: /New Scramble/ }).tap();
  await ready(page);
  await page.waitForTimeout(400);
  await shot(page, `mobile-${width}-scrambled`);
  if (width === 390) {
    await page.screenshot({ path: `${OUT}/mobile-390-full.png`, fullPage: true });
    await page.locator('.panel-actions').getByRole('button', { name: /Auto Solve/ }).tap();
    await page.waitForFunction(() => window.__CUBELAB__.solver().cursor >= 3, null, { timeout: 60000 });
    await page.getByRole('button', { name: 'Pause (P)' }).tap();
    await idle(page);
    await page.waitForTimeout(300);
    await shot(page, 'mobile-390-playback');
  }
  await context.close();
}

await browser.close();
console.log(errors.length ? `console problems:\n${errors.join('\n')}` : 'no console warnings or errors');
console.log('screenshots written to', OUT);
