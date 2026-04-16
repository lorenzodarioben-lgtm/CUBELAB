import { expect } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import type { DebugApi } from '../../src/app/debug';

declare global {
  interface Window {
    __CUBELAB__: DebugApi;
  }
}

export type Point3 = [number, number, number];

/** Collects console errors and uncaught exceptions for the whole test. */
export function trackErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return () => errors;
}

/**
 * Opens the studio with a clean slate (storage cleared once per test, so
 * reloads inside a test keep their data) and optional seeded settings.
 */
export async function openStudio(page: Page, options: { settings?: Record<string, unknown>; path?: string } = {}): Promise<void> {
  await page.addInitScript((settings) => {
    if (sessionStorage.getItem('cubelab:e2e-initialised')) return;
    localStorage.clear();
    localStorage.setItem('cubelab.gestureHintSeen', '1');
    if (settings) localStorage.setItem('cubelab.settings', JSON.stringify({ v: 1, data: settings }));
    sessionStorage.setItem('cubelab:e2e-initialised', '1');
  }, options.settings ?? null);
  await page.goto(options.path ?? '/');
  await waitForStage(page);
}

export async function waitForStage(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('.stage')?.classList.contains('stage--ready') && typeof window.__CUBELAB__?.project === 'function', null, {
    timeout: 60_000,
  });
}

export async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__CUBELAB__.idle());
  // One more frame so the renderer has drawn the committed state.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export const debug = {
  facelets: (page: Page) => page.evaluate(() => window.__CUBELAB__.facelets()),
  visual: (page: Page) => page.evaluate(() => window.__CUBELAB__.visualFacelets?.() ?? ''),
  version: (page: Page) => page.evaluate(() => window.__CUBELAB__.version()),
  solved: (page: Page) => page.evaluate(() => window.__CUBELAB__.solved()),
  camera: (page: Page) => page.evaluate(() => window.__CUBELAB__.camera()),
  timer: (page: Page) => page.evaluate(() => window.__CUBELAB__.timer()),
  historyCount: (page: Page) => page.evaluate(() => window.__CUBELAB__.historyCount()),
  scramble: (page: Page) => page.evaluate(() => window.__CUBELAB__.scramble()),
  solver: (page: Page) => page.evaluate(() => window.__CUBELAB__.solver()),
  project: (page: Page, p: Point3) => page.evaluate((point) => window.__CUBELAB__.project!(point), p),
};

export const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

/** The rendered stickers (read from the three.js scene graph) must equal the canonical model. */
export async function expectRenderMatchesModel(page: Page): Promise<string> {
  await waitIdle(page);
  const [visual, model, pattern] = await page.evaluate(() => [
    window.__CUBELAB__.visualFacelets?.() ?? '',
    window.__CUBELAB__.facelets(),
    window.__CUBELAB__.patternFacelets(),
  ]);
  expect(visual).toBe(model);
  expect(model).toBe(pattern);
  return model;
}

/** Mouse drag between two cube-space points (projected to the screen). */
export async function dragCube(page: Page, from: Point3, to: Point3, steps = 12): Promise<void> {
  const a = await debug.project(page, from);
  const b = await debug.project(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  }
  await page.mouse.up();
}

/**
 * Chromium's CDP touch emulation swallows the first tap after a synthetic
 * touch drag — reproducible on a bare page with no app code. A tap on inert
 * text absorbs it so the following real tap is delivered.
 */
export async function absorbEmulatedTap(page: Page): Promise<void> {
  await page.locator('.brand__word').tap();
}

/** Real touch-pointer drag via CDP (pointerType "touch"). */
export async function touchDrag(cdp: CDPSession, a: { x: number; y: number }, b: { x: number; y: number }, steps = 12): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
