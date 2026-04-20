/**
 * Pointer arbitration for the stage. One handler on the canvas decides, at
 * pointer-down, between exactly two gestures:
 *
 *   - Twist: the pointer went down on the cube (ray hits the cube box), no
 *     orbit modifier is held, and the interaction mode allows twisting.
 *   - Orbit: everything else — background drags, right/middle button,
 *     Shift/Alt/Ctrl-drag, or "Orbit" touch mode. A second finger converts any
 *     gesture into pinch-zoom + orbit (cancelling an unfinished twist).
 *
 * View gestures go to the OrbitRig only; twists go to the engine's drag API.
 * All state is cleared on pointerup, pointercancel and lostpointercapture.
 *
 * Hit tests and projections work in cube coordinates: rays are carried into
 * the turned cube frame, and lattice points are carried back out of it.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Studio } from '../../app/studio';
import type { TouchMode } from '../../core/persistence/settings';
import type { Vec3 } from '../../core/puzzle/geometry';
import { intersectCube, previewFamily, previewLabel, resolveTwist, snapTwist, twistAngle } from '../cube/gestures';
import type { CubeHit, ScreenPoint, TwistResolution } from '../cube/gestures';
import type { HoverState } from '../cube/hoverState';
import type { OrbitRig } from './orbitRig';

type TwistInfo = Extract<TwistResolution, { kind: 'twist' }>;

function setCursor(target: HTMLElement, cursor: string): void {
  target.style.cursor = cursor;
}

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pending'; id: number; start: ScreenPoint; hit: CubeHit; touch: boolean }
  | { kind: 'twist'; id: number; start: ScreenPoint; info: TwistInfo; angle: number; samples: Array<{ t: number; a: number }> }
  | { kind: 'orbit'; id: number; last: ScreenPoint }
  | { kind: 'pinch'; distance: number; mid: ScreenPoint }
  | { kind: 'dead'; id: number };

export interface PreviewSink {
  /** `committed` is true once releasing would commit the shown move. */
  show(label: string, committed: boolean, x: number, y: number): void;
  hide(): void;
}

function showPreview(sink: PreviewSink, info: TwistInfo, angle: number, p: ScreenPoint): void {
  const label = previewLabel(info.axis, info.layer, angle);
  sink.show(label ?? previewFamily(info.axis, info.layer), label !== null, p.x, p.y);
}

interface InteractionProps {
  readonly studio: Studio;
  readonly rig: OrbitRig;
  /** The turned cube frame (identity when the view is at home). */
  readonly frame: RefObject<THREE.Group | null>;
  readonly touchMode: TouchMode;
  readonly preview: PreviewSink;
  readonly hover: HoverState;
  readonly onFirstGesture: () => void;
}

