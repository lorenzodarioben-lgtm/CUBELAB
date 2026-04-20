import { describe, expect, it } from 'vitest';
import { COMMIT_ANGLE, intersectCube, previewLabel, resolveTwist, snapTwist, twistAngle } from '../../src/components/cube/gestures';
import type { Project } from '../../src/components/cube/gestures';
import * as THREE from 'three';
import { HOME_POSE, OrbitRig } from '../../src/components/stage/orbitRig';
import { formatMove } from '../../src/core/puzzle/notation';

/** Orthographic view straight at F: screen x = world x, screen y = −world y (100 px per unit). */
const frontView: Project = ([x, y]) => ({ x: x * 100, y: -y * 100 });
/** Straight down at U with F at the bottom of the screen: screen x = x, screen y = z. */
const topView: Project = ([x, , z]) => ({ x: x * 100, y: z * 100 });

describe('ray casting', () => {
  it('finds the entry face and point of the cube box', () => {
    const hit = intersectCube([0.5, 0.2, 10], [0, 0, -1]);
    expect(hit?.normal).toEqual([0, 0, 1]);
    expect(hit?.point[2]).toBeCloseTo(1.5);
    expect(intersectCube([5, 5, 10], [0, 0, -1])).toBeNull();
    expect(intersectCube([0, 10, 0], [0, -1, 0])?.normal).toEqual([0, 1, 0]);
    expect(intersectCube([-10, 0.3, 0.3], [1, 0, 0])?.normal).toEqual([-1, 0, 0]);
  });
});

describe('twist resolution', () => {
  const frontRight = { normal: [0, 0, 1] as const, point: [1, 0, 1.5] as const };

  it('waits below the drag threshold', () => {
    expect(resolveTwist(frontRight, { x: 0, y: -3 }, frontView, { threshold: 6 }).kind).toBe('pending');
  });

  it('pushing the front-right column up is R', () => {
    const res = resolveTwist(frontRight, { x: 0, y: -40 }, frontView, { threshold: 6 });
    expect(res.kind).toBe('twist');
    if (res.kind !== 'twist') return;
    const angle = twistAngle(res, { x: 0, y: -160 });
    const snap = snapTwist(res.axis, res.layer, angle);
    expect(snap && formatMove(snap.move)).toBe('R');
    expect(snap && formatMove(snapTwist(res.axis, res.layer, twistAngle(res, { x: 0, y: 160 }))!.move)).toBe("R'");
  });

  it('pushing the front top row left is U; right is U′', () => {
    const top = { normal: [0, 0, 1] as const, point: [0, 1, 1.5] as const };
    const res = resolveTwist(top, { x: -40, y: 0 }, frontView, { threshold: 6 });
    if (res.kind !== 'twist') throw new Error('expected twist');
    expect(formatMove(snapTwist(res.axis, res.layer, twistAngle(res, { x: -160, y: 0 }))!.move)).toBe('U');
    expect(formatMove(snapTwist(res.axis, res.layer, twistAngle(res, { x: 160, y: 0 }))!.move)).toBe("U'");
  });

  it('dragging the U face front row to the right is F (stickers carried toward R)', () => {
    const hit = { normal: [0, 1, 0] as const, point: [0, 1.5, 1] as const };
    const res = resolveTwist(hit, { x: 40, y: 0 }, topView, { threshold: 6 });
    if (res.kind !== 'twist') throw new Error('expected twist');
    expect(formatMove(snapTwist(res.axis, res.layer, twistAngle(res, { x: 160, y: 0 }))!.move)).toBe('F');
  });

  it('left and down faces are not inverted', () => {
    const left = { normal: [0, 0, 1] as const, point: [-1, 0, 1.5] as const };
    const res = resolveTwist(left, { x: 0, y: 40 }, frontView, { threshold: 6 });
    if (res.kind !== 'twist') throw new Error('expected twist');
    // Pulling the left column down carries F stickers to D: that is L.
    expect(formatMove(snapTwist(res.axis, res.layer, twistAngle(res, { x: 0, y: 160 }))!.move)).toBe('L');
    const bottom = { normal: [0, 0, 1] as const, point: [0, -1, 1.5] as const };
    const res2 = resolveTwist(bottom, { x: 40, y: 0 }, frontView, { threshold: 6 });
    if (res2.kind !== 'twist') throw new Error('expected twist');
    // Pushing the bottom row right carries F to R: that is D.
    expect(formatMove(snapTwist(res2.axis, res2.layer, twistAngle(res2, { x: 160, y: 0 }))!.move)).toBe('D');
  });

  it('refuses diagonal ambiguity', () => {
    expect(resolveTwist(frontRight, { x: 30, y: -30 }, frontView, { threshold: 6 }).kind).toBe('ambiguous');
  });

  it('snaps below the commit angle back to rest, double past ~135°', () => {
    expect(snapTwist(0, 1, COMMIT_ANGLE * 0.9)).toBeNull();
    expect(snapTwist(0, 1, 0.2, 6)).not.toBeNull(); // quick flick
    expect(formatMove(snapTwist(0, 1, -2.6)!.move)).toBe('R2');
    expect(previewLabel(0, 1, -1.2)).toBe('R');
    expect(previewLabel(0, 1, 0.1)).toBeNull();
  });
});

