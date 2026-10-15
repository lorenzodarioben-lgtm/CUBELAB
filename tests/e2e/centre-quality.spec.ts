import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RootState } from '@react-three/fiber';
import type { Mesh, BufferGeometry, Material } from 'three';
import { buildStickerlessChamferGeometry } from '../../src/components/cube/stickerlessChamferGeometry';
import { expectRenderMatchesModel, openStudio, trackErrors, waitIdle } from './helpers';

const PIECE_DETAIL = { high: 40, medium: 30, low: 24 } as const;

declare global {
  interface Window {
    __CENTRE_QUALITY_TEST__: { state: RootState; decline?: () => void };
  }
}

// Read the real production scene and PerformanceMonitor callback. No application
// test endpoint or experimental geometry override is needed for these checks.
async function scene(page: Page) {
  await page.evaluate(() => {
    type Element = { props?: { children?: Element | Element[]; flipflops?: number; onDecline?: () => void } };
    type Hook = { memoizedState?: { current?: RootState & { get?: () => RootState } }; next?: Hook };
    type Fiber = { return?: Fiber; alternate?: Fiber; memoizedState?: Hook; memoizedProps?: { children?: Element | Element[] } };
    const canvas = document.querySelector('.stage__canvas canvas') as unknown as Record<string, Fiber>;
    const key = Object.keys(canvas).find(k => k.startsWith('__reactFiber$'))!;
    let state: RootState | undefined, decline: (() => void) | undefined;
    const visit = (element?: Element | Element[]) => {
      if (!element || decline) return;
      if (Array.isArray(element)) { element.forEach(visit); return; }
      if (element.props?.flipflops === 2 && element.props.onDecline) decline = element.props.onDecline;
      else visit(element.props?.children);
    };
    for (let f: Fiber | undefined = canvas[key]; f; f = f.return) {
      for (let hook = f.memoizedState; hook && typeof hook === 'object'; hook = hook.next) {
        const value = hook.memoizedState?.current;
        if (value?.gl && value?.scene?.isScene) state = value.get ? value.get() : value;
      }
      visit(f.memoizedProps?.children);
      visit(f.alternate?.memoizedProps?.children);
    }
    if (!state) throw Error('Production renderer not found');
    window.__CENTRE_QUALITY_TEST__ = { state, decline };
  });
}

async function centres(page: Page) {
  await scene(page);
  return page.evaluate(async () => {
    const { state } = window.__CENTRE_QUALITY_TEST__, { gl, scene, camera } = state;
    gl.render(scene, camera);
    const context = gl.getContext();
    const hash = async (array: ArrayBufferView) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(array.buffer as ArrayBuffer, array.byteOffset, array.byteLength)))].map(x => x.toString(16).padStart(2, '0')).join('');
    const groups = scene.getObjectByName('cube')!.children.filter(g => /^cubie-[UDFBRL]$/.test(g.name));
    return Promise.all(groups.map(async group => {
      const mesh = group.children.find(o => (o as Mesh).isMesh) as Mesh<BufferGeometry, Material>;
      const properties = gl.properties.get(mesh.material) as { currentProgram?: { program: WebGLProgram }; programs?: Map<string, { program: WebGLProgram }> };
      const program = properties.currentProgram ?? [...(properties.programs?.values() ?? [])][0];
      if (!program?.program) throw Error('Centre shader was not compiled');
      const shaders = context.getAttachedShaders(program.program)!;
      const fragment = context.getShaderSource(shaders.find(s => context.getShaderParameter(s, context.SHADER_TYPE) === context.FRAGMENT_SHADER)!)!;
      return {
        name: group.name, group: group.uuid,
        position: await hash(mesh.geometry.getAttribute('position').array),
        normal: await hash(mesh.geometry.getAttribute('normal').array),
        index: await hash(mesh.geometry.index!.array),
        vertices: mesh.geometry.getAttribute('position').count,
        material: mesh.material.type,
        analytic: fragment.includes('pieceAnalyticRimNormal'),
        hybrid: fragment.includes('plasticWindowVisibility'),
        linked: Boolean(context.getProgramParameter(program.program, context.LINK_STATUS)),
        compiled: shaders.every(s => context.getShaderParameter(s, context.COMPILE_STATUS)),
        error: context.getError(),
      };
    }));
  });
}

