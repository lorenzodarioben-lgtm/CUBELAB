/**
 * The 3D stage (lazy-loaded chunk): Canvas, camera rig, lighting, cube,
 * shadow, celebration and pointer interaction. Renders on demand — frames are
 * requested only while something moves — to keep laptops and phones cool.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { STICKERLESS_REFLECTORS, installStudioEnvironment, renderEnvironment } from './studioEnvironment';
import { StyleReflections } from '../cube/styleReflections';
import { renderStickerlessEnvironment, stickerlessWindowIntensity, stickerlessWindowPosition } from './stickerlessEnvironment';
import type { CubeEngine } from '../../core/engine/cubeEngine';
import { STICKERLESS_RENDERER } from '../cube/stickerless2/flag';
import { V2_STUDIO } from '../cube/stickerless2/studio';
import { LookPreparer, lookLighting, looksAhead, sameLook } from './lookPreparation';
import type { StageLook } from './lookPreparation';
import { mobileFitDistance } from './mobileFraming';

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
  if (zen && width >= 1100) {
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
    // Mobile reserves the timer and tools in layout, outside the interaction canvas.
    side = 16;
    top = 12;
    bottom = 16;
  }
  const availW = Math.max(width >= 1100 ? 180 : 80, width - side * 2);
  const availH = Math.max(width >= 1100 ? 180 : 80, height - top - bottom);
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
  const { studio } = useServices();
  const mobileRotation = useMemo(() => new THREE.Quaternion(), []);
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
    const fit = size.width < 1100 ? {
      distanceScale: mobileFitDistance(size.width, size.height, CUBE_HALF, FOV, rig.cubeQuaternion(mobileRotation), studio.engine.getVisualTurn()),
      shiftY: 0,
    } : target;
    const prev = current.current;
    let framingMoving = false;
    let next = { ...fit, w: size.width, h: size.height };
    if (prev && !reduced && prev.w === size.width && prev.h === size.height) {
      const k = 1 - Math.exp(-Math.min(delta, 0.05) * 9);
      next = {
        ...next,
        distanceScale: size.width < 1100 && fit.distanceScale > prev.distanceScale ? fit.distanceScale : prev.distanceScale + (fit.distanceScale - prev.distanceScale) * k,
        shiftY: prev.shiftY + (fit.shiftY - prev.shiftY) * k,
      };
      framingMoving = Math.abs(next.distanceScale - fit.distanceScale) > 1e-3 || Math.abs(next.shiftY - fit.shiftY) > 0.2;
      if (!framingMoving) next = { ...fit, w: size.width, h: size.height };
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

/**
 * Keep the shared scene environment independent of Stickerless's reflection
 * maps. Rebuild the latter only when the tier or Gloss lighting mode changes
 * (and, for v2, once a lost WebGL context is restored). Maps are installed in
 * layout effects, before the next frame: a frame drawn with the new look's
 * materials and the old look's maps would compile a variant used once.
 */
