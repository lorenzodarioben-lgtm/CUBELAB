/**
 * A faint outline on the sticker under the mouse, so the strip you are about
 * to grab — outer face or middle slice — is visible before you press. Mouse
 * only; hidden while anything animates, during drags and on touch input.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CubeEngine } from '../../core/engine/cubeEngine';
import type { HoverState } from './hoverState';

function frameShape(outer: number, inner: number, rOuter: number, rInner: number): THREE.Shape {
  const square = (size: number, r: number, path: THREE.Path) => {
    const h = size / 2;
    path.moveTo(-h + r, -h);
    path.lineTo(h - r, -h);
    path.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false);
    path.lineTo(h, h - r);
    path.absarc(h - r, h - r, r, 0, Math.PI / 2, false);
    path.lineTo(-h + r, h);
    path.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false);
    path.lineTo(-h, -h + r);
    path.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  };
  const shape = new THREE.Shape();
  square(outer, rOuter, shape);
  const hole = new THREE.Path();
  square(inner, rInner, hole);
  shape.holes.push(hole);
  return shape;
}

export function HoverIndicator({ hover, engine }: { hover: HoverState; engine: CubeEngine }) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => new THREE.ShapeGeometry(frameShape(0.86, 0.8, 0.14, 0.11), 8), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useEffect(() => hover.subscribe(() => invalidate()), [hover, invalidate]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // The outline marks a lattice position, so hide it while any layer is moving.
    mesh.visible = hover.visible && !engine.isAnimating();
    if (mesh.visible) {
      mesh.position.copy(hover.position);
      mesh.quaternion.copy(hover.quaternion);
    }
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} visible={false} renderOrder={3} />;
}
