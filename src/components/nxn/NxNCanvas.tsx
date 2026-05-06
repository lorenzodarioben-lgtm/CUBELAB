import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Face } from '../../core/puzzle/notation';
import type { NxState } from '../../core/nxn/model';
import type { NxMove } from '../../core/nxn/model';
import { installStudioEnvironment } from '../stage/studioEnvironment';
import { NxNCube } from './NxNCube';

function StudioLight() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const restore = installStudioEnvironment(gl, scene, 1.15, 128);
    invalidate();
    return restore;
  }, [gl, scene, invalidate]);
  return null;
}

export function NxNCanvas({ state, active, onTurn, onTurnComplete }: {
  readonly state: NxState;
  readonly active: { readonly token: number; readonly move: NxMove; readonly durationMs: number } | null;
  readonly onTurn: (face: Face, inverse: boolean) => void;
  readonly onTurnComplete: (token: number) => void;
}) {
  return (
    <Canvas
      className="nxn-canvas"
      frameloop="demand"
      dpr={[1, 1.75]}
      camera={{ position: [5.5, 4.2, 6.8], fov: 34, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.setClearColor(0x000000, 0);
      }}
      aria-hidden
    >
      <hemisphereLight args={['#ffffff', '#171920', 0.54]} />
      <directionalLight position={[-5, 8, 5]} intensity={2.2} color="#fff4e9" />
      <directionalLight position={[5, 3, -3]} intensity={1.25} color="#ecf3ff" />
      <StudioLight />
      <NxNCube state={state} active={active} onTurn={onTurn} onTurnComplete={onTurnComplete} />
      <ContactShadows position={[0, -1.75, 0]} opacity={0.38} scale={5.4} blur={2.6} far={3} resolution={256} frames={1} />
      <OrbitControls enablePan={false} minDistance={5.5} maxDistance={12} enableDamping dampingFactor={0.09} />
    </Canvas>
  );
}