function StudioEnvironment({ size, intensity, reflections, hybrid, hybridSize }: { size: number; intensity: number; reflections: StyleReflections; hybrid: boolean; hybridSize: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const restore = installStudioEnvironment(gl, scene, intensity, size);
    invalidate();
    return restore;
  }, [gl, scene, size, intensity, invalidate]);
  // v2 rebuilds its maps once a lost WebGL context is restored: their contents did not survive it.
  const [restored, setRestored] = useState(0);
  useEffect(() => {
    if (STICKERLESS_RENDERER !== 'v2') return;
    const canvas = gl.domElement;
    const onRestored = () => setRestored((n) => n + 1);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => canvas.removeEventListener('webglcontextrestored', onRestored);
  }, [gl]);
  const v2 = hybrid && STICKERLESS_RENDERER === 'v2';
  const rebuild = v2 ? restored : 0;
  useLayoutEffect(() => {
    if (v2) {
      const maps = renderStickerlessEnvironment(gl, hybridSize, V2_STUDIO.panels, V2_STUDIO.room, { key: V2_STUDIO.key, fill: V2_STUDIO.fill });
      // Maps the context took with it are not freed again.
      let lost = false;
      const canvas = gl.domElement;
      const onLost = () => {
        lost = true;
      };
      canvas.addEventListener('webglcontextlost', onLost);
      reflections.setStickerless(maps.specular.texture, maps.diffuse.texture);
      invalidate();
      return () => {
        canvas.removeEventListener('webglcontextlost', onLost);
        reflections.setStickerless(null);
        if (!lost) maps.dispose();
      };
    }
    if (hybrid) {
      const maps = renderStickerlessEnvironment(gl, hybridSize);
      reflections.setStickerless(maps.specular.texture, maps.diffuse.texture);
      invalidate();
      return () => { reflections.setStickerless(null); maps.dispose(); };
    }
    const stickerless = renderEnvironment(gl, size, STICKERLESS_REFLECTORS);
    reflections.setStickerless(stickerless.texture);
    invalidate();
    return () => {
      reflections.setStickerless(null);
      stickerless.dispose();
    };
    // `rebuild` is not read: a restored context only asks for fresh v2 maps.
  }, [gl, size, reflections, hybrid, hybridSize, invalidate, v2, rebuild]);
  return null;
}

/**
 * Classic retains its studio lights. Stickerless uses the
 * reviewed finite window, with a matching diffuse key and High-tier shadow.
 */
function Lighting({ look, reflections }: { look: StageLook; reflections: StyleReflections }) {
  // `lookPreparation` compiles each look under this same rig: keep the two in step.
  const { hybrid, shadows, sceneSize, stickerlessSize } = lookLighting(look);
  // v2's studio brings its own key softbox, which the key light matches at its own gain (production's window otherwise).
  const key = STICKERLESS_RENDERER === 'v2' ? V2_STUDIO.key : undefined;
  return (
    <>
      <hemisphereLight visible={!hybrid} args={['#ffffff', '#1a1a1d', 0.38]} />
      <directionalLight
        visible={!hybrid}
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
      <directionalLight visible={!hybrid} position={[6.5, 2.5, 4.5]} intensity={1.05} color="#f4f6ff" />
      {hybrid && <directionalLight
        position={stickerlessWindowPosition(key)}
        intensity={stickerlessWindowIntensity(key) * (key ? V2_STUDIO.keyLight : 1)}
        color={key?.tint ?? '#fffaf0'}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00012}
        shadow-normalBias={0.003}
        shadow-camera-left={-3.4}
        shadow-camera-right={3.4}
        shadow-camera-top={3.4}
        shadow-camera-bottom={-3.4}
        shadow-camera-near={1}
        shadow-camera-far={24}
      />}
      <StudioEnvironment size={sceneSize} intensity={1} reflections={reflections} hybrid={hybrid} hybridSize={stickerlessSize} />
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
function DebugBridge({ registry, frame, engine }: { registry: StickerRegistry; frame: RefObject<THREE.Group | null>; engine: CubeEngine }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const api = (window as unknown as { __CUBELAB__?: Record<string, unknown> }).__CUBELAB__;
    if (!api) return;
    const v = new THREE.Vector3();
    api.visualTurn = () => {
      const turn = engine.getVisualTurn();
      return turn ? { axis: turn.axis, layer: turn.layer, angle: turn.angle } : null;
    };
    api.stickerlessRenderer = () => STICKERLESS_RENDERER;
    api.benchmark = (frames: number) => {
      const context = gl.getContext();
      const pixel = new Uint8Array(4);
      gl.render(scene, camera);
      context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      const start = performance.now();
      for (let i = 0; i < frames; i++) {
        gl.render(scene, camera);
        // Reading a pixel waits for the GPU to finish the frame.
        context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      }
      return (performance.now() - start) / frames;
    };
    api.samplePixels = (points: Array<{ x: number; y: number }>) => {
      const context = gl.getContext();
      const r = gl.domElement.getBoundingClientRect();
      const scale = gl.domElement.width / r.width;
      const pixel = new Uint8Array(4);
      gl.render(scene, camera);
      return points.map(({ x, y }) => {
        const px = Math.round((x - r.left) * scale);
        const py = gl.domElement.height - 1 - Math.round((y - r.top) * scale);
        context.readPixels(px, py, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
        return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
      });
    };
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
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
    });
    // The style actually on screen (the model the scene graph carries), not the setting.
    api.renderedStyle = () => (scene.getObjectByName('cube')?.userData.style as string | undefined) ?? null;
    return () => {
      delete api.visualFacelets;
      delete api.project;
      delete api.renderInfo;
      delete api.renderedStyle;
      delete api.visualTurn;
      delete api.stickerlessRenderer;
      delete api.benchmark;
      delete api.samplePixels;
    };
  }, [camera, gl, scene, registry, frame, engine]);
  return null;
}

