import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { OrbitRig } from '../../src/components/stage/orbitRig';
import { TwoFingerMotion } from '../../src/components/stage/twoFingerMotion';

const point = (angle:number, sign:number, span=100) => ({ x:sign*span/2*Math.cos(angle), y:sign*span/2*Math.sin(angle) });
function move(motion:TwoFingerMotion,angle:number,span=100) {
  motion.move(0,point(angle,-1,span)); motion.move(1,point(angle,1,span));
  return motion.flush()!;
}
describe('independent two-finger roll signal',()=>{
  it('reports clockwise, reverse and sub-degree roll without translation or zoom',()=>{
    const motion=new TwoFingerMotion(point(0,-1),point(0,1));
    for(const angle of [Math.PI/2,0,Math.PI/90,Math.PI/90+.001]) {
      const previous=angle===Math.PI/2?0:angle===0?Math.PI/2:angle===Math.PI/90?0:Math.PI/90;
      const delta=move(motion,angle);
      expect(delta.roll).toBeCloseTo(angle-previous,12);
      expect(delta.dx).toBe(0); expect(delta.dy).toBe(0); expect(delta.zoom).toBe(1);
    }
  });
  it('crosses ±180 degrees continuously in both directions',()=>{
    const motion=new TwoFingerMotion(point(170*Math.PI/180,-1),point(170*Math.PI/180,1));
    expect(move(motion,190*Math.PI/180).roll).toBeCloseTo(20*Math.PI/180,12);
    expect(move(motion,170*Math.PI/180).roll).toBeCloseTo(-20*Math.PI/180,12);
  });
  it('keeps small deliberate changes, accumulates full rotations and has no stationary drift',()=>{
    const motion=new TwoFingerMotion(point(0,-1),point(0,1));
    let accumulated=0;
    for(let i=1;i<=1440;i++) accumulated+=move(motion,i*Math.PI/720).roll;
    expect(accumulated).toBeCloseTo(Math.PI*2,10);
    for(let i=0;i<100;i++) expect(move(motion,Math.PI*2)).toEqual({dx:0,dy:0,roll:0,zoom:1});
  });
  it('rebases unreliable coincident contacts rather than producing an angular jump',()=>{
    const motion=new TwoFingerMotion(point(0,-1),point(0,1));
    expect(move(motion,Math.PI/2,2).roll).toBe(0);
    expect(move(motion,Math.PI,100).roll).toBe(0);
    expect(move(motion,Math.PI+.01).roll).toBeCloseTo(.01,12);
  });
  it('batches a roll split across pointer events and keeps simultaneous translation/zoom',()=>{
    const motion=new TwoFingerMotion(point(0,-1),point(0,1));
    motion.move(0,{x:10,y:-40}); expect(motion.flush()).toBeNull();
    motion.move(1,{x:10,y:80});
    const delta=motion.flush()!;
    expect(delta).toMatchObject({dx:10,dy:20,zoom:100/117});
    expect(delta.roll).toBeCloseTo(Math.PI/2,12);
  });
});

describe('visible screen-space roll',()=>{
  function project(rig:OrbitRig,p:[number,number,number]) {
    const camera=new PerspectiveCamera(27,390/523,.1,100);
    camera.position.set(...rig.cameraPosition(15)); camera.lookAt(0,0,0); camera.updateMatrixWorld();
    const v=new Vector3(...p).applyQuaternion(rig.cubeQuaternion(new Quaternion())).project(camera);
    return { x:v.x*390/2,y:-v.y*523/2 };
  }
  it.each([0,1])('rolls the actual projection clockwise at arbitrary tilt %s',tilted=>{
    const rig=new OrbitRig();
    if(tilted) {rig.rotateBy(123,-270,500);rig.rollBy(.63);}
    rig.step(0,true);
    const points:[number,number,number][]=[[1.5,1.5,1.5],[-1.5,1.5,1.5],[1.5,-1.5,1.5],[-1.5,-1.5,-1.5]];
    const before=points.map(p=>project(rig,p)),pose=rig.current,rotation=rig.cubeQuaternion(new Quaternion()).clone();
    for(const angle of [Math.PI/2,-Math.PI/2,Math.PI/90]) {
      rig.rollBy(angle);rig.step(0,true);
      points.forEach((p,i)=>{
        const after=project(rig,p),b=before[i]!;
        expect(after.x).toBeCloseTo(b.x*Math.cos(angle)-b.y*Math.sin(angle),8);
        expect(after.y).toBeCloseTo(b.x*Math.sin(angle)+b.y*Math.cos(angle),8);
      });
      expect(rig.current.azimuth).toBeCloseTo(pose.azimuth,12);
      expect(rig.current.polar).toBeCloseTo(pose.polar,12);
      expect(rig.current.zoom).toBe(1);
      rig.rollBy(-angle);rig.step(0,true);
      expect(rig.cubeQuaternion(new Quaternion()).angleTo(rotation)).toBeLessThan(1e-7);
    }
  });
  it('is independent of sample partition and retains a normalized quaternion',()=>{
    const one=new OrbitRig(),many=new OrbitRig();
    one.rollBy(Math.PI*2+.02);one.step(0,true);
    for(let i=0;i<2000;i++) many.rollBy((Math.PI*2+.02)/2000);
    many.step(0,true);
    expect(many.cubeQuaternion(new Quaternion()).length()).toBeCloseTo(1,14);
    expect(one.cubeQuaternion(new Quaternion()).angleTo(many.cubeQuaternion(new Quaternion()))).toBeLessThan(1e-7);
  });
});
