import { expect, test } from '@playwright/test';
import type { RootState } from '@react-three/fiber';
import type { Mesh, MeshPhysicalMaterial } from 'three';
import { expectRenderMatchesModel, openStudio, trackErrors } from './helpers';

for (const style of ['stickered', 'stickerless'] as const) {
  test(`${style}: legacy Matte settings render approved Gloss without a finish control`, async ({ page }, info) => {
    const errors = trackErrors(page);
    await openStudio(page, { settings: { cubeStyle: style, finish: 'matte', quality: 'high', sound: false, orbitSensitivity: 1.4 } });
    await page.waitForFunction(() => !window.__CUBELAB__.lookPending?.());
    const appearance = await page.evaluate(() => {
      type Hook = { memoizedState?: { current?: RootState & { get?: () => RootState } }; next?: Hook };
      type Fiber = { return?: Fiber; memoizedState?: Hook };
      const canvas = document.querySelector('.stage__canvas canvas') as unknown as Record<string, Fiber>;
      for (let f = canvas[Object.keys(canvas).find(k => k.startsWith('__reactFiber$'))!]; f; f = f.return!) {
        for (let h = f.memoizedState; h && typeof h === 'object'; h = h.next) {
          const s = h.memoizedState?.current;
          if (!s?.gl || !s.scene?.isScene) continue;
          const state = s.get ? s.get() : s;
          const mesh = state.scene.getObjectByName('cubie-U')!.children.find(o => (o as Mesh).isMesh) as Mesh;
          const m = mesh.material as MeshPhysicalMaterial;
          return { roughness: m.roughness, coat: m.clearcoat, key: m.customProgramCacheKey() };
        }
      }
      throw Error('Renderer not found');
    });
    expect(appearance.roughness).toBeLessThan(style === 'stickerless' ? 0.14 : 0.31);
    expect(appearance.coat).toBe(style === 'stickerless' ? 0.14 : 0.85);
    expect(appearance.key).not.toContain('matte');
    await page.screenshot({ path: info.outputPath(`${style}-gloss.png`), clip: { x: 400, y: 120, width: 640, height: 660 } });
    const original = await expectRenderMatchesModel(page);
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await expect(page.getByRole('radio', { name: /Modern Stickerless/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Classic Stickered/ })).toBeVisible();
    await expect(page.getByText('Premium Stickerless', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: /^(Gloss|Matte)$/ })).toHaveCount(0);
    await expect(page.getByRole('dialog').getByText('Finish', { exact: true })).toHaveCount(0);
    await page.getByRole('radio', { name: 'Low', exact: true }).check();
    await page.waitForFunction(() => !window.__CUBELAB__.lookPending?.());
    await page.keyboard.press('Escape');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('cubelab.settings')!).data);
    expect(stored.finish).toBeUndefined();
    expect(stored.orbitSensitivity).toBe(1.4);
    expect(await expectRenderMatchesModel(page)).toBe(original);
    await page.keyboard.press('r');
    await expectRenderMatchesModel(page);
    await page.reload();
    await page.waitForFunction(() => window.__CUBELAB__?.project && !window.__CUBELAB__.lookPending?.());
    await expectRenderMatchesModel(page);
    expect(errors()).toEqual([]);
  });
}
