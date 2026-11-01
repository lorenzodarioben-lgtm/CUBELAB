/**
 * Experimental Stickerless v2 (`?stickerless=v2`) in the real browser: its
 * shaders compile and draw the puzzle state (pixel colours on screen match the
 * model after face, slice and rotation moves, and during a held turn), it
 * survives quality changes without leaking GPU resources, Classic Stickered
 * renders identically whether or not the flag is present, and the build
 * ignores the development branch's diagnostic and review parameters.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { faceletIndex } from '../../src/core/puzzle/facelets';
import type { Face } from '../../src/core/puzzle/notation';
import { debug, openStudio, trackErrors, waitIdle } from './helpers';
import type { Point3 } from './helpers';

const V2 = '/?stickerless=v2';
const STICKERLESS = { cubeStyle: 'stickerless', finish: 'gloss', quality: 'high', sound: false, scrambleStyle: 'instant' };

/** Hue family of a rendered colour (lighting changes brightness and adds sheen, not hue). */
function family([r, g, b]: number[]): Face {
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  const s = max === 0 ? 0 : (max - min) / max;
  if (s < 0.3) return 'U';
  let h: number;
  if (max === r) h = (60 * ((g! - b!) / (max - min)) + 360) % 360;
  else if (max === g) h = 60 * ((b! - r!) / (max - min)) + 120;
  else h = 60 * ((r! - g!) / (max - min)) + 240;
  if (h < 15 || h > 330) return 'R';
  if (h < 42) return 'L';
  if (h < 75) return 'D';
  if (h < 175) return 'F';
  return 'B';
}

/** Facelets on the three faces the home view shows, as cube points just inside the face plane. */
function visibleFacelets(skip: (p: Point3) => boolean = () => false) {
  const out: Array<{ face: Face; pos: Point3; point: Point3 }> = [];
  for (const a of [-1, 0, 1]) {
    for (const b of [-1, 0, 1]) {
      out.push({ face: 'U', pos: [a, 1, b], point: [a + 0.18, 1.49, b + 0.18] });
      out.push({ face: 'F', pos: [a, b, 1], point: [a + 0.18, b + 0.18, 1.49] });
      out.push({ face: 'R', pos: [1, a, b], point: [1.49, a + 0.18, b + 0.18] });
    }
  }
  return out.filter((f) => !skip(f.pos));
}

/** Compares the colour family drawn at each visible facelet with the model's facelets. */
async function renderedMismatches(page: Page, skip?: (p: Point3) => boolean): Promise<string[]> {
  const model = await debug.facelets(page);
  const facelets = visibleFacelets(skip);
  const screen = await page.evaluate((points) => points.map((p) => window.__CUBELAB__.project!(p)), facelets.map((f) => f.point));
  const pixels = await page.evaluate((pts) => window.__CUBELAB__.samplePixels!(pts), screen);
  return facelets
    .map((f, i) => ({ f, want: model[faceletIndex(f.face, f.pos)] as Face, got: family(pixels[i]!) , px: pixels[i] }))
    .filter((r) => r.want !== r.got)
    .map((r) => `${r.f.face}${r.f.pos.join(',')}: want ${r.want}, drew ${r.got} ${JSON.stringify(r.px)}`);
}

async function setQuality(page: Page, name: 'Auto' | 'High' | 'Low') {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('dialog').getByRole('radio', { name, exact: true }).check();
  await page.keyboard.press('Escape');
}

test('v2 compiles and draws the puzzle state after face, slice and rotation moves', async ({ page }) => {
  const errors = trackErrors(page);
  await openStudio(page, { settings: STICKERLESS, path: V2 });
  expect(await page.evaluate(() => window.__CUBELAB__.stickerlessRenderer!())).toBe('v2');
  expect(await renderedMismatches(page)).toEqual([]);
  for (const key of ['KeyR', 'KeyU', 'KeyM', 'Shift+KeyF', 'KeyE', 'KeyS', 'KeyY', 'KeyD', 'Shift+KeyM', 'KeyX', 'KeyB', 'KeyL']) {
    await page.keyboard.press(key);
    await waitIdle(page);
  }
  expect(await debug.solved(page)).toBe(false);
  expect(await renderedMismatches(page)).toEqual([]);
  expect(errors()).toEqual([]);
});

