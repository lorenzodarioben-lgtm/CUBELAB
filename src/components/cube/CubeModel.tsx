/**
 * The rendered cube: 26 cubie groups with stable identities, shared by both
 * cube styles. Every frame, each group's transform is rebuilt from the
 * committed integer state (position = O·home, rotation = O), plus — for the
 * pieces of the layer in flight — the engine's current visual rotation.
 * Nothing accumulates frame to frame, so there is no drift and no gaps.
 *
 * A cube style only decides what hangs on each group: the Classic Stickered
 * body and tiles, or the Premium Stickerless moulded piece. Because the
 * groups (and so every transform, including a turn in flight) are untouched by
 * a style change, switching is safe at any moment, mid-turn included: the new
 * model simply appears on the same groups in the same pose on the next frame.
 *
 * Each group also carries an invisible anchor per facelet, independent of the
 * style, for the verification read-back.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CubeEngine } from '../../core/engine/cubeEngine';
import type { CubeState } from '../../core/puzzle/cubeState';
import { CUBIE_DEFS } from '../../core/puzzle/cubies';
import type { CubieDef } from '../../core/puzzle/cubies';
import { mulVec } from '../../core/puzzle/geometry';
import type { Face } from '../../core/puzzle/notation';
import type { CubeStyle } from '../../core/persistence/settings';
import { ANCHOR_OFFSET, SPACING } from './cubeResources';
import type { CubeVisuals } from './cubeResources';
import type { StyleReflections } from './styleReflections';
import { PIECE_FRAMES } from './pieceFrames';
import { TILE_SEATS, TILE_TOP } from './stickeredResources';
import { STICKERLESS_SURFACE } from './stickerlessResources';

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as const;
const Z = new THREE.Vector3(0, 0, 1);

/** Each facelet's anchor: on the cubie's face plane, +Z along the outward normal. */
const ANCHORS = CUBIE_DEFS.map((def) =>
  def.stickers.map((s) => ({
    color: s.color as Face,
    position: new THREE.Vector3(s.normal[0], s.normal[1], s.normal[2]).multiplyScalar(ANCHOR_OFFSET),
    quaternion: new THREE.Quaternion().setFromUnitVectors(Z, new THREE.Vector3(s.normal[0], s.normal[1], s.normal[2])),
  })),
);

/** Face letters on the stickerless pieces sit just above the pillowed surface. */
const STICKERLESS_LABEL_Z = STICKERLESS_SURFACE - ANCHOR_OFFSET + 0.0015;

export interface StickerRegistry {
  /** One anchor per facelet, carrying `userData.color`; moves with its cubie. */
  readonly meshes: THREE.Object3D[];
}

interface PieceProps {
  readonly def: CubieDef;
  readonly visuals: CubeVisuals;
  readonly faceLabels: boolean;
}

/** Classic Stickered: a moulded black body (its canonical shape turned to this cubie) with one shaped sticker per visible face. */
function StickeredPiece({ def, visuals, faceLabels }: PieceProps) {
  const res = visuals.stickered;
  const shadows = visuals.shadows;
  return (
    <>
      <mesh
        geometry={res.bodies[def.kind]}
        material={res.bodyMaterials[def.kind]}
        quaternion={PIECE_FRAMES[def.id]!.quaternion}
        castShadow={shadows}
        receiveShadow={shadows}
      />
      {TILE_SEATS[def.id]!.map((seat, i) => (
        <group key={i} position={seat.position} quaternion={seat.quaternion}>
          <mesh geometry={res.tiles[seat.shape]} material={res.tileMaterials[seat.color][seat.variant]} receiveShadow={shadows} />
          {faceLabels && (
            <mesh geometry={visuals.label} material={visuals.labelMaterials[seat.color]} position-z={TILE_TOP + 0.0006} renderOrder={2} />
          )}
        </group>
      ))}
    </>
  );
}

/** Premium Stickerless: one moulded piece, its canonical shape turned to this cubie's home pose. */
function StickerlessPiece({ def, visuals, faceLabels }: PieceProps) {
  const res = visuals.stickerless;
  const shadows = visuals.shadows;
  return (
    <>
      <mesh
        geometry={res.pieces[def.kind]}
        material={res.materials[def.id]}
        quaternion={PIECE_FRAMES[def.id]!.quaternion}
        castShadow={shadows}
        receiveShadow={shadows}
        {...(res.onPieceRender ? { onBeforeRender: res.onPieceRender } : {})}
      />
      {faceLabels &&
        ANCHORS[def.id]!.map((a, i) => (
          <group key={i} position={a.position} quaternion={a.quaternion}>
            <mesh geometry={visuals.label} material={visuals.labelMaterials[a.color]} position-z={STICKERLESS_LABEL_Z} renderOrder={2} />
          </group>
        ))}
    </>
  );
}