describe('orbit rig (free trackball)', () => {
  /** Screen x/y (NDC) of a cube-space point, as the stage renders it: fixed camera, turned cube. */
  function screen(rig: OrbitRig, p: [number, number, number]): THREE.Vector2 {
    const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
    camera.position.set(...rig.cameraPosition(14));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(...p).applyQuaternion(rig.cubeQuaternion(new THREE.Quaternion())).project(camera);
    return new THREE.Vector2(v.x, v.y);
  }

  it('starts at the home view with the cube square to the studio', () => {
    const rig = new OrbitRig();
    expect(rig.current.azimuth).toBeCloseTo(HOME_POSE.azimuth);
    expect(rig.current.polar).toBeCloseTo(HOME_POSE.polar);
    expect(rig.cubeQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion())).toBeCloseTo(0);
    expect(rig.up()[1]).toBeGreaterThan(0.5);
  });

  it('tumbles past the poles: dragging far enough turns white to face the floor', () => {
    const rig = new OrbitRig();
    // ~π of rotation in one vertical drag (k = π / 800 × 1.15 per pixel).
    rig.rotateBy(0, -700, 800);
    rig.step(0, true);
    expect(rig.up()[1]).toBeLessThan(-0.5); // U is now at the bottom of the screen
    expect(screen(rig, [0, 1.5, 0]).y).toBeLessThan(screen(rig, [0, -1.5, 0]).y);
    // Keep going: another half turn comes back upright.
    rig.rotateBy(0, -700, 800);
    rig.step(0, true);
    expect(rig.up()[1]).toBeGreaterThan(0.5);
  });

  it('follows the pointer: a rightward drag carries the front of the cube to the right', () => {
    const rig = new OrbitRig();
    const before = screen(rig, [0, 0, 1.5]);
    rig.rotateBy(60, 0, 800);
    rig.step(0, true);
    expect(screen(rig, [0, 0, 1.5]).x).toBeGreaterThan(before.x);
    const top = screen(rig, [0, 1.5, 0]);
    rig.rotateBy(0, 60, 800);
    rig.step(0, true);
    expect(screen(rig, [0, 1.5, 0]).y).toBeLessThan(top.y); // dragging down rolls the top toward the viewer
  });

  it('bounds zoom, eases to rest and resets home', () => {
    const rig = new OrbitRig();
    rig.rotateBy(400, 10_000, 800);
    rig.zoomBy(100);
    expect(rig.target.zoom).toBeLessThanOrEqual(1.65);
    expect(rig.target.polar).toBeGreaterThanOrEqual(0);
    expect(rig.target.polar).toBeLessThanOrEqual(Math.PI);
    for (let i = 0; i < 400; i++) rig.step(1 / 60, false);
    expect(rig.isMoving()).toBe(false);
    rig.reset();
    rig.step(0, true);
    expect(rig.current.polar).toBeCloseTo(HOME_POSE.polar);
    expect(rig.current.azimuth).toBeCloseTo(HOME_POSE.azimuth);
    expect(rig.current.zoom).toBe(1);
    expect(rig.up()[1]).toBeGreaterThan(0.5);
  });

  it('keyboard nudges turn about the screen axes', () => {
    const rig = new OrbitRig();
    rig.nudge(0, Math.PI);
    rig.step(0, true);
    expect(rig.up()[1]).toBeLessThan(-0.5);
  });
});