test('v2 keeps every stationary piece in place while a layer is held part-way', async ({ page }) => {
  await openStudio(page, { settings: STICKERLESS, path: V2 });
  await page.keyboard.press('KeyF');
  await waitIdle(page);
  const a = await page.evaluate(() => window.__CUBELAB__.project!([1, 0, 1.5]));
  const b = await page.evaluate(() => window.__CUBELAB__.project!([1, 1.5, 1.5]));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 30, a.y + ((b.y - a.y) * i) / 30);
  await page.waitForTimeout(300);
  const turn = await page.evaluate(() => window.__CUBELAB__.visualTurn!());
  expect(turn?.layer).toBe(1);
  expect(Math.abs(turn!.angle)).toBeGreaterThan(0.2);
  // Everything outside the R layer is stationary and must still match the model.
  expect(await renderedMismatches(page, (p) => p[0] === 1)).toEqual([]);
  await page.mouse.move(a.x, a.y, { steps: 6 });
  await page.mouse.up();
  await waitIdle(page);
  expect(await renderedMismatches(page)).toEqual([]);
});

test('production ignores the v2 diagnostics: Y draws the same pixels and no diagnostic hook exists', async ({ browser, baseURL }) => {
  const grid: Array<{ x: number; y: number }> = [];
  for (let y = 140; y <= 780; y += 16) for (let x = 440; x <= 1040; x += 16) grid.push({ x, y });
  const capture = async (path: string) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await openStudio(page, { settings: STICKERLESS, path });
    await waitIdle(page);
    await page.waitForTimeout(1500);
    const pixels = await page.evaluate((pts) => window.__CUBELAB__.samplePixels!(pts), grid);
    const hooks = await page.evaluate(() => {
      const api = window.__CUBELAB__ as unknown as Record<string, unknown>;
      return { renderer: window.__CUBELAB__.stickerlessRenderer!(), v2SetFeature: typeof api.v2SetFeature, v2StudioMaps: typeof api.v2StudioMaps, buildMs: typeof api.stickerlessEnvBuildMs };
    });
    expect(errors()).toEqual([]);
    await context.close();
    return { pixels, hooks };
  };
  const plain = await capture(V2);
  const diagnostic = await capture(`${V2}&v2studio=x&v2debug=bench&v2seam=2`);
  for (const run of [plain, diagnostic]) expect(run.hooks).toEqual({ renderer: 'v2', v2SetFeature: 'undefined', v2StudioMaps: 'undefined', buildMs: 'undefined' });
  const differing = plain.pixels.filter((p, i) => p.some((v, k) => Math.abs(v - diagnostic.pixels[i]![k]!) > 1)).length;
  expect(differing).toBe(0);
});

test('v2 survives repeated quality changes without leaking GPU resources', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openStudio(page, { settings: STICKERLESS, path: V2 });
  await setQuality(page, 'Low');
  await setQuality(page, 'High');
  await waitIdle(page);
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => window.__CUBELAB__.renderInfo!());
  for (let i = 0; i < 5; i++) {
    await setQuality(page, 'Low');
    await page.waitForTimeout(300);
    await setQuality(page, 'High');
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__CUBELAB__.renderInfo!());
  await test.info().attach('v2-quality-resource-counts', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
  expect(after.geometries).toBeLessThanOrEqual(before.geometries);
  expect(after.textures).toBeLessThanOrEqual(before.textures);
  expect(after.programs).toBeLessThanOrEqual(before.programs);
  expect(await renderedMismatches(page)).toEqual([]);
  expect(errors()).toEqual([]);
});

test('Classic Stickered draws the same pixels with or without the v2 flag', async ({ browser, baseURL }) => {
  const grid: Array<{ x: number; y: number }> = [];
  for (let y = 140; y <= 780; y += 16) for (let x = 440; x <= 1040; x += 16) grid.push({ x, y });
  const capture = async (path: string) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await openStudio(page, { settings: { cubeStyle: 'stickered', quality: 'high', sound: false }, path });
    await waitIdle(page);
    await page.waitForTimeout(1500);
    const pixels = await page.evaluate((pts) => window.__CUBELAB__.samplePixels!(pts), grid);
    await context.close();
    return pixels;
  };
  const plain = await capture('/');
  const flagged = await capture(V2);
  const differing = plain.filter((p, i) => p.some((v, k) => Math.abs(v - flagged[i]![k]!) > 1)).length;
  expect(differing).toBe(0);
});

test('the lighting review exists only on the dev server: production ignores ?v2review', async ({ page }) => {
  const errors = trackErrors(page);
  await openStudio(page, { settings: STICKERLESS, path: '/?v2review' });
  await waitIdle(page);
  expect(await page.evaluate(() => window.__CUBELAB__.stickerlessRenderer!())).toBe('v1');
  await expect(page.getByRole('complementary', { name: 'Lighting review' })).toHaveCount(0);
  expect(await page.evaluate(() => (window.__CUBELAB__ as unknown as Record<string, unknown>).v2StudioMaps)).toBeUndefined();
  expect(await page.evaluate(() => document.querySelector('.app')!.classList.contains('is-zen'))).toBe(false);
  expect(errors()).toEqual([]);
});
