/**
 * The 3D stage (lazy-loaded chunk): Canvas, camera rig, lighting, cube,
 * shadow, celebration and pointer interaction. Renders on demand — frames are
 * requested only while something moves — to keep laptops and phones cool.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { useServices, useStudio, useUi } from '../../app/context';
import { markGestureHintSeen } from '../../app/uiStore';
import { CubeModel } from '../cube/CubeModel';
import { MAX_SURFACE_OFFSET, SPACING } from '../cube/cubeResources';
import type { RenderTier } from '../cube/cubeResources';
import { HoverIndicator } from '../cube/HoverIndicator';
import { HoverState } from '../cube/hoverState';
import type { StickerRegistry } from '../cube/CubeModel';
import { readVisualFacelets } from '../cube/visualFacelets';
import { Interaction } from './Interaction';
import type { PreviewSink } from './Interaction';
import type { OrbitRig } from './orbitRig';
import { Celebration } from './Celebration';
import { installStudioEnvironment } from './studioEnvironment';

const FOV = 27;
/** Bounding-sphere radius of the cube (half its space diagonal, in world units). */
const CUBE_RADIUS = 2.6;
/** Half the cube's outer width, to the top of the tiles. */
const CUBE_HALF = SPACING + MAX_SURFACE_OFFSET;
/** Resting height of the floor the shadow lies on. */
const FLOOR_Y = -2.1;
const FLOOR_CLEARANCE = 0.12;
const rotation = new THREE.Matrix4();

/**
 * Free stage area around the overlays, so the cube is framed in the space the
 * panels leave rather than the raw canvas. Mirrors the CSS layout constants.
 */
interface FramingContext {
  readonly transportOpen: boolean;
  readonly zen: boolean;
}

function framing(width: number, height: number, { transportOpen, zen }: FramingContext): { distanceScale: number; shiftY: number } {
  let side: number;
  let top: number;
  let bottom: number;
  if (zen) {
    // Only the clock remains, centred at the top.
    side = 32;
    top = width >= 1100 ? 170 : Math.min(150, height * 0.24);
    bottom = 40;
  } else if (width >= 1100) {
    const gutter = Math.min(28, Math.max(16, width * 0.02));
    const rail = Math.min(352, Math.max(296, width * 0.23));
    side = rail + gutter * 2;
    top = 76;
    // The solution transport floats bottom-centre on wide layouts; keep the cube clear of it.
    bottom = transportOpen ? 210 : 72;
  } else {
    side = 14;
    top = Math.min(150, height * 0.28);
    bottom = 58;
  }
  const availW = Math.max(180, width - side * 2);
  const availH = Math.max(180, height - top - bottom);
  // Target: the bounding sphere spans ~94% of the smaller free dimension.
  const targetRadiusPx = 0.47 * Math.min(availW, availH);
  const distance = (CUBE_RADIUS * (height / 2)) / (Math.tan(((FOV / 2) * Math.PI) / 180) * targetRadiusPx);
  return { distanceScale: distance, shiftY: (top - bottom) / 2 };
}

/**
 * Turns the cube to the rig's view and keeps the floor just under the turned
 * cube's lowest point, so a corner-down cube never sinks into its shadow.
 */
function poseCube(rig: OrbitRig, cube: THREE.Object3D | null, floor: THREE.Object3D | null): void {
  if (!cube) return;
  rig.cubeQuaternion(cube.quaternion);
  if (!floor) return;
  // Lowest point: half-width times the summed |y| of the cube's rotated axes.
  const e = rotation.makeRotationFromQuaternion(cube.quaternion).elements;
  const reach = CUBE_HALF * (Math.abs(e[1]!) + Math.abs(e[5]!) + Math.abs(e[9]!));
  floor.position.y = Math.min(0, -reach - FLOOR_CLEARANCE - FLOOR_Y);
}

interface CameraRigProps {
  readonly rig: OrbitRig;
  readonly reduced: boolean;
  readonly transportOpen: boolean;
  readonly zen: boolean;
  /** The group that turns the cube (and its hover outline) to show the current view. */
  readonly frame: RefObject<THREE.Group | null>;
  /** The floor (shadow, celebration ripple), lowered when a tumbled cube reaches further down. */
  readonly floor: RefObject<THREE.Group | null>;
}

/**
 * Fixed studio camera, framed to the free stage area. The view turns the cube
 * itself in front of the camera, so the studio lights keep coming from above
 * and the shadow stays on the floor however the cube is held.
 */
