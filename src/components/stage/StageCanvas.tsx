/**
 * The 3D stage (lazy-loaded chunk): Canvas, camera rig, lighting, cube,
 * shadow, celebration and pointer interaction. Renders on demand — frames are
 * requested only while something moves — to keep laptops and phones cool.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { useServices, useStudio, useUi } from '../../app/context';
import { markGestureHintSeen } from '../../app/uiStore';
import { CubeModel } from '../cube/CubeModel';
import type { RenderTier } from '../cube/cubeResources';
import { HoverIndicator } from '../cube/HoverIndicator';
import { HoverState } from '../cube/hoverState';
import type { StickerRegistry } from '../cube/CubeModel';
import { readVisualFacelets } from '../cube/visualFacelets';
import { Interaction } from './Interaction';
import type { PreviewSink } from './Interaction';
import type { OrbitRig } from './orbitRig';
import { Celebration } from './Celebration';

const FOV = 27;
/** Bounding-sphere radius of the cube (half its space diagonal, in world units). */
const CUBE_RADIUS = 2.6;

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

function CameraRig({ rig, reduced, transportOpen, zen }: { rig: OrbitRig; reduced: boolean; transportOpen: boolean; zen: boolean }) {
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
    const [x, y, z] = rig.position(next.distanceScale);
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    if (moving || framingMoving) invalidate();
  });
  return null;
}

/**
 * Neutral product-photography lighting. All sources are white-balanced (no
 * coloured tints): a broad overhead softbox, a tall key strip front-left, a
 * narrow rim strip behind-right that draws the bevel highlights, and a low
 * front fill. A warm key light casts soft shadows on the high tier so turning
 * layers and seams shade each other.
 */
function Lighting({ high, shadows }: { high: boolean; shadows: boolean }) {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#18181a', 0.42]} />
      <directionalLight
        position={[-4.5, 8, 5.5]}
        intensity={1.6}
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
      <directionalLight position={[7, 2.5, 4]} intensity={0.95} color="#f1f4ff" />
      <directionalLight position={[-1, 4, -8]} intensity={0.85} color="#ffffff" />
      <Environment resolution={high ? 256 : 128} frames={1}>
        <Lightformer form="rect" intensity={2.4} color="#ffffff" position={[0, 8, 2]} scale={[12, 5, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.7} color="#fffaf3" position={[-7, 2.5, 5]} scale={[3, 9, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.7} color="#ffffff" position={[7, 3, -4]} scale={[2.4, 9, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.9} color="#fffaf2" position={[0.5, 1.5, 9]} scale={[6, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.55} color="#f4f6ff" position={[3, -1, 8]} scale={[8, 2, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.1} color="#ffffff" position={[8, 1, 3]} scale={[2.5, 6, 1]} target={[0, 0, 0]} />
        <Lightformer form="circle" intensity={0.3} color="#ffffff" position={[0, -7, 0]} scale={6} target={[0, 0, 0]} />
      </Environment>
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

/** Read-only verification hooks: rendered facelets and world→screen projection. */
function DebugBridge({ registry }: { registry: StickerRegistry }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const api = (window as unknown as { __CUBELAB__?: Record<string, unknown> }).__CUBELAB__;
    if (!api) return;
    const v = new THREE.Vector3();
    api.visualFacelets = () => readVisualFacelets(registry.meshes);
    api.project = (p: [number, number, number]) => {
      camera.updateMatrixWorld();
      v.set(p[0], p[1], p[2]).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    api.renderInfo = () => ({
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
    });
    return () => {
      delete api.visualFacelets;
      delete api.project;
      delete api.renderInfo;
    };
  }, [camera, gl, registry]);
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
      <CameraRig rig={rig} reduced={reduced} transportOpen={transportOpen} zen={zen} />
      <Lighting high={quality !== 'low'} shadows={quality === 'high'} />
      <CubeModel engine={studio.engine} quality={quality} finish={settings.finish} faceLabels={settings.faceLabels} registry={registry} />
      {quality === 'high' ? (
        <ContactShadows position={[0, -2.1, 0]} scale={8.5} blur={2.4} far={3.4} opacity={0.82} resolution={512} color="#000000" />
      ) : (
        <BlobShadow />
      )}
      <Celebration reduced={reduced} zen={zen} />
      <HoverIndicator hover={hover} engine={studio.engine} />
      <Interaction studio={studio} rig={rig} touchMode={settings.touchMode} preview={preview} hover={hover} onFirstGesture={onFirstGesture} />
      <DebugBridge registry={registry} />
      <ReadySignal onReady={onReady} />
    </Canvas>
  );
}
