/**
 * A faint outline on the facelet under the mouse, so the strip you are about
 * to grab — outer face or middle slice — is visible before you press. It
 * follows the shown cube style: a ring around the raised tile on the Classic
 * Stickered cube, the piece's own outline (with its piece-specific cuts at the
 * corners that point at the face centre) on the Premium Stickerless cube.
 * Mouse only; hidden while anything animates, during drags and on touch input.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CubeEngine } from '../../core/engine/cubeEngine';
import type { CubeStyle } from '../../core/persistence/settings';
import { ANCHOR_OFFSET, SURFACE_OFFSET } from './cubeResources';
import { PIECE_HALF, outlineCorner } from './pieceGeometry';
import type { OutlineCorner, PieceKind } from './pieceGeometry';
import type { HoverState } from './hoverState';

const KINDS: readonly PieceKind[] = ['center', 'edge', 'corner'];
const RING_INSET = 0.035;
const RING_WIDTH = 0.028;
/** Visual minimum radius for the ring's small corners. */
const SMALL = 0.05;

/**
 * Closed outline of a rounded rectangle (half-size h) with a corner per
 * quadrant (+,+), (+,−), (−,+), (−,−), each a superellipse of its own radius
 * and exponent, inset by `inset` from the piece edge. Traced counter-clockwise.
 */
function outlinePath(path: THREE.Path, h: number, corners: readonly OutlineCorner[], inset: number): void {
  const steps = 12;
  // Quadrant order around the loop: (+,−) → (+,+) → (−,+) → (−,−).
  const loop: Array<[number, number, OutlineCorner]> = [
    [1, -1, corners[1]!],
    [1, 1, corners[0]!],
    [-1, 1, corners[2]!],
    [-1, -1, corners[3]!],
  ];
  const points: THREE.Vector2[] = [];
  loop.forEach(([sx, sy, corner], q) => {
    const r = Math.max(corner.exponent === 2 ? SMALL : 0.01, corner.radius - inset);
    const e = corner.exponent;
    const cx = sx * (h - r);
    const cy = sy * (h - r);
    // Sweep this quadrant's corner from its first side to its second, counter-clockwise.
    const start = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][q]!;
    for (let i = 0; i <= steps; i++) {
      const t = start + (i / steps) * (Math.PI / 2);
      const c = Math.cos(t);
      const s = Math.sin(t);
      const x = Math.sign(c) * Math.abs(c) ** (2 / e);
      const y = Math.sign(s) * Math.abs(s) ** (2 / e);
      points.push(new THREE.Vector2(cx + r * x, cy + r * y));
    }
  });
  path.setFromPoints(points);
  path.closePath();
}

function ring(h: number, corners: readonly OutlineCorner[]): THREE.ShapeGeometry {
  const outer = new THREE.Shape();
  outlinePath(outer, h - RING_INSET, corners, RING_INSET);
  const hole = new THREE.Path();
  outlinePath(hole, h - RING_INSET - RING_WIDTH, corners, RING_INSET + RING_WIDTH);
  outer.holes.push(hole);
  return new THREE.ShapeGeometry(outer);
}

/** Ring following a stickerless piece outline; `shape` bit i set = quadrant i is cut. */
function stickerlessRing(kind: PieceKind, shape: number): THREE.ShapeGeometry {
  return ring(
    PIECE_HALF,
    [0, 1, 2, 3].map((i) => outlineCorner(kind, (shape & (1 << i)) !== 0)),
  );
}

/** Ring just outside a Classic Stickered tile (a rounded square). */
function stickeredRing(): THREE.ShapeGeometry {
  const corner: OutlineCorner = { radius: 0.14, exponent: 2 };
  return ring(0.43 + RING_INSET, [corner, corner, corner, corner]);
}

export function HoverIndicator({ hover, engine, style }: { hover: HoverState; engine: CubeEngine; style: CubeStyle }) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.Mesh>(null);
  // Every outline the indicator can show, built once: one for the tiles and,
  // per piece kind, the sixteen corner combinations (four occur on a 3×3).
  const geometries = useMemo(
    () => ({
      stickered: stickeredRing(),
      stickerless: Object.fromEntries(KINDS.map((kind) => [kind, Array.from({ length: 16 }, (_, shape) => stickerlessRing(kind, shape))])) as Record<
        PieceKind,
        THREE.ShapeGeometry[]
      >,
    }),
    [],
  );
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(
    () => () => {
      geometries.stickered.dispose();
      Object.values(geometries.stickerless).forEach((set) => set.forEach((g) => g.dispose()));
      material.dispose();
    },
    [geometries, material],
  );
  useEffect(() => hover.subscribe(() => invalidate()), [hover, invalidate]);

  // Lifted from the face plane to just above the shown style's surface.
  const lift = SURFACE_OFFSET[style] - ANCHOR_OFFSET + 0.004;
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // The outline marks a lattice position, so hide it while any layer is moving.
    mesh.visible = hover.visible && !engine.isAnimating();
    if (mesh.visible) {
      mesh.geometry = style === 'stickered' ? geometries.stickered : geometries.stickerless[hover.kind][hover.shape]!;
      mesh.position.copy(hover.position);
      mesh.quaternion.copy(hover.quaternion);
      mesh.translateZ(lift);
    }
  });

  return <mesh ref={meshRef} geometry={geometries.stickered} material={material} visible={false} renderOrder={3} />;
}