interface CubeModelProps {
  readonly engine: CubeEngine;
  /** The resources for the tier and finish on screen (owned by the stage, which prepares their shaders). */
  readonly visuals: CubeVisuals;
  readonly style: CubeStyle;
  readonly faceLabels: boolean;
  readonly registry: StickerRegistry;
  readonly reflections: StyleReflections;
}

export function CubeModel({ engine, visuals, style, faceLabels, registry, reflections }: CubeModelProps) {
  const invalidate = useThree((s) => s.invalidate);
  const groups = useRef<Array<THREE.Group | null>>([]);
  const coreRef = useRef<THREE.Mesh>(null);
  // A style change only swaps meshes; ask for a frame so it shows at once.
  useEffect(() => invalidate(), [style, invalidate]);

  // Per-frame working memory lives in refs: allocated once, mutated only inside useFrame.
  const baseRef = useRef(CUBIE_DEFS.map(() => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() })));
  const lastState = useRef<CubeState | null>(null);
  const scratchRef = useRef({ q: new THREE.Quaternion(), m: new THREE.Matrix4(), inLayer: new Array<boolean>(26).fill(false) });

  useEffect(() => engine.subscribe(() => invalidate()), [engine, invalidate]);

  useFrame(() => {
    const base = baseRef.current;
    const scratch = scratchRef.current;
    const now = performance.now();
    engine.tick(now);
    const state = engine.state;
    if (state !== lastState.current) {
      lastState.current = state;
      for (const def of CUBIE_DEFS) {
        const o = state.cubies[def.id]!;
        const p = mulVec(o, def.home);
        base[def.id]!.position.set(p[0] * SPACING, p[1] * SPACING, p[2] * SPACING);
        scratch.m.set(o[0], o[1], o[2], 0, o[3], o[4], o[5], 0, o[6], o[7], o[8], 0, 0, 0, 0, 1);
        base[def.id]!.quaternion.setFromRotationMatrix(scratch.m);
      }
    }
    visuals.setStickerlessEnvironment(reflections.stickerless, reflections.stickerlessDiffuse);
    const visual = engine.getVisualTurn(now);
    // A layer part-way round opens the cube (whole-cube rotations open nothing).
    visuals.setTurnExposure(visual && visual.layer !== null ? Math.abs(Math.sin(2 * visual.angle)) : 0);
    visuals.setTurnState(visual);
    visuals.setCubeCells(state.cubies);
    scratch.inLayer.fill(false);
    if (visual) {
      for (const id of visual.cubies) scratch.inLayer[id] = true;
      scratch.q.setFromAxisAngle(AXES[visual.axis], visual.angle);
    }
    // A core with arms (Stickerless v2) turns with slices and whole-cube rotations; its
    // six arms look the same after any quarter turn, so it needs no committed orientation.
    const coreMesh = coreRef.current;
    if (coreMesh?.userData.followsSlices) {
      if (visual && (visual.layer === 0 || visual.layer === null)) coreMesh.quaternion.copy(scratch.q);
      else coreMesh.quaternion.identity();
    }
    for (const def of CUBIE_DEFS) {
      const group = groups.current[def.id];
      if (!group) continue;
      const b = base[def.id]!;
      if (visual && scratch.inLayer[def.id]) {
        group.position.copy(b.position).applyQuaternion(scratch.q);
        group.quaternion.copy(scratch.q).multiply(b.quaternion);
      } else {
        group.position.copy(b.position);
        group.quaternion.copy(b.quaternion);
      }
    }
    if (engine.isAnimating()) invalidate();
  });

  // Facelet anchors register themselves for the debug/verification API and
  // unregister via React 19 ref cleanups when they unmount.
  const registerAnchor = useCallback(
    (anchor: THREE.Object3D | null) => {
      if (!anchor) return;
      registry.meshes.push(anchor);
      return () => {
        const index = registry.meshes.indexOf(anchor);
        if (index >= 0) registry.meshes.splice(index, 1);
      };
    },
    [registry],
  );

  const Piece = style === 'stickered' ? StickeredPiece : StickerlessPiece;
  const core = style === 'stickered' ? visuals.stickered : visuals.stickerless;
  return (
    <group name="cube" userData={{ style }}>
      {/* The mechanism's dark core: only ever glimpsed between layers mid-turn. */}
      <mesh
        ref={coreRef}
        geometry={core.core}
        material={core.coreMaterial}
        userData={{ followsSlices: style === 'stickerless' && visuals.stickerless.coreFollowsSlices === true }}
      />
      {CUBIE_DEFS.map((def) => (
        <group
          key={def.id}
          name={`cubie-${def.name}`}
          ref={(g) => {
            groups.current[def.id] = g;
          }}
          userData={{ cubie: def.id }}
        >
          <Piece def={def} visuals={visuals} faceLabels={faceLabels} />
          {ANCHORS[def.id]!.map((a, i) => (
            <group key={i} ref={registerAnchor} position={a.position} quaternion={a.quaternion} userData={{ color: a.color, cubie: def.id }} />
          ))}
        </group>
      ))}
    </group>
  );
}