interface LookPreparationProps {
  readonly preparer: LookPreparer;
  readonly requested: StageLook;
  readonly shown: StageLook | null;
  /** Auto quality, which may step down to the low tier. */
  readonly auto: boolean;
  readonly onShow: (look: StageLook) => void;
}

/**
 * Shows the requested look once its shaders are ready (see `lookPreparation`);
 * meanwhile the look before it stays on screen and the page stays responsive.
 * With the requested look on screen and the page idle, prepares the looks one
 * step away, and frees what no nearby look uses.
 */
function LookPreparation({ preparer, requested, shown, auto, onShow }: LookPreparationProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => preparer.attach(gl, camera), [preparer, gl, camera]);
  useEffect(() => () => preparer.dispose(), [preparer]);
  // A restored context has none of the prepared programs: prepare the nearby looks again.
  const [restored, setRestored] = useState(0);
  useEffect(() => {
    const canvas = gl.domElement;
    const onRestored = () => {
      preparer.forgetCompiled();
      setRestored((n) => n + 1);
    };
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => canvas.removeEventListener('webglcontextrestored', onRestored);
  }, [gl, preparer]);
  const pending = !shown || !sameLook(shown, requested);
  useEffect(() => {
    if (!pending) return;
    let current = true;
    void preparer.prepare(requested).then(() => {
      if (current) onShow(requested);
    });
    return () => {
      current = false;
    };
  }, [preparer, requested, pending, onShow]);
  useEffect(() => {
    if (!shown) return;
    const ahead = looksAhead(shown, auto);
    preparer.keep(shown, [requested, ...ahead]);
    if (pending) return;
    let cancelled = false;
    const run = async () => {
      for (const look of ahead) {
        if (cancelled) return;
        await preparer.prepare(look);
      }
    };
    const idle = window.requestIdleCallback?.(() => void run(), { timeout: 4000 }) ?? window.setTimeout(() => void run(), 1500);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
    // `restored` is not read: a restore only asks for the nearby looks again.
  }, [preparer, shown, requested, pending, auto, restored]);
  useEffect(() => {
    const api = (window as unknown as { __CUBELAB__?: Record<string, unknown> }).__CUBELAB__;
    if (!api) return;
    // Read-only: whether a requested look is still being prepared (the look before it is on screen).
    api.lookPending = () => pending;
    return () => {
      delete api.lookPending;
    };
  }, [pending]);
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

type Dpr = [number, number];