async function expectProfile(page: Page, tier: keyof typeof PIECE_DETAIL) {
  const geometry = buildStickerlessChamferGeometry(PIECE_DETAIL[tier]);
  const hash = (a: ArrayBufferView) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
  const expected = {
    position: hash(geometry.getAttribute('position').array), normal: hash(geometry.getAttribute('normal').array), index: hash(geometry.index!.array),
    vertices: geometry.getAttribute('position').count, material: 'MeshPhysicalMaterial',
    analytic: tier !== 'low', hybrid: true, linked: true, compiled: true, error: 0,
  };
  geometry.dispose();
  await expect.poll(async () => (await centres(page)).map(({ name: _name, group: _group, ...profile }) => profile)).toEqual(Array.from({ length: 6 }, () => expected));
  return centres(page);
}

async function setQuality(page: Page, name: 'Auto' | 'High' | 'Low') {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('dialog').getByRole('radio', { name, exact: true }).check();
  await page.keyboard.press('Escape');
}

async function appearance(page: Page) {
  await scene(page);
  return page.evaluate(() => {
    const { state: s } = window.__CENTRE_QUALITY_TEST__;
    const lights: unknown[] = [];
    s.scene.traverseVisible(o => {
      const light = o as import('three').Light;
      if (light.isLight) lights.push({ type: light.type, color: light.color.toArray(), intensity: light.intensity, position: light.position.toArray() });
    });
    const materials = s.scene.getObjectByName('cube')!.children.filter(g => g.name.startsWith('cubie-')).map(group => {
      const material = (group.children.find(o => (o as Mesh).isMesh) as Mesh).material as import('three').MeshPhysicalMaterial;
      return { type: material.type, roughness: material.roughness, clearcoat: material.clearcoat, coatRoughness: material.clearcoatRoughness, specular: material.specularIntensity, ior: material.ior, envIntensity: material.envMapIntensity };
    });
    const mesh = s.scene.getObjectByName('cubie-U')!.children.find(o => (o as Mesh).isMesh) as Mesh;
    const material = mesh.material as import('three').MeshPhysicalMaterial;
    const properties = s.gl.properties.get(material) as { uniforms: Record<string, { value: import('three').Texture }> };
    const diffuse = properties.uniforms.uPlasticDiffuseEnvironment.value;
    const image = material.envMap?.image as { width: number; height: number } | undefined;
    return { lights, materials, specular: material.envMap?.uuid, diffuse: diffuse?.uuid, width: image?.width, height: image?.height };
  });
}

async function decline(page: Page) {
  await scene(page);
  await page.evaluate(() => {
    const callback = window.__CENTRE_QUALITY_TEST__.decline;
    if (!callback) throw Error('Auto PerformanceMonitor is not mounted');
    callback();
  });
}

async function observeDecline(page: Page) {
  await scene(page);
  const watcher = await page.evaluateHandle(() => {
    const { state: s } = window.__CENTRE_QUALITY_TEST__, render = s.gl.render;
    const frames: Array<{ material: string; specular: boolean; diffuse: boolean }> = [];
    s.gl.render = function (scene, camera) {
      const visible = scene === s.scene && this.getRenderTarget() === null;
      render.call(this, scene, camera);
      if (visible) {
        const mesh = scene.getObjectByName('cubie-U')!.children.find(o => (o as Mesh).isMesh) as Mesh;
        const material = mesh.material as import('three').MeshPhysicalMaterial;
        const properties = this.properties.get(material) as { uniforms?: Record<string, { value: unknown }> };
        frames.push({ material: material.type, specular: !!material.envMap, diffuse: !!properties.uniforms?.uPlasticDiffuseEnvironment?.value });
      }
    };
    return { stop() { s.gl.render = render; return frames; } };
  });
  try {
    await decline(page);
    await page.waitForFunction(() => {
      const mesh = window.__CENTRE_QUALITY_TEST__.state.scene.getObjectByName('cubie-U')!.children.find(o => (o as Mesh).isMesh) as Mesh;
      return mesh.geometry.getAttribute('position').count === 3074;
    });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const frames = await watcher.evaluate(w => w.stop());
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(f => f.material === 'MeshPhysicalMaterial' && f.specular && f.diffuse)).toBe(true);
  } finally { await watcher.evaluate(w => w.stop()); await watcher.dispose(); }
}

