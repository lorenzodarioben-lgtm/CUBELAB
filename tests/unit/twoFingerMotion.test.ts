import { describe, expect, it } from 'vitest';
import { Quaternion } from 'three';
import { OrbitRig } from '../../src/components/stage/orbitRig';
import { TWO_FINGER_ROTATION_SENSITIVITY, TwoFingerMotion } from '../../src/components/stage/twoFingerMotion';

describe('two-finger motion', () => {
  it('pairs sequential pointer events, even across a frame, without a false pinch', () => {
    const motion = new TwoFingerMotion({x:0,y:0},{x:100,y:0});
    motion.move(0,{x:20,y:10});
    expect(motion.flush()).toBeNull();
    motion.move(1,{x:120,y:10});
    expect(motion.flush()).toEqual({dx:20,dy:10,zoom:1,roll:0});
    expect(motion.pending).toBe(false);
  });

  it('keeps zoom exactly constant through repeated noisy parallel motion', () => {
    const motion = new TwoFingerMotion({x:0,y:0},{x:100,y:0});
    let dx = 0, dy = 0;
    for (let i=1;i<=60;i++) {
      motion.move(0,{x:i*2,y:i});
      motion.move(1,{x:100+i*2+(i%3-1),y:i});
      const delta = motion.flush()!;
      expect(delta.zoom).toBe(1); dx += delta.dx; dy += delta.dy;
    }
    expect(dx).toBe(119.5); expect(dy).toBe(60);
  });

  it('separates pure pinch from orbit and supports mixed motion in both directions', () => {
    const motion = new TwoFingerMotion({x:0,y:0},{x:100,y:0});
    motion.move(0,{x:-20,y:0}); motion.move(1,{x:120,y:0});
    expect(motion.flush()).toEqual({dx:0,dy:0,zoom:100/137,roll:0});
    motion.move(0,{x:20,y:10}); motion.move(1,{x:100,y:10});
    expect(motion.flush()).toEqual({dx:10,dy:10,zoom:137/83,roll:0});
  });

  it('accepts a deliberate pinch with one stationary finger after one extra frame', () => {
    const motion = new TwoFingerMotion({x:0,y:0},{x:100,y:0});
    motion.move(1,{x:130,y:0});
    expect(motion.flush()).toBeNull(); expect(motion.pending).toBe(true);
    expect(motion.flush()).toEqual({dx:15,dy:0,zoom:100/127,roll:0});
    expect(motion.flush()).toBeNull();
  });

  it('flushes the last input on release and handles initially coincident contacts', () => {
    const motion = new TwoFingerMotion({x:0,y:0},{x:0,y:0});
    motion.move(1,{x:10,y:0});
    expect(motion.flush(true)).toEqual({dx:5,dy:0,zoom:1,roll:0});
    motion.move(1,{x:20,y:0});
    expect(motion.flush(true)!.zoom).toBeCloseTo(10/17);
  });
});

describe('two-finger rotation gain respects trackball sensitivity', () => {
  it.each([0.4,1,1.7,2])('rotates at 1.7x speed with base sensitivity %s', sensitivity => {
    for (const [dx,dy] of [[40,0],[0,40]]) {
      const normal = new OrbitRig(), precise = new OrbitRig();
      normal.setSensitivity(sensitivity); precise.setSensitivity(sensitivity);
      const motion = new TwoFingerMotion({x:0,y:0},{x:100,y:0});
      motion.move(0,{x:dx!,y:dy!}); motion.move(1,{x:100+dx!,y:dy!});
      const delta=motion.flush()!;
      normal.rotateBy(dx!,dy!,500); precise.rotateBy(delta.dx*TWO_FINGER_ROTATION_SENSITIVITY,delta.dy*TWO_FINGER_ROTATION_SENSITIVITY,500);
      normal.step(0,true); precise.step(0,true);
      const angle = (rig: OrbitRig) => rig.cubeQuaternion(new Quaternion()).angleTo(new Quaternion());
      expect(angle(precise)/angle(normal)).toBeCloseTo(1.7,9);
      expect(precise.current.zoom).toBe(1);
    }
  });
});