export function Interaction({ studio, rig, frame, touchMode, preview, hover, onFirstGesture }: InteractionProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const el = gl.domElement;
    const engine = studio.engine;
    const pointers = new Map<number, ScreenPoint>();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const projected = new THREE.Vector3();
    const toCube = new THREE.Matrix4();
    let gesture: Gesture = { kind: 'idle' };
    let rect = el.getBoundingClientRect();

    const local = (e: PointerEvent | WheelEvent): ScreenPoint => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    const hitTest = (p: ScreenPoint): CubeHit | null => {
      ndc.set((p.x / rect.width) * 2 - 1, -(p.y / rect.height) * 2 + 1);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      const cube = frame.current;
      if (cube) {
        cube.updateWorldMatrix(true, false);
        raycaster.ray.applyMatrix4(toCube.copy(cube.matrixWorld).invert());
      }
      const o = raycaster.ray.origin;
      const d = raycaster.ray.direction;
      return intersectCube([o.x, o.y, o.z], [d.x, d.y, d.z]);
    };

    const project = (point: Vec3): ScreenPoint => {
      projected.set(point[0], point[1], point[2]);
      if (frame.current) projected.applyMatrix4(frame.current.matrixWorld);
      projected.project(camera);
      return { x: ((projected.x + 1) / 2) * rect.width, y: ((1 - projected.y) / 2) * rect.height };
    };

    const cancelTwist = () => {
      if (gesture.kind === 'twist') engine.endDrag(null);
      preview.hide();
    };

    const startPinch = () => {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      cancelTwist();
      gesture = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button > 2) return;
      hover.clear();
      rect = el.getBoundingClientRect();
      const p = local(e);
      pointers.set(e.pointerId, p);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture can fail for synthetic events; gesture still works */
      }
      e.preventDefault();
      if (pointers.size === 2) {
        startPinch();
        return;
      }
      if (pointers.size > 2) return;
      const orbitOnly = e.button === 1 || e.button === 2 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || touchMode === 'orbit';
      const hit = orbitOnly ? null : hitTest(p);
      if (hit) {
        gesture = { kind: 'pending', id: e.pointerId, start: p, hit, touch: e.pointerType !== 'mouse' };
      } else {
        gesture = { kind: 'orbit', id: e.pointerId, last: p };
        setCursor(el, 'grabbing');
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

      if (gesture.kind === 'idle') {
        if (e.pointerType !== 'mouse') return;
        const hit = touchMode === 'twist' ? hitTest(p) : null;
        setCursor(el, hit ? 'pointer' : 'grab');
        if (hit) hover.set(hit.normal, hit.point);
        else hover.clear();
        return;
      }
      if (gesture.kind === 'pinch') {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (distance > 0 && gesture.distance > 0) rig.zoomBy(gesture.distance / distance);
        rig.rotateBy(mid.x - gesture.mid.x, mid.y - gesture.mid.y, rect.height);
        gesture = { kind: 'pinch', distance, mid };
        onFirstGesture();
        invalidate();
        return;
      }
      if ('id' in gesture && gesture.id !== e.pointerId) return;

      if (gesture.kind === 'orbit') {
        rig.rotateBy(p.x - gesture.last.x, p.y - gesture.last.y, rect.height);
        gesture = { ...gesture, last: p };
        onFirstGesture();
        invalidate();
        return;
      }
      if (gesture.kind === 'pending') {
        const drag = { x: p.x - gesture.start.x, y: p.y - gesture.start.y };
        const threshold = gesture.touch ? 10 : 6;
        const res = resolveTwist(gesture.hit, drag, project, { threshold });
        if (res.kind === 'pending') return;
        if (res.kind === 'ambiguous') {
          if (Math.hypot(drag.x, drag.y) > threshold * 3.5) {
            studio.hint('Drag along a row or column to twist');
            gesture = { kind: 'dead', id: gesture.id };
          }
          return;
        }
        if (!studio.beginTwist()) {
          gesture = { kind: 'dead', id: gesture.id };
          return;
        }
        const angle = twistAngle(res, drag);
        gesture = { kind: 'twist', id: gesture.id, start: gesture.start, info: res, angle, samples: [{ t: e.timeStamp, a: angle }] };
        engine.updateDrag({ axis: res.axis, layer: res.layer, angle });
        showPreview(preview, res, angle, p);
        onFirstGesture();
        return;
      }
      if (gesture.kind === 'twist') {
        const drag = { x: p.x - gesture.start.x, y: p.y - gesture.start.y };
        const angle = twistAngle(gesture.info, drag);
        gesture.angle = angle;
        gesture.samples.push({ t: e.timeStamp, a: angle });
        if (gesture.samples.length > 8) gesture.samples.shift();
        engine.updateDrag({ axis: gesture.info.axis, layer: gesture.info.layer, angle });
        showPreview(preview, gesture.info, angle, p);
      }
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const wasTracked = pointers.delete(e.pointerId);
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!wasTracked) return;
      if (gesture.kind === 'pinch') {
        // Remaining finger does nothing until lifted — avoids a jump into orbit/twist.
        const remaining = [...pointers.keys()][0];
        gesture = remaining === undefined ? { kind: 'idle' } : { kind: 'dead', id: remaining };
        return;
      }
      if ('id' in gesture && gesture.id !== e.pointerId) return;
      if (gesture.kind === 'twist') {
        preview.hide();
        if (cancelled) {
          engine.endDrag(null);
        } else {
          const recent = gesture.samples.filter((s) => e.timeStamp - s.t <= 90);
          const first = recent[0];
          const velocity = first && e.timeStamp > first.t ? ((gesture.angle - first.a) / (e.timeStamp - first.t)) * 1000 : 0;
          const snap = snapTwist(gesture.info.axis, gesture.info.layer, gesture.angle, velocity);
          engine.endDrag(
            snap
              ? { move: snap.move, fromAngle: gesture.angle, targetAngle: snap.targetAngle, quarterDurationMs: studio.dragQuarterDuration() }
              : null,
          );
        }
      }
      gesture = { kind: 'idle' };
      if (e.pointerType === 'mouse') setCursor(el, 'grab');
      invalidate();
    };

    const onPointerUp = (e: PointerEvent) => finish(e, false);
    const onPointerCancel = (e: PointerEvent) => finish(e, true);
    const onLostCapture = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) finish(e, true);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      rig.zoomBy(Math.exp(Math.max(-60, Math.min(60, delta)) * 0.0022));
      onFirstGesture();
      invalidate();
    };

    const onContextMenu = (e: Event) => e.preventDefault();
    const onLeave = () => {
      hover.clear();
      if (gesture.kind === 'idle') setCursor(el, '');
    };

    setCursor(el, 'grab');
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('lostpointercapture', onLostCapture);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      cancelTwist();
      hover.clear();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('lostpointercapture', onLostCapture);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [gl, camera, invalidate, studio, rig, frame, touchMode, preview, hover, onFirstGesture]);

  return null;
}
