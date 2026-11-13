import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { absorbEmulatedTap, debug, expectRenderMatchesModel, openStudio, SOLVED, touchDrag, trackErrors, waitIdle } from './helpers';

const sizes = [[320,568],[360,740],[390,844],[430,932],[844,390],[768,1024]] as const;
async function ready(page: Page) { await page.waitForFunction(() => window.__CUBELAB__?.project && !window.__CUBELAB__.lookPending?.()); await waitIdle(page); }
async function tools(page: Page, tab?: string) {
  await page.getByRole('button', { name: 'Cube tools', exact: true }).click();
  await page.getByRole('dialog').evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
  if (tab) await page.getByRole('dialog').getByRole('radio', { name: tab, exact: true }).check();
}
async function close(page: Page) { await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click(); }

test('compact layouts reserve the timer, cube and controls at every requested size', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  for (const [width,height] of sizes) {
    const context = await browser.newContext({ baseURL, viewport: {width,height}, hasTouch: true, deviceScaleFactor: width === 320 ? 3 : 1 });
    try {
      const page = await context.newPage(), errors = trackErrors(page);
      await openStudio(page, { settings: { cubeStyle: 'stickerless' } }); await ready(page);
      const layout = await page.evaluate(() => {
        const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; };
        const points = [-1.5,1.5].flatMap(x => [-1.5,1.5].flatMap(y => [-1.5,1.5].map(z => window.__CUBELAB__.project!([x,y,z]))));
        return { timer:box('.panel-timer'), canvas:box('.stage__canvas'), header:box('.topbar'), dock:box('.panel-actions'), tools:box('.stage__tools'), points, overflow:document.documentElement.scrollWidth-innerWidth };
      });
      expect(layout.overflow, `${width}x${height}`).toBe(0);
      const {timer,canvas,header,dock} = layout;
      expect(timer.bottom <= canvas.top + 1 || timer.right <= canvas.left + 1).toBe(true);
      expect(canvas.top).toBeGreaterThanOrEqual(header.bottom);
      expect(canvas.bottom).toBeLessThanOrEqual(layout.tools.top + 1);
      expect(layout.tools.bottom).toBeLessThanOrEqual(dock.top + 1);
      expect(dock.bottom).toBeLessThanOrEqual(height + 1);
      for (const p of layout.points) {
        expect(p.x).toBeGreaterThanOrEqual(canvas.left); expect(p.x).toBeLessThanOrEqual(canvas.right);
        expect(p.y).toBeGreaterThanOrEqual(canvas.top); expect(p.y).toBeLessThanOrEqual(canvas.bottom);
      }
      if (width <= 430) {
        const cubeWidth = Math.max(...layout.points.map(p=>p.x))-Math.min(...layout.points.map(p=>p.x));
        // Fixed rotation-safe clearance replaces the old orientation-dependent peak fit.
        expect(cubeWidth).toBeGreaterThan(width === 320 ? 210 : width * .8);
      }
      await page.screenshot({path:`artifacts/mobile-v21/after/${width}-normal.png`});
      for (const selector of ['.topbar .icon-btn','.panel-actions button','.stage__camera']) {
        for (const el of await page.locator(selector).all()) if (await el.isVisible()) {
          const r = (await el.boundingBox())!; expect(r.width).toBeGreaterThanOrEqual(44); expect(r.height).toBeGreaterThanOrEqual(44);
        }
      }
      await tools(page);
      await expect(page.getByRole('button', { name: /^R: turn red face/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBe(0);
      const surface = (await page.locator('.mobile-tools .dialog__surface').boundingBox())!;
      expect(surface.x).toBeGreaterThanOrEqual(0); expect(surface.x+surface.width).toBeLessThanOrEqual(width+1);
      expect(surface.height).toBeLessThanOrEqual(height);
      if (width <= 640) expect(surface.y+surface.height).toBeCloseTo(height, 0);
      // Modal keyboard input must never trigger global cube shortcuts.
      const before = await debug.version(page); await page.keyboard.press('r'); expect(await debug.version(page)).toBe(before);
      await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeHidden();
      if (width === 320) {
        const ratio = await page.locator('.stage__canvas canvas').evaluate((el) => (el as HTMLCanvasElement).width / el.getBoundingClientRect().width);
        expect(ratio).toBe(1.5);
        for (const name of ['Settings','Help & shortcuts (?)']) {
          await page.getByRole('button',{name,exact:true}).click();
          const body = page.locator('dialog[open] .dialog__body');
          expect(await body.evaluate(el=>el.scrollWidth-el.clientWidth)).toBe(0);
          await close(page);
        }
      }
      expect(errors()).toEqual([]);
    } finally { await context.close(); }
  }
});

test('mobile touch gestures, on-demand moves, persistence, style switches and solve flow', async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({baseURL,viewport:{width:390,height:844},hasTouch:true});
  try {
    const page = await context.newPage(), errors = trackErrors(page);
    await openStudio(page, { settings: {cubeStyle:'stickerless',scrambleStyle:'instant',playbackSpeed:'fast'} }); await ready(page);
    const cdp = await context.newCDPSession(page);
    const centre = await debug.project(page,[0,0,0]), initialZoom = (await debug.camera(page)).zoom;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:centre.x-30,y:centre.y,id:1},{x:centre.x+30,y:centre.y,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:centre.x-60,y:centre.y,id:1},{x:centre.x+60,y:centre.y,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(300); expect((await debug.camera(page)).zoom).toBeLessThan(initialZoom);
    expect(await debug.version(page)).toBe(0);
    await absorbEmulatedTap(page); await page.getByRole('button',{name:'Reset camera (C)',exact:true}).click(); await page.waitForTimeout(400);
    const cancelled = await debug.project(page,[1,0,1.5]);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...cancelled,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cancelled.x,y:cancelled.y-50,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await expectRenderMatchesModel(page); expect(await debug.version(page)).toBe(0);
    await touchDrag(cdp, await debug.project(page,[1,0,1.5]), await debug.project(page,[1,1.35,1.5]));
    await expectRenderMatchesModel(page); expect(await debug.moveLog(page)).toBe('R');
    await absorbEmulatedTap(page);
    await page.getByRole('radio',{name:'Orbit',exact:true}).check();
    const version = await debug.version(page), camera = await debug.camera(page);
    await touchDrag(cdp, await debug.project(page,[1,0,1.5]), await debug.project(page,[1,1.35,1.5]));
    await page.waitForTimeout(250); expect(await debug.version(page)).toBe(version); expect(await debug.camera(page)).not.toEqual(camera);
    await absorbEmulatedTap(page);
    await page.getByRole('button',{name:'Reset camera (C)',exact:true}).click();
    await page.getByRole('radio',{name:'Twist',exact:true}).check();
    await tools(page); await page.getByRole('button',{name:/^R': turn red face/}).click(); await close(page);
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    await tools(page); await page.getByRole('radio',{name:'Slices',exact:true}).check();
    await page.getByRole('button',{name:/^M2: turn M slice/}).click();
    await page.getByRole('radio',{name:'Rotate',exact:true}).check(); await page.getByRole('button',{name:/^x': turn the whole cube/}).click(); await close(page);
    await expectRenderMatchesModel(page);
    const state = await debug.facelets(page);
    await page.setViewportSize({width:844,height:390}); await ready(page); expect(await debug.facelets(page)).toBe(state);
    await page.setViewportSize({width:390,height:844}); await ready(page);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('radio',{name:/Classic Stickered/}).check(); await ready(page); await close(page);
    expect(await expectRenderMatchesModel(page)).toBe(state);
    await page.reload(); await ready(page); await page.waitForFunction(()=>!!window.__CUBELAB__?.project);
    expect(await expectRenderMatchesModel(page)).toBe(state);
    await page.setViewportSize({width:320,height:568}); await ready(page);
    await page.getByRole('button',{name:'New Scramble',exact:true}).click();
    await page.waitForFunction(()=>window.__CUBELAB__.timer().phase==='ready');
    await page.getByRole('button',{name:'Auto Solve',exact:true}).click();
    await page.waitForFunction(()=>window.__CUBELAB__.solver().status==='done',null,{timeout:60000});
    expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
    const playback = (await page.locator('.mobile-solution').boundingBox())!;
    const stage = (await page.locator('.studio__stage').boundingBox())!;
    expect(playback.y).toBeGreaterThanOrEqual(stage.y+stage.height);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0);
    expect(errors()).toEqual([]);
  } finally {await context.close();}
});

test('the touch timer starts inspection, arms, cancels safely and stops through the existing state machine', async ({browser,baseURL}) => {
  const context = await browser.newContext({baseURL,viewport:{width:320,height:568},hasTouch:true});
  try {
    const page = await context.newPage(), errors = trackErrors(page);
    await openStudio(page,{settings:{timerMode:'spacebar',inspection:true,scrambleStyle:'instant'}}); await ready(page);
    await page.getByRole('button',{name:'New Scramble',exact:true}).click();
    await page.waitForFunction(()=>window.__CUBELAB__.timer().phase==='ready');
    await page.getByRole('button',{name:'Begin inspection',exact:true}).tap();
    await page.waitForFunction(()=>window.__CUBELAB__.timer().phase==='inspecting');
    const cdp = await context.newCDPSession(page), r = (await page.locator('.panel-timer__clock').boundingBox())!;
    const point = {x:r.x+r.width/2,y:r.y+r.height/2,id:1};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await page.waitForTimeout(350); await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await page.waitForFunction(()=>window.__CUBELAB__.timer().phase==='inspecting');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await page.waitForTimeout(350); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>window.__CUBELAB__.timer().phase==='running');
    await page.getByRole('button',{name:'Stop timer (records DNF)',exact:true}).tap();
    await page.waitForFunction(()=>window.__CUBELAB__.timer().phase==='interrupted');
    expect(await debug.historyCount(page)).toBe(1); expect(errors()).toEqual([]);
  } finally {await context.close();}
});

test('desktop retains the three-column composition and keyboard controls', async ({page,browser,baseURL}) => {
  await page.setViewportSize({width:1440,height:900});
  await openStudio(page,{settings:{cubeStyle:'stickerless'}}); await ready(page); await page.waitForTimeout(900);
  await expect(page.locator('.studio')).toHaveCSS('position','fixed');
  await expect(page.locator('.rail--left .panel-timer')).toBeVisible();
  await expect(page.locator('.rail--right .panel-movepad')).toBeVisible();
  await expect(page.locator('.mobile-studio')).toHaveCount(0);
  await page.keyboard.press('m'); await page.keyboard.press('x'); await expectRenderMatchesModel(page);
  const touch = await browser.newContext({baseURL,viewport:{width:1440,height:900},hasTouch:true,deviceScaleFactor:3});
  try {
    const wide = await touch.newPage(); await openStudio(wide); await ready(wide);
    const ratio = await wide.locator('.stage__canvas canvas').evaluate(el => (el as HTMLCanvasElement).width/el.getBoundingClientRect().width);
    expect(ratio).toBe(1.75);
  } finally {await touch.close();}
});

test.describe('compact WebGL fallback', () => {
  test('the flat cube and on-demand Move Pad remain usable', async ({baseURL}) => {
    const fallback = await chromium.launch({args:['--disable-3d-apis','--disable-webgl']});
    const page = await fallback.newPage({baseURL,viewport:{width:320,height:568}});
    try {
    const errors = trackErrors(page);
    await page.setViewportSize({width:320,height:568}); await page.goto('/');
    await expect(page.locator('.face-net')).toBeVisible();
    await tools(page); await page.getByRole('button',{name:/^R: turn red face/}).click(); await close(page);
    await page.waitForFunction(()=>window.__CUBELAB__.idle());
    expect(await debug.solved(page)).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0);
    expect(errors()).toEqual([]);
    } finally { await fallback.close(); }
  });
});