function CameraRig({ rig, reduced, transportOpen, zen, frame, floor }: CameraRigProps) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const target = useMemo(() => framing(size.width, size.height, { transportOpen, zen }), [size.width, size.height, transportOpen, zen]);
  // Rendered framing eases toward the target so panels opening never make the cube jump.
  const current = useRef<{ distanceScale: number; shiftY: number; w: number; h: number } | null>(null);

  useEffect(() => rig.subscribe(() => invalidate()), [rig, invalidate]);
  useEffect(() => {
    invalidate();
    return () => camera.clearViewOffset();
  }, [camera, target, invalidate]);

  useFrame((_, delta) => {
    const moving = rig.step(Math.min(delta, 0.05), reduced);
    const prev = current.current;
    let framingMoving = false;
    let next = { ...target, w: size.width, h: size.height };
    if (prev && !reduced && prev.w === size.width && prev.h === size.height) {
      const k = 1 - Math.exp(-Math.min(delta, 0.05) * 9);
      next = {
        ...next,
        distanceScale: prev.distanceScale + (target.distanceScale - prev.distanceScale) * k,
        shiftY: prev.shiftY + (target.shiftY - prev.shiftY) * k,
      };
      framingMoving = Math.abs(next.distanceScale - target.distanceScale) > 1e-3 || Math.abs(next.shiftY - target.shiftY) > 0.2;
      if (!framingMoving) next = { ...target, w: size.width, h: size.height };
    }
    if (!prev || prev.shiftY !== next.shiftY || prev.w !== next.w || prev.h !== next.h) {
      // Shift the projection so the cube sits in the centre of the free area.
      camera.setViewOffset(size.width, size.height, 0, -next.shiftY, size.width, size.height);
      camera.updateProjectionMatrix();
    }
    current.current = next;
    const [x, y, z] = rig.cameraPosition(next.distanceScale);
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    poseCube(rig, frame.current, floor.current);
    if (moving || framingMoving) invalidate();
  });
  return null;
}

/** Prefiltered studio reflections (see studioEnvironment.ts), rebuilt only when the tier changes. */
function StudioEnvironment({ size, intensity }: { size: number; intensity: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const restore = installStudioEnvironment(gl, scene, intensity, size);
    invalidate();
    return restore;
  }, [gl, scene, size, intensity, invalidate]);
  return null;
}

/**
 * Product-photography lighting: image-based light from the studio environment
 * (softboxes and strips in a dark cyclorama), plus a warm key light from the
 * overhead box that casts soft shadows on the high tier, so turning layers and
 * seams shade each other, and a whisper of sky fill for the shadow sides.
 */
function Lighting({ high, shadows }: { high: boolean; shadows: boolean }) {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#1a1a1d', 0.38]} />
      <directionalLight
        position={[-4.5, 8, 5.5]}
        intensity={1.35}
        color="#fff6ec"
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.02}
        shadow-camera-left={-3.4}
        shadow-camera-right={3.4}
        shadow-camera-top={3.4}
        shadow-camera-bottom={-3.4}
        shadow-camera-near={2}
        shadow-camera-far={22}
      />
      <directionalLight position={[6.5, 2.5, 4.5]} intensity={1.05} color="#f4f6ff" />
      <StudioEnvironment size={high ? 256 : 128} intensity={1} />
    </>
  );
}

/** Cheap static floor glow for low quality (no extra render pass). */
function BlobShadow() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -2.15, 0]}>
      <planeGeometry args={[6.5, 6.5]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** Read-only verification hooks: rendered facelets, cube→screen projection and the shown style. */
function DebugBridge({ registry, frame }: { registry: StickerRegistry; frame: RefObject<THREE.Group | null> }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const api = (window as unknown as { __CUBELAB__?: Record<string, unknown> }).__CUBELAB__;
    if (!api) return;
    const v = new THREE.Vector3();
    api.visualFacelets = () => readVisualFacelets(registry.meshes, frame.current);
    api.project = (p: [number, number, number]) => {
      camera.updateMatrixWorld();
      v.set(p[0], p[1], p[2]);
      if (frame.current) v.applyMatrix4(frame.current.matrixWorld);
      v.project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    api.renderInfo = () => ({
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
    });
    // The style actually on screen (the model the scene graph carries), not the setting.
    api.renderedStyle = () => (scene.getObjectByName('cube')?.userData.style as string | undefined) ?? null;
    return () => {
      delete api.visualFacelets;
      delete api.project;
      delete api.renderInfo;
      delete api.renderedStyle;
    };
  }, [camera, gl, scene, registry, frame]);
  return null;
}