/** Canvas resolution: lowest on the low tier, full on an explicit High. */
function stageDpr(tier: RenderTier, highSetting: boolean, coarse = false): Dpr {
  // Auto on compact touch screens avoids 26.5% of the pixels of a 1.75 DPR canvas.
  // Explicit High retains its existing full-resolution presentation.
  return tier === 'low' ? [1, 1.25] : highSetting ? [1, 2] : [1, coarse ? 1.5 : 1.75];
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
  // The App changes presentation at this breakpoint, remounting this canvas.
  // Wide touch devices retain the desktop pixel budget as well.
  const compactDpr = coarse && window.innerWidth < 1100;
  const quality: RenderTier =
    settings.quality === 'low' || (settings.quality === 'auto' && autoDegraded)
      ? 'low'
      : settings.quality === 'auto' && coarse
        ? 'medium'
        : 'high';
  const highSetting = settings.quality === 'high';
  // The look asked for, and the one on screen: a new look is shown once its shaders are ready.
  const requested = useMemo<StageLook>(() => ({ style: settings.cubeStyle, finish: 'gloss', tier: quality }), [settings.cubeStyle, quality]);
  const preparer = useMemo(() => new LookPreparer(), []);
  const [shown, setShown] = useState<{ look: StageLook; dpr: Dpr } | null>(null);
  const onShow = useCallback((look: StageLook) => setShown({ look, dpr: stageDpr(look.tier, highSetting, compactDpr) }), [highSetting, compactDpr]);
  const look = shown?.look ?? null;
  // The resolution changes with the look it belongs to.
  const dpr = shown && !sameLook(shown.look, requested) ? shown.dpr : stageDpr(requested.tier, highSetting, compactDpr);

  useEffect(() => rig.setSensitivity(settings.orbitSensitivity), [rig, settings.orbitSensitivity]);

  const onFirstGesture = useCallback(() => {
    if (ui.getState().gestureHint) {
      ui.setState({ gestureHint: false });
      markGestureHintSeen();
    }
  }, [ui]);

  const onReady = useCallback(() => ui.setState({ renderer: 'ready' }), [ui]);
  const hover = useMemo(() => new HoverState(), []);
  const reflections = useMemo(() => new StyleReflections(), []);
  const frameRef = useRef<THREE.Group>(null);
  const floorRef = useRef<THREE.Group>(null);

  return (
    <Canvas
      className="stage-canvas"
      frameloop="demand"
      dpr={dpr}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }}
      camera={{ fov: FOV, near: 0.5, far: 80, position: [6, 5, 8] }}
      shadows={look?.tier === 'high' ? 'soft' : false}
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
      <LookPreparation preparer={preparer} requested={requested} shown={look} auto={settings.quality === 'auto'} onShow={onShow} />
      <CameraRig rig={rig} reduced={reduced} transportOpen={transportOpen} zen={zen} frame={frameRef} floor={floorRef} />
      {look && (
        <>
          <Lighting look={look} reflections={reflections} />
          <group ref={frameRef} name="cube-frame">
            <CubeModel
              reflections={reflections}
              engine={studio.engine}
              visuals={preparer.visuals(look.tier, look.finish)}
              style={look.style}
              faceLabels={settings.faceLabels}
              registry={registry}
            />
            <HoverIndicator hover={hover} engine={studio.engine} style={look.style} />
          </group>
          <group ref={floorRef} name="floor">
            {/* Mounted once and switched off below the high tier: drei's ContactShadows never frees its
                render targets or plane, so remounting it on every tier change would leak GPU memory. */}
            <ContactShadows
              visible={look.tier === 'high'}
              frames={look.tier === 'high' ? Infinity : 0}
              position={[0, FLOOR_Y, 0]}
              scale={8.5}
              blur={2.4}
              far={3.4}
              opacity={0.82}
              resolution={512}
              color="#000000"
            />
            {look.tier !== 'high' && <BlobShadow />}
            <Celebration reduced={reduced} zen={zen} />
          </group>
          <ReadySignal onReady={onReady} />
        </>
      )}
      <Interaction
        studio={studio}
        rig={rig}
        frame={frameRef}
        touchMode={settings.touchMode}
        preview={preview}
        hover={hover}
        onFirstGesture={onFirstGesture}
      />
      <DebugBridge registry={registry} frame={frameRef} engine={studio.engine} />
    </Canvas>
  );
}
