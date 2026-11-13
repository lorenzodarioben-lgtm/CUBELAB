import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { absorbEmulatedTap, debug, expectRenderMatchesModel, openStudio, touchDrag, trackErrors } from './helpers';

type Contact = { x:number; y:number; id:number };
const settle = (page: Page) => page.waitForTimeout(650);
const frames = (page: Page) => page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
const send = (cdp: CDPSession, type:'touchStart'|'touchEnd'|'touchMove'|'touchCancel', points:Contact[]) => cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
const pair = (x:number,y:number,gap=90): Contact[] => [{x:x-gap/2,y,id:1},{x:x+gap/2,y,id:2}];
async function dragPair(cdp: CDPSession, page: Page, start:Contact[], dx:number,dy:number,gapChange=0, noise=false) {
  await send(cdp,'touchStart',start);
  for(let i=1;i<=10;i++) {
    const t=i/10;
    const points=start.map((p,j)=>({...p,x:p.x+dx*t+(j===0?-1:1)*gapChange*t/2+(noise&&j===1?(i%3-1):0),y:p.y+dy*t}));
    if(noise) {
      // Real sequential updates straddling a rendered frame, not one atomic
      // synthetic event. Small separation errors must not move the camera.
      await send(cdp,'touchMove',[points[0]!,{...start[1]!,x:start[1]!.x+dx*(i-1)/10,y:start[1]!.y+dy*(i-1)/10}]);
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
    }
    await send(cdp,'touchMove',points); await frames(page);
  }
  await send(cdp,'touchEnd',[]); await settle(page);
}
function angle(a:Awaited<ReturnType<typeof debug.camera>>,b:Awaited<ReturnType<typeof debug.camera>>) {
  const direction=(p:typeof a)=>[Math.sin(p.polar)*Math.sin(p.azimuth),Math.cos(p.polar),Math.sin(p.polar)*Math.cos(p.azimuth)];
  const x=direction(a),y=direction(b);
  return Math.acos(Math.max(-1,Math.min(1,x.reduce((s,v,i)=>s+v*y[i]!,0))));
}
async function reset(page:Page) {
  await absorbEmulatedTap(page);
  await page.getByRole('button',{name:'Reset camera (C)',exact:true}).click(); await settle(page);
}
declare global { interface Window { precisionDistances:number[]; precisionTrace:boolean } }
async function trace(page:Page) {
  await page.evaluate(()=>{
    window.precisionDistances=[]; window.precisionTrace=true;
    const frame=()=>{if(!window.precisionTrace)return;window.precisionDistances.push(window.__CUBELAB__.cameraMetrics!().distance);requestAnimationFrame(frame);};
    requestAnimationFrame(frame);
  });
}
async function stable(page:Page, distance:number) {
  const samples=await page.evaluate(()=>{window.precisionTrace=false;return window.precisionDistances;});
  expect(samples.length).toBeGreaterThan(5);
  expect(Math.max(...samples.map(d=>Math.abs(d-distance)))).toBeLessThan(1e-7);
}

for(const [width,height,cubeStyle] of [[320,568,'stickered'],[390,844,'stickerless']] as const) {
  test(`${width}px ${cubeStyle}: precision, sequential noise, pinch and mixed gestures`,async({browser,baseURL})=>{
    test.setTimeout(120_000);
    const context=await browser.newContext({baseURL,viewport:{width,height},hasTouch:true});
    try {
      const page=await context.newPage(),errors=trackErrors(page),cdp=await context.newCDPSession(page);
      await openStudio(page,{settings:{cubeStyle,sound:false,orbitSensitivity:1.6}});
      await page.waitForFunction(()=>window.__CUBELAB__?.cameraMetrics&&!window.__CUBELAB__.lookPending?.());
      const centre=await debug.project(page,[0,0,0]),start=pair(centre.x,centre.y),home=await debug.camera(page);
      const distance=await page.evaluate(()=>window.__CUBELAB__.cameraMetrics!().distance);
      await page.getByRole('radio',{name:'Orbit',exact:true}).check();
      await touchDrag(cdp,centre,{x:centre.x+40,y:centre.y});await settle(page);
      const normal=angle(home,await debug.camera(page));expect(normal).toBeGreaterThan(.1);
      await reset(page);await page.getByRole('radio',{name:'Twist',exact:true}).check();
      await trace(page);await dragPair(cdp,page,start,40,0);
      const precise=angle(home,await debug.camera(page));expect(precise/normal).toBeCloseTo(.4,2);
      await stable(page,distance);expect(await debug.version(page)).toBe(0);
      await reset(page);await trace(page);await dragPair(cdp,page,start,20,12,0,true);
      await stable(page,distance);expect((await debug.camera(page)).zoom).toBe(1);
      await reset(page);await page.getByRole('radio',{name:'Orbit',exact:true}).check();
      await trace(page);await dragPair(cdp,page,start,0,35);
      expect(angle(home,await debug.camera(page))).toBeGreaterThan(.05);await stable(page,distance);
      await reset(page);await dragPair(cdp,page,start,0,0,30);
      const spread=await debug.camera(page);expect(spread.zoom).toBeLessThan(1);expect(angle(home,spread)).toBeLessThan(.001);
      await absorbEmulatedTap(page);await dragPair(cdp,page,pair(centre.x,centre.y,120),0,0,-30);
      expect((await debug.camera(page)).zoom).toBeGreaterThan(spread.zoom);
      await reset(page);await dragPair(cdp,page,start,20,12,25);
      const mixed=await debug.camera(page);expect(mixed.zoom).toBeLessThan(1);expect(angle(home,mixed)).toBeGreaterThan(.03);
      expect(await debug.version(page)).toBe(0);
      // Third contact is ignored; lifting either active finger ends the pair.
      await reset(page);await send(cdp,'touchStart',start);
      const third={x:centre.x,y:centre.y+55,id:3};await send(cdp,'touchStart',[...start,third]);
      await send(cdp,'touchMove',[...start,{...third,x:third.x+20}]);await frames(page);
      await send(cdp,'touchEnd',[{...third,x:third.x+20}]);await frames(page);
      await send(cdp,'touchMove',start.map(p=>({...p,y:p.y+15})));await frames(page);await settle(page);
      expect(angle(home,await debug.camera(page))).toBeGreaterThan(.02);
      await send(cdp,'touchEnd',[{...start[0]!,y:start[0]!.y+15}]);await settle(page);
      const released=await debug.camera(page);
      await send(cdp,'touchMove',[{...start[1]!,x:start[1]!.x+30,y:start[1]!.y+35}]);await frames(page);await settle(page);
      expect(await debug.camera(page)).toEqual(released);await send(cdp,'touchEnd',[]);
      expect(await debug.version(page)).toBe(0);
      // The same control remains usable across a real viewport resize.
      await page.setViewportSize({width:844,height:390});await settle(page);await reset(page);
      const land=await debug.project(page,[0,0,0]),landPose=await debug.camera(page);
      await dragPair(cdp,page,pair(land.x,land.y),20,0);
      expect(angle(landPose,await debug.camera(page))).toBeGreaterThan(.02);
      expect((await debug.camera(page)).zoom).toBe(1);expect(await debug.version(page)).toBe(0);
      expect(errors()).toEqual([]);
    } finally {await context.close();}
  });
}