async function interact(page: Page) {
  const canvas = await page.locator('.stage__canvas canvas').boundingBox();
  const x = canvas!.x + canvas!.width / 2, y = canvas!.y + canvas!.height - 25;
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + (i % 2 ? 140 : -140), y - 110, { steps: 16 });
    await page.mouse.up();
  }
  for (const key of ['r', 'u', 'f', 'm', 'x', 'y']) await page.keyboard.press(key);
  await expectRenderMatchesModel(page);
  const running = await page.evaluate(() => window.__CUBELAB__.timer().phase === 'running');
  await page.getByRole('button', { name: /New Scramble/ }).click();
  if (running) await page.getByRole('button', { name: 'Discard & scramble', exact: true }).click();
  await page.waitForFunction(() => window.__CUBELAB__.timer().phase === 'ready', null, { timeout: 30_000 });
  await expectRenderMatchesModel(page);
}

test('Auto decline and explicit Low retain six chamfer centres during orbit, turns and scrambles', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await openStudio(page, { settings: { cubeStyle: 'stickerless', finish: 'gloss', quality: 'auto', sound: false } });
  const initial = await expectProfile(page, 'high');
  await observeDecline(page);
  const low = await expectProfile(page, 'low');
  expect(low.map(g => g.group)).toEqual(initial.map(g => g.group));
  const lowLook = await appearance(page);
  expect(lowLook.width).toBe(384); expect(lowLook.height).toBe(512);
  expect(lowLook.diffuse).toBeTruthy();
  expect(lowLook.lights).toHaveLength(1);
  await interact(page); await expectProfile(page, 'low');
  expect(await appearance(page)).toEqual(lowLook);
  await setQuality(page, 'High'); await expectProfile(page, 'high');
  const highLook = await appearance(page);
  expect(highLook.lights).toEqual(lowLook.lights);
  expect(highLook.materials).toEqual(lowLook.materials);
  await interact(page); await expectProfile(page, 'high');
  expect(await appearance(page)).toEqual(highLook);
  await setQuality(page, 'Low'); await expectProfile(page, 'low');
  await setQuality(page, 'High'); await expectProfile(page, 'high');
  await waitIdle(page); await page.waitForTimeout(1200);
  const before = await page.evaluate(() => window.__CUBELAB__.renderInfo!());
  for (let i = 0; i < 6; i++) {
    await setQuality(page, 'Low'); await expectProfile(page, 'low');
    await setQuality(page, 'High'); await expectProfile(page, 'high');
  }
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => window.__CUBELAB__.renderInfo!());
  await test.info().attach('quality-resource-counts', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
  expect(after.geometries).toBeLessThanOrEqual(before.geometries + 2);
  expect(after.textures).toBeLessThanOrEqual(before.textures + 2);
  expect(after.programs).toBeLessThanOrEqual(before.programs);
  await expectRenderMatchesModel(page);
  expect(errors()).toEqual([]);
});

test('High -> Medium Auto -> Low -> High keeps the profile and existing tier shaders', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, hasTouch: true });
  try {
    const page = await context.newPage(), errors = trackErrors(page);
    await openStudio(page, { settings: { cubeStyle: 'stickerless', finish: 'gloss', quality: 'high', sound: false } });
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const initial = await expectProfile(page, 'high');
    await setQuality(page, 'Auto'); const medium = await expectProfile(page, 'medium');
    expect(medium.map(g => g.group)).toEqual(initial.map(g => g.group));
    await page.keyboard.press('r'); await decline(page); await expectProfile(page, 'low');
    await waitIdle(page); await setQuality(page, 'High'); await expectProfile(page, 'high');
    await expectRenderMatchesModel(page);
    expect(errors()).toEqual([]);
  } finally { await context.close(); }
});
