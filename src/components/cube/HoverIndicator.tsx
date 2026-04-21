/**
 * A faint outline on the piece face under the mouse, so the strip you are
 * about to grab — outer face or middle slice — is visible before you press.
 * The outline traces the piece's own shape (large cuts at the corners that
 * point at the face centre). Mouse only; hidden while anything animates,
 * during drags and on touch input.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CubeEngine } from '../../core/engine/cubeEngine';
import { INNER_RADIUS, PIECE_HALF } from './pieceGeometry';
import type { HoverState } from './hoverState';

const OUTER = PIECE_HALF - 0.035;
const WIDTH = 0.028;
const SMALL = 0.05;

/** Rounded rectangle path with a radius per quadrant: (+,+), (+,−), (−,+), (−,−). */
function roundedRect(path: THREE.Path, h: number, r: readonly number[]): void {
  const [pp, pm, mp, mm] = r as [number, number, number, number];
  path.moveTo(-h + mm, -h);
  path.lineTo(h - pm, -h);
  path.absarc(h - pm, -h + pm, pm, -Math.PI / 2, 0, false);
  path.lineTo(h, h - pp);
  path.absarc(h - pp, h - pp, pp, 0, Math.PI / 2, false);
  path.lineTo(-h + mp, h);
  path.absarc(-h + mp, h - mp, mp, Math.PI / 2, Math.PI, false);
  path.lineTo(-h, -h + mm);
  path.absarc(-h + mm, -h + mm, mm, Math.PI, Math.PI * 1.5, false);
}

/** Thin ring following a piece outline; `shape` bit i set = quadrant i is an inner (large) cut. */
function outlineRing(shape: number): THREE.ShapeGeometry {
  const radius = (inset: number) => [0, 1, 2, 3].map((i) => Math.max(0.01, (shape & (1 << i) ? INNER_RADIUS : SMALL) - inset));
  const outerInset = PIECE_HALF - OUTER;
  const ring = new THREE.Shape();
  roundedRect(ring, OUTER, radius(outerInset));
  const hole = new THREE.Path();
  roundedRect(hole, OUTER - WIDTH, radius(outerInset + WIDTH));
  ring.holes.push(hole);
  return new THREE.ShapeGeometry(ring, 12);
}

export function HoverIndicator({ hover, engine }: { hover: HoverState; engine: CubeEngine }) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.Mesh>(null);
  // All sixteen corner combinations, built once (only four occur on a 3×3).
  const geometries = useMemo(() => Array.from({ length: 16 }, (_, shape) => outlineRing(shape)), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(
    () => () => {
      geometries.forEach((g) => g.dispose());
      material.dispose();
    },
    [geometries, material],
  );
  useEffect(() => hover.subscribe(() => invalidate()), [hover, invalidate]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // The outline marks a lattice position, so hide it while any layer is moving.
    mesh.visible = hover.visible && !engine.isAnimating();
    if (mesh.visible) {
      mesh.geometry = geometries[hover.shape]!;
      mesh.position.copy(hover.position);
      mesh.quaternion.copy(hover.quaternion);
    }
  });

  return <mesh ref={meshRef} geometry={geometries[0]} material={material} visible={false} renderOrder={3} />;
}