test('second finger cancels a twist; cancel/capture loss leave fresh touches usable',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844},hasTouch:true});
  try {
    const page=await context.newPage(),errors=trackErrors(page),cdp=await context.newCDPSession(page);
    await openStudio(page,{settings:{cubeStyle:'stickerless',sound:false}});
    await page.waitForFunction(()=>window.__CUBELAB__?.cameraMetrics&&!window.__CUBELAB__.lookPending?.());
    const a=await debug.project(page,[1,0,1.5]),b=await debug.project(page,[-1,0,1.5]);
    await send(cdp,'touchStart',[{...a,id:1}]);
    const moved={x:a.x,y:a.y-35,id:1};await send(cdp,'touchMove',[moved]);
    await page.waitForFunction(()=>!!window.__CUBELAB__.visualTurn?.());
    await send(cdp,'touchStart',[moved,{...b,id:2}]);
    await send(cdp,'touchMove',[{...moved,x:moved.x+15},{...b,x:b.x+15,id:2}]);await frames(page);
    await send(cdp,'touchEnd',[]);await expectRenderMatchesModel(page);
    expect(await debug.version(page)).toBe(0);expect(await debug.moveLog(page)).toBe('');expect(await debug.historyCount(page)).toBe(0);
    await reset(page);const centre=await debug.project(page,[0,0,0]),contacts=pair(centre.x,centre.y);
    await send(cdp,'touchStart',contacts);await send(cdp,'touchCancel',[]);await settle(page);
    await page.locator('.stage__canvas canvas').evaluate(el=>{
      el.addEventListener('pointerdown',e=>{(el as HTMLElement).dataset.pointer=String((e as PointerEvent).pointerId);});
    });
    await send(cdp,'touchStart',contacts);
    // Establish actual capture before releasing it; releasing a merely pending
    // capture on pointerdown does not generate lostpointercapture in Chromium.
    await send(cdp,'touchMove',contacts.map(p=>({...p,y:p.y+1})));await frames(page);await settle(page);
    await page.locator('.stage__canvas canvas').evaluate(el=>el.releasePointerCapture(Number((el as HTMLElement).dataset.pointer)));
    await frames(page);const before=await debug.camera(page);
    await send(cdp,'touchMove',contacts.map(p=>({...p,x:p.x+25})));await frames(page);await settle(page);
    expect(await debug.camera(page)).toEqual(before);await send(cdp,'touchEnd',[]);
    await touchDrag(cdp,await debug.project(page,[1,0,1.5]),await debug.project(page,[1,1.2,1.5]));
    await expectRenderMatchesModel(page);expect(await debug.version(page)).toBe(1);expect(await debug.moveLog(page)).toBe('R');
    expect(errors()).toEqual([]);
  } finally {await context.close();}
});

test('desktop mouse orbit and reset retain normal behavior; Help describes precision',async({page})=>{
  const errors=trackErrors(page);await page.setViewportSize({width:1440,height:900});
  await openStudio(page,{settings:{sound:false}});
  const p=await debug.project(page,[1,0,1.5]),home=await debug.camera(page);
  await page.mouse.move(p.x,p.y);await page.mouse.down({button:'right'});
  await page.mouse.move(p.x+40,p.y,{steps:10});await page.mouse.up({button:'right'});await settle(page);
  expect(angle(home,await debug.camera(page))).toBeGreaterThan(.1);expect(await debug.version(page)).toBe(0);
  await page.keyboard.press('c');await settle(page);expect(angle(home,await debug.camera(page))).toBeLessThan(.001);
  await page.getByRole('button',{name:'Help & shortcuts (?)',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Two-finger drag — precision orbit. Pinch — zoom.');
  expect(errors()).toEqual([]);
});
