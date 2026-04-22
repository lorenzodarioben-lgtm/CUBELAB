// Side-by-side captures of both cube styles in identical conditions.
// Usage: npm run build && npm run preview (port 4317) in another shell, then:
//        node scripts/capture-style-matrix.mjs [outDir]
// Writes <outDir>/{stickered,stickerless}/*.png plus selector and switching shots.
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.CUBELAB_URL ?? 'http://localhost:4317/';
const OUT = process.argv[2] ?? 'artifacts/styles';
const SCRAMBLE = "R U F' L2 D B2 R' U2 F L' D2 B'";
const CUBE = { x: 400, y: 120, width: 640, height: 660 };
const args = process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args });
const errors = [];

async function open(settings, { mobile = false, path = '' } = {}) {
  const context = await browser.newContext(mobile ? { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript((s) => {
    localStorage.setItem('cubelab.gestureHintSeen', '1');
    localStorage.setItem('cubelab.settings', JSON.stringify({ v: 1, data: s }));
  }, settings);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  await page.goto(BASE + path);
  await page.waitForFunction((s) => window.__CUBELAB__?.renderedStyle?.() === s, settings.cubeStyle, { timeout: 60000 });
  await page.waitForTimeout(800);
  return { context, page };
}

const project = (page, p) => page.evaluate((pt) => window.__CUBELAB__.project(pt), p);
const idle = (page) => page.waitForFunction(() => window.__CUBELAB__.idle());

async function hold(page, from, to, fraction = 0.5) {
  const a = await project(page, from);
  const b = await project(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(a.x + ((b.x - a.x) * fraction * i) / 14, a.y + ((b.y - a.y) * fraction * i) / 14);
  await page.waitForTimeout(350);
}

async function release(page, from) {
  const a = await project(page, from);
  await page.mouse.move(a.x, a.y, { steps: 8 });
  await page.mouse.up();
  await idle(page);
}

for (const style of ['stickered', 'stickerless']) {
  const dir = `${OUT}/${style}`;
  mkdirSync(dir, { recursive: true });
  const base = { cubeStyle: style, scrambleStyle: 'instant', quality: 'high' };
  {
    const { context, page } = await open(base);
    await page.screenshot({ path: `${dir}/solved.png`, clip: CUBE });
    await page.goto(BASE + '?scramble=' + encodeURIComponent(SCRAMBLE));
    await page.waitForFunction(() => window.__CUBELAB__?.timer().phase === 'ready', null, { timeout: 60000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/scrambled.png`, clip: CUBE });
    await page.screenshot({ path: `${dir}/desktop.png` });
    // Macro close-up.
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -120);
    await page.mouse.move(720, 870);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${dir}/macro.png`, clip: { x: 420, y: 150, width: 600, height: 600 } });
    await page.keyboard.press('c');
    await page.waitForTimeout(900);
    // Mid-turn: a face (R) and a slice (M), held by real mouse drags.
    await hold(page, [1, 0, 1.5], [1, 1.4, 1.5]);
    await page.screenshot({ path: `${dir}/midturn-R.png`, clip: CUBE });
    await release(page, [1, 0, 1.5]);
    await hold(page, [0, 0, 1.5], [0, 1.4, 1.5]);
    await page.screenshot({ path: `${dir}/midturn-M.png`, clip: CUBE });
    await release(page, [0, 0, 1.5]);
    // Upside down: one long upward drag on the floor below the cube.
    await page.mouse.move(720, 860);
    await page.mouse.down();
    for (let i = 1; i <= 26; i++) await page.mouse.move(720 - i * 3, 860 - i * 28);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${dir}/upside-down.png`, clip: CUBE });
    await context.close();
  }
  {
    const { context, page } = await open({ ...base, quality: 'low' }, { path: '?scramble=' + encodeURIComponent(SCRAMBLE) });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/quality-low.png`, clip: CUBE });
    await context.close();
  }
  {
    const { context, page } = await open({ ...base, quality: 'auto' }, { mobile: true, path: '?scramble=' + encodeURIComponent(SCRAMBLE) });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/mobile.png` });
    await context.close();
  }
}

// Selector, both selection states, desktop and phone.
for (const [label, mobile] of [
  ['desktop', false],
  ['mobile', true],
]) {
  for (const style of ['stickered', 'stickerless']) {
    const { context, page } = await open({ cubeStyle: style, scrambleStyle: 'instant' }, { mobile });
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/selector-${label}-${style}.png` });
    await context.close();
  }
}

// Switching while scrambled: same scramble and turns, before and after the switch.
{
  const { context, page } = await open({ cubeStyle: 'stickerless', scrambleStyle: 'instant' }, { path: '?scramble=' + encodeURIComponent(SCRAMBLE) });
  for (const key of ['r', 'u', 'm', 'Shift+E']) await page.keyboard.press(key);
  await idle(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/switch-1-stickerless.png` });
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('radio', { name: /Classic Stickered/ }).check();
  await page.waitForFunction(() => window.__CUBELAB__.renderedStyle() === 'stickered');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/switch-2-stickered.png` });
  const same = await page.evaluate(() => window.__CUBELAB__.visualFacelets() === window.__CUBELAB__.facelets());
  console.log('render == model after switch:', same);
  await context.close();
}

await browser.close();
console.log(errors.length ? `console problems:\n${errors.join('\n')}` : 'no console warnings or errors');
console.log(`style matrix written to ${OUT}`);
