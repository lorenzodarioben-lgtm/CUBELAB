import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { absorbEmulatedTap, debug, expectRenderMatchesModel, openStudio, trackErrors } from './helpers';

type Contact={x:number;y:number;id:number};
type Point={x:number;y:number};
const radians=(degrees:number)=>degrees*Math.PI/180;
const frames=(page:Page)=>page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
const settle=(page:Page)=>page.waitForTimeout(700);
const send=(cdp:CDPSession,type:'touchStart'|'touchMove'|'touchEnd',points:Contact[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
function contacts(centre:Point,angle:number,span=100):Contact[] {
  return [-1,1].map((sign,i)=>({x:centre.x+sign*span/2*Math.cos(angle),y:centre.y+sign*span/2*Math.sin(angle),id:i+1}));
}
async function move(cdp:CDPSession,page:Page,centre:Point,from:number,to:number,span=100) {
  for(let i=1;i<=10;i++) {
    await send(cdp,'touchMove',contacts(centre,from+(to-from)*i/10,span)); await frames(page);
  }
  await settle(page);
}
async function projection(page:Page) {
  return page.evaluate(()=>{
    const api=window.__CUBELAB__,centre=api.project!([0,0,0]);
    const points:[number,number,number][]=[[1.5,1.5,1.5],[-1.5,1.5,1.5],[1.5,-1.5,1.5],[-1.5,-1.5,-1.5]];
    return points.map(p=>{const v=api.project!(p);return {x:v.x-centre.x,y:v.y-centre.y};});
  });
}
function expectVisibleRoll(before:Point[],after:Point[],angle:number,tolerance=1) {
  before.forEach((p,i)=>{
    expect(Math.abs(after[i]!.x-(p.x*Math.cos(angle)-p.y*Math.sin(angle)))).toBeLessThan(tolerance);
    expect(Math.abs(after[i]!.y-(p.x*Math.sin(angle)+p.y*Math.cos(angle)))).toBeLessThan(tolerance);
  });
}

for(const [width,height,cubeStyle] of [[320,568,'stickered'],[390,844,'stickerless']] as const) {
  test(`${width}px ${cubeStyle}: double-sensitivity visible roll, reversal, precision, angle wrapping and combined manipulation`,async({browser,baseURL})=>{
    test.setTimeout(120_000);
    const context=await browser.newContext({baseURL,viewport:{width,height},hasTouch:true});
    try {
      const page=await context.newPage(),errors=trackErrors(page),cdp=await context.newCDPSession(page);
      await openStudio(page,{settings:{cubeStyle,sound:false}});
      await page.waitForFunction(()=>window.__CUBELAB__?.cameraMetrics&&!window.__CUBELAB__.lookPending?.());
      const centre=await debug.project(page,[0,0,0]),home=await debug.camera(page),initial=await projection(page);
      const distance=await page.evaluate(()=>window.__CUBELAB__.cameraMetrics!().distance);
      await send(cdp,'touchStart',contacts(centre,0));
      await move(cdp,page,centre,0,Math.PI/2);
      expectVisibleRoll(initial,await projection(page),Math.PI);
      const rolled=await debug.camera(page);
      expect(rolled.azimuth).toBeCloseTo(home.azimuth,4);expect(rolled.polar).toBeCloseTo(home.polar,4);expect(rolled.zoom).toBe(1);
      expect(await page.evaluate(()=>window.__CUBELAB__.cameraMetrics!().distance)).toBe(distance);
      await move(cdp,page,centre,Math.PI/2,0);
      expectVisibleRoll(initial,await projection(page),0);
      await move(cdp,page,centre,0,radians(2));
      expectVisibleRoll(initial,await projection(page),radians(4),1);
      // A 170° -> 190° move crosses atan2's branch cut while the displayed
      // object continues clockwise by 40°, with constant radius and distance.
      await move(cdp,page,centre,radians(2),radians(170));
      const at170=await projection(page);
      expectVisibleRoll(initial,at170,radians(340));
      await move(cdp,page,centre,radians(170),radians(190));
      expectVisibleRoll(at170,await projection(page),radians(40));
      await move(cdp,page,centre,radians(190),Math.PI*2);
      expectVisibleRoll(initial,await projection(page),0);
      expect((await debug.camera(page)).zoom).toBe(1);
      // Keep the same contacts down: translate, roll and spread together.
      const target={x:centre.x+15,y:centre.y+10};
      for(let i=1;i<=10;i++) {
        const t=i/10;
        await send(cdp,'touchMove',contacts({x:centre.x+15*t,y:centre.y+10*t},Math.PI*2+radians(60)*t,100+20*t));await frames(page);
      }
      await settle(page);
      const tilted=await projection(page),tiltedPose=await debug.camera(page);
      expect(tiltedPose.zoom).toBeLessThan(1);
      const forwardDot=Math.cos(tiltedPose.polar)*Math.cos(home.polar)+Math.sin(tiltedPose.polar)*Math.sin(home.polar)*Math.cos(tiltedPose.azimuth-home.azimuth);
      expect(Math.acos(Math.max(-1,Math.min(1,forwardDot)))).toBeGreaterThan(.03);
      // The doubled roll gain remains screen-facing after arbitrary tilt.
      await move(cdp,page,target,radians(60),radians(150),120);
      expectVisibleRoll(tilted,await projection(page),Math.PI,1.5);
      expect((await debug.camera(page)).zoom).toBeCloseTo(tiltedPose.zoom,6);
      const retained=await projection(page);
      // CDP partial touchEnd lists the contacts being released.
      await send(cdp,'touchEnd',[contacts(target,radians(150),120)[0]!]);await settle(page);
      await send(cdp,'touchMove',[{...contacts(target,radians(150),120)[1]!,x:target.x+40,y:target.y+25}]);await frames(page);await settle(page);
      expectVisibleRoll(retained,await projection(page),0,.1);
      await send(cdp,'touchEnd',[]);
      expect(await debug.version(page)).toBe(0);expect(await debug.moveLog(page)).toBe('');expect(await debug.historyCount(page)).toBe(0);
      await expectRenderMatchesModel(page);
      await absorbEmulatedTap(page);await page.getByRole('button',{name:'Reset camera (C)',exact:true}).click();await settle(page);
      expectVisibleRoll(initial,await projection(page),0,.1);
      await page.setViewportSize({width:844,height:390});await settle(page);
      const landCentre=await debug.project(page,[0,0,0]),land=await projection(page);
      await send(cdp,'touchStart',contacts(landCentre,0));await move(cdp,page,landCentre,0,-Math.PI/2);await send(cdp,'touchEnd',[]);
      expectVisibleRoll(land,await projection(page),-Math.PI);
      expect(await debug.version(page)).toBe(0);expect(errors()).toEqual([]);
    } finally {await context.close();}
  });
}
