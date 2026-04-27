/**
 * A faint outline on the facelet under the mouse, so the strip you are about
 * to grab — outer face or middle slice — is visible before you press. It
 * follows the shown cube style: a ring around the shaped sticker on the Classic
 * Stickered cube, the piece's own outline (round cuts on centres and edges, a
 * crisp corner on corner pieces) on the Premium Stickerless cube.
 * Mouse only; hidden while anything animates, during drags and on touch input.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CubeEngine } from '../../core/engine/cubeEngine';
import type { CubeStyle } from '../../core/persistence/settings';
import { ANCHOR_OFFSET, SURFACE_OFFSET } from './cubeResources';
import { PIECE_HALF, facePillow, outlineCornerRadius } from './pieceGeometry';
import type { PieceKind } from './pieceGeometry';
import type { HoverState } from './hoverState';
import { STICKER_HALF, stickerRadii } from './stickeredResources';

const KINDS: readonly PieceKind[] = ['center', 'edge', 'corner'];
const RING_INSET = 0.035;
const RING_WIDTH = 0.028;
/** Visual minimum radius for the ring's corners. */
const SMALL = 0.05;

/**
 * Rounded rectangle (half-size h) with a radius per quadrant (+,+), (+,−),
 * (−,+), (−,−), each reduced by `inset` so the path runs parallel to the piece
 * outline. Traced counter-clockwise.
 */
function outlinePath(path: THREE.Path, h: number, radii: readonly number[], inset: number): void {
  const [pp, pm, mp, mm] = radii.map((r) => Math.max(SMALL - inset * 0.5, r - inset)) as [number, number, number, number];
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

function ring(h: number, radii: readonly number[]): THREE.ShapeGeometry {
  const outer = new THREE.Shape();
  outlinePath(outer, h - RING_INSET, radii, RING_INSET);
  const hole = new THREE.Path();
  outlinePath(hole, h - RING_INSET - RING_WIDTH, radii, RING_INSET + RING_WIDTH);
  outer.holes.push(hole);
  return new THREE.ShapeGeometry(outer, 12);
}

/** Gap between an outline and the surface it lies on. */
const HOVER_GAP = 0.004;

/**
 * Ring following a stickerless piece outline; `shape` bit i set = quadrant i
 * points at the face centre. Its vertices are lifted onto the face's dome, so
 * the ring hugs the surface instead of floating at the dome's peak.
 */
function stickerlessRing(kind: PieceKind, shape: number): THREE.ShapeGeometry {
  const geometry = ring(
    PIECE_HALF,
    [0, 1, 2, 3].map((i) => outlineCornerRadius(kind, (shape & (1 << i)) !== 0)),
  );
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) position.setZ(i, facePillow(position.getX(i), position.getY(i)) + HOVER_GAP);
  return geometry;
}

/** Gap between a Classic Stickered sticker's edge and the ring around it. */
const STICKER_MARGIN = 0.012;

/** Ring just outside a Classic Stickered sticker, following its shaped outline. */
function stickeredRing(kind: PieceKind, shape: number): THREE.ShapeGeometry {
  const grow = RING_INSET + STICKER_MARGIN;
  return ring(
    STICKER_HALF + grow,
    stickerRadii(kind, shape).map((r) => r + grow),
  );
}

export function HoverIndicator({ hover, engine, style }: { hover: HoverState; engine: CubeEngine; style: CubeStyle }) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.Mesh>(null);
  // Every outline the indicator can show, built once: one for the tiles and,
  // per piece kind, the sixteen corner combinations (four occur on a 3×3).
  const geometries = useMemo(
    () => ({
      stickered: Object.fromEntries(KINDS.map((kind) => [kind, Array.from({ length: 16 }, (_, shape) => stickeredRing(kind, shape))])) as Record<
        PieceKind,
        THREE.ShapeGeometry[]
      >,
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
      Object.values(geometries.stickered).forEach((set) => set.forEach((g) => g.dispose()));
      Object.values(geometries.stickerless).forEach((set) => set.forEach((g) => g.dispose()));
      material.dispose();
    },
    [geometries, material],
  );
  useEffect(() => hover.subscribe(() => invalidate()), [hover, invalidate]);

  // Lifted from the face plane: to just above the flat tile, or to the face
  // plane of a stickerless piece (its ring already follows the dome).
  const lift = style === 'stickered' ? SURFACE_OFFSET.stickered - ANCHOR_OFFSET + HOVER_GAP : PIECE_HALF - ANCHOR_OFFSET;
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // The outline marks a lattice position, so hide it while any layer is moving.
    mesh.visible = hover.visible && !engine.isAnimating();
    if (mesh.visible) {
      mesh.geometry = geometries[style][hover.kind][hover.shape]!;
      mesh.position.copy(hover.position);
      mesh.quaternion.copy(hover.quaternion);
      mesh.translateZ(lift);
    }
  });

  return <mesh ref={meshRef} geometry={geometries.stickerless.center[15]} material={material} visible={false} renderOrder={3} />;
}