function ReadySignal({ onReady }: { onReady: () => void }) {
  const fired = useRef(false);
  useFrame(() => {
    if (!fired.current) {
      fired.current = true;
      onReady();
    }
  });
  return null;
}

export interface StageCanvasProps {
  readonly registry: StickerRegistry;
  readonly preview: PreviewSink;
}

export default function StageCanvas({ registry, preview }: StageCanvasProps) {
  const { studio, rig, ui } = useServices();
  const settings = useStudio((s) => s.settings);
  const systemReduced = useStudio((s) => s.systemReducedMotion);
  const zen = useUi((s) => s.zen);
  const transportOpen = useStudio((s) => s.solver.status !== 'idle');
  const reduced = settings.motion === 'reduce' || (settings.motion === 'system' && systemReduced);
  const [autoDegraded, setAutoDegraded] = useState(false);
  // Auto: full shadows on fine pointers (desktop); touch devices get the medium
  // tier — identical materials, no extra shadow passes. Sustained frame drops
  // step either down to low.
  const coarse = useMemo(() => window.matchMedia('(pointer: coarse)').matches, []);
  const quality: RenderTier =
    settings.quality === 'low' || (settings.quality === 'auto' && autoDegraded)
      ? 'low'
      : settings.quality === 'auto' && coarse
        ? 'medium'
        : 'high';
  const dpr: [number, number] = quality === 'low' ? [1, 1.25] : settings.quality === 'high' ? [1, 2] : [1, 1.75];

  useEffect(() => rig.setSensitivity(settings.orbitSensitivity), [rig, settings.orbitSensitivity]);

  const onFirstGesture = useCallback(() => {
    if (ui.getState().gestureHint) {
      ui.setState({ gestureHint: false });
      markGestureHintSeen();
    }
  }, [ui]);

  const onReady = useCallback(() => ui.setState({ renderer: 'ready' }), [ui]);
  const hover = useMemo(() => new HoverState(), []);
  const frameRef = useRef<THREE.Group>(null);
  const floorRef = useRef<THREE.Group>(null);

  return (
    <Canvas
      className="stage-canvas"
      frameloop="demand"
      dpr={dpr}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
      camera={{ fov: FOV, near: 0.5, far: 80, position: [6, 5, 8] }}
      shadows={quality === 'high' ? 'soft' : false}
      onCreated={({ gl }) => {
        // Only three's built-in shaders are used; their info-log check stalls compilation and
        // merely echoes driver notes (e.g. ANGLE/D3D precision remarks) as console warnings.
        gl.debug.checkShaderErrors = false;
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.1;
        gl.setClearColor(0x000000, 0);
      }}
      aria-hidden
    >
      {settings.quality === 'auto' && <PerformanceMonitor onDecline={() => setAutoDegraded(true)} flipflops={2} />}
      <CameraRig rig={rig} reduced={reduced} transportOpen={transportOpen} zen={zen} frame={frameRef} floor={floorRef} />
      <Lighting high={quality !== 'low'} shadows={quality === 'high'} />
      <group ref={frameRef} name="cube-frame">
        <CubeModel
          engine={studio.engine}
          quality={quality}
          finish={settings.finish}
          style={settings.cubeStyle}
          faceLabels={settings.faceLabels}
          registry={registry}
        />
        <HoverIndicator hover={hover} engine={studio.engine} style={settings.cubeStyle} />
      </group>
      <group ref={floorRef} name="floor">
        {/* Mounted once and switched off below the high tier: drei's ContactShadows never frees its
            render targets or plane, so remounting it on every tier change would leak GPU memory. */}
        <ContactShadows
          visible={quality === 'high'}
          frames={quality === 'high' ? Infinity : 0}
          position={[0, FLOOR_Y, 0]}
          scale={8.5}
          blur={2.4}
          far={3.4}
          opacity={0.82}
          resolution={512}
          color="#000000"
        />
        {quality !== 'high' && <BlobShadow />}
        <Celebration reduced={reduced} zen={zen} />
      </group>
      <Interaction
        studio={studio}
        rig={rig}
        frame={frameRef}
        touchMode={settings.touchMode}
        preview={preview}
        hover={hover}
        onFirstGesture={onFirstGesture}
      />
      <DebugBridge registry={registry} frame={frameRef} />
      <ReadySignal onReady={onReady} />
    </Canvas>
  );
}
