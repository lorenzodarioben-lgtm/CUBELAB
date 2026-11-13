import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { absorbEmulatedTap, debug, expectRenderMatchesModel, openStudio, SOLVED, touchDrag, trackErrors, waitIdle } from './helpers';

type Sample = { distance: number; width: number; height: number; status: string; turn: boolean };
declare global {
  interface Window { cameraSamples: Sample[]; stopCameraSampling: boolean }
}
async function sample(page: Page) {
  await page.evaluate(() => {
    window.cameraSamples = []; window.stopCameraSampling = false;
    const frame = () => {
      if (window.stopCameraSampling) return;
      window.cameraSamples.push({ ...window.__CUBELAB__.cameraMetrics!(), status: window.__CUBELAB__.solver().status, turn: !!window.__CUBELAB__.visualTurn?.() });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
async function expectStable(page: Page, distance: number) {
  const samples = await page.evaluate(() => { window.stopCameraSampling = true; return window.cameraSamples; });
  expect(samples.length).toBeGreaterThan(20);
  expect(new Set(samples.map(s=>`${s.width}x${s.height}`)).size).toBe(1);
  expect(Math.max(...samples.map(s=>Math.abs(s.distance-distance)))).toBeLessThan(1e-7);
  return samples;
}
async function bounds(page: Page) {
  const layout = await page.evaluate(() => {
    const r = document.querySelector('.stage__canvas')!.getBoundingClientRect();
    const points = [-1.511,1.511].flatMap(x=>[-1.511,1.511].flatMap(y=>[-1.511,1.511].map(z=>window.__CUBELAB__.project!([x,y,z]))));
    return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, points };
  });
  for (const p of layout.points) {
    expect(p.x).toBeGreaterThanOrEqual(layout.left+3); expect(p.x).toBeLessThanOrEqual(layout.right-3);
    expect(p.y).toBeGreaterThanOrEqual(layout.top+3); expect(p.y).toBeLessThanOrEqual(layout.bottom-3);
  }
  return Math.max(...layout.points.map(p=>p.x))-Math.min(...layout.points.map(p=>p.x));
}

for (const width of [320,390]) for (const cubeStyle of ['stickered','stickerless']) {
  test(`${width}px ${cubeStyle}: fixed physical camera through scramble, playback, twists and orbit`, async ({browser,baseURL}) => {
    test.setTimeout(100_000);
    const height = width === 320 ? 568 : 844;
    const context = await browser.newContext({baseURL,viewport:{width,height},hasTouch:true});
    try {
      const page = await context.newPage(), errors = trackErrors(page);
      await openStudio(page,{settings:{cubeStyle,sound:false,scrambleStyle:'animate',playbackSpeed:'fast'},path:'/?scramble=R%20U%20F'});
      await page.waitForFunction(()=>window.__CUBELAB__?.cameraMetrics && !window.__CUBELAB__.lookPending?.());
      await waitIdle(page); await page.waitForTimeout(250);
      const home = await page.evaluate(()=>window.__CUBELAB__.cameraMetrics!());
      expect(await bounds(page)).toBeGreaterThan(width === 320 ? 210 : 310);
      // Deliberate pinch out changes the *physical* distance, then survives all
      // scramble/playback operations. The engine cannot secretly reset it.
      const cdp = await context.newCDPSession(page), centre = await debug.project(page,[0,0,0]);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:centre.x-60,y:centre.y,id:1},{x:centre.x+60,y:centre.y,id:2}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:centre.x-45,y:centre.y,id:1},{x:centre.x+45,y:centre.y,id:2}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(800); await absorbEmulatedTap(page);
      const zoom = (await debug.camera(page)).zoom;
      expect(zoom).toBeGreaterThan(1);
      const zoomed = await page.evaluate(()=>window.__CUBELAB__.cameraMetrics!().distance);
      expect(zoomed).toBeCloseTo(home.distance*zoom,7);
      await sample(page);
      await page.getByRole('button',{name:'New Scramble',exact:true}).click();
      await page.waitForFunction(()=>window.__CUBELAB__.timer().phase==='ready');
      await page.getByRole('button',{name:'Auto Solve',exact:true}).click();
      await page.waitForFunction(()=>window.__CUBELAB__.solver().status==='playing' && window.__CUBELAB__.solver().cursor>=2);
      await page.getByRole('button',{name:'Pause (P)',exact:true}).click(); await waitIdle(page);
      await page.getByRole('button',{name:'Details',exact:true}).click();
      const sheet = page.getByRole('dialog',{name:'Solution details'});
      const cursor = (await debug.solver(page)).cursor;
      await sheet.getByRole('button',{name:'Step back (,)',exact:true}).click(); await waitIdle(page);
      expect((await debug.solver(page)).cursor).toBe(cursor-1);
      await sheet.getByRole('button',{name:'Step forward (.)',exact:true}).click(); await waitIdle(page);
      expect((await debug.solver(page)).cursor).toBe(cursor);
      await sheet.getByRole('button',{name:'Play (P)',exact:true}).click();
      await sheet.getByRole('button',{name:'Close',exact:true}).click();
      await page.waitForFunction(()=>window.__CUBELAB__.solver().status==='done');
      expect(await expectRenderMatchesModel(page)).toBe(SOLVED);
      const frames = await expectStable(page,zoomed);
      expect(frames.filter(s=>s.turn && s.status==='idle').length).toBeGreaterThan(20);
      expect(frames.filter(s=>s.turn && s.status==='playing').length).toBeGreaterThan(20);
      expect((await debug.camera(page)).zoom).toBe(zoom);
      await page.getByRole('button',{name:'Close solution',exact:true}).click();
      await page.getByRole('button',{name:'Reset camera (C)',exact:true}).click(); await page.waitForTimeout(800);
      expect((await debug.camera(page)).zoom).toBe(1);
      expect(await page.evaluate(()=>window.__CUBELAB__.cameraMetrics!().distance)).toBeCloseTo(home.distance,8);
      await sample(page);
      await touchDrag(cdp,await debug.project(page,[1,0,1.5]),await debug.project(page,[1,1.1,1.5]));
      await expectRenderMatchesModel(page); expect(await debug.solved(page)).toBe(false);
      await absorbEmulatedTap(page);
      await page.getByRole('radio',{name:'Orbit',exact:true}).check();
      for (const [dx,dy] of [[70,35],[-110,-60],[85,70]]) {
        await touchDrag(cdp,centre,{x:centre.x+dx!,y:centre.y+dy!});
        await page.waitForTimeout(450); await bounds(page);
      }
      await expectStable(page,home.distance);
      await absorbEmulatedTap(page);
      const pose = await debug.camera(page);
      await page.setViewportSize({width:844,height:390}); await page.waitForTimeout(450);
      await bounds(page);
      expect(await page.evaluate(()=>window.__CUBELAB__.cameraMetrics!().distance)).not.toBeCloseTo(home.distance,3);
      expect((await debug.camera(page)).zoom).toBe(pose.zoom);
      await page.setViewportSize({width,height}); await page.waitForTimeout(450);
      expect(await page.evaluate(()=>window.__CUBELAB__.cameraMetrics!().distance)).toBeCloseTo(home.distance,8);
      await page.getByRole('button',{name:'Reset camera (C)',exact:true}).click(); await page.waitForTimeout(700);
      await bounds(page); expect((await debug.camera(page)).polar).toBeCloseTo(1,4);
      expect(errors()).toEqual([]);
    } finally { await context.close(); }
  });
}
