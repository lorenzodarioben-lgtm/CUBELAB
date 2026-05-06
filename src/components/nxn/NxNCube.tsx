import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as THREE from 'three';
import { FACE_COLORS } from '../../core/puzzle/colors';
import { faceFromNormal, mulVec } from '../../core/puzzle/geometry';
import type { Vec3 } from '../../core/puzzle/geometry';
import type { Face } from '../../core/puzzle/notation';
import { piecePosition } from '../../core/nxn/model';
import { isPieceInMove, moveAxis, moveQuarterTurns } from '../../core/nxn/model';
import type { NxState } from '../../core/nxn/model';
import type { NxMove } from '../../core/nxn/model';
import { easeSnap } from '../../core/engine/cubeEngine';

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
const FRONT = new THREE.Vector3(0, 0, 1);

function orientationQuaternion(matrix: NxState['orientations'][number]): THREE.Quaternion {
  const m = new THREE.Matrix4().set(
    matrix[0], matrix[1], matrix[2], 0,
    matrix[3], matrix[4], matrix[5], 0,
    matrix[6], matrix[7], matrix[8], 0,
    0, 0, 0, 1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function normalQuaternion(normal: Vec3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(FRONT, new THREE.Vector3(...normal));
}

export interface NxNCubeProps {
  readonly state: NxState;
  readonly active: { readonly token: number; readonly move: NxMove; readonly durationMs: number } | null;
  readonly onTurn: (face: Face, inverse: boolean) => void;
  readonly onTurnComplete: (token: number) => void;
}

/** Rounded, separate injection-moulded caps over a dark moving mechanism. */
export function NxNCube({ state, active, onTurn, onTurnComplete }: NxNCubeProps) {
  const cell = 3.24 / state.size;
  const invalidate = useThree((scene) => scene.invalidate);
  const pieceGroups = useRef<Array<THREE.Group | null>>([]);
  const motion = useRef({ token: -1, startedAt: 0, completed: false });
  const turnRotation = useMemo(() => new THREE.Quaternion(), []);
  const axisVector = useMemo(() => new THREE.Vector3(), []);
  const resources = useMemo(() => {
    const body = new RoundedBoxGeometry(cell * 0.91, cell * 0.91, cell * 0.91, 3, cell * 0.075);
    const cap = new RoundedBoxGeometry(cell * 0.94, cell * 0.94, cell * 0.18, 4, cell * 0.065);
    const core = new THREE.MeshPhysicalMaterial({
      color: '#101216', roughness: 0.28, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.13,
    });
    const caps = Object.fromEntries(FACES.map((face) => [face, new THREE.MeshPhysicalMaterial({
      color: FACE_COLORS[face].hex,
      roughness: 0.25,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.07,
      envMapIntensity: 1.25,
    })])) as Record<Face, THREE.MeshPhysicalMaterial>;
    return { body, cap, core, caps };
  }, [cell]);

  useEffect(() => () => {
    resources.body.dispose();
    resources.cap.dispose();
    resources.core.dispose();
    Object.values(resources.caps).forEach((material) => material.dispose());
  }, [resources]);

  const capPos = cell * 0.424;
  const transforms = useMemo(() => state.pieces.map((piece) => {
    const coordinate = piecePosition(state, piece.id);
    return {
      position: coordinate.map((value) => value * cell / 2) as [number, number, number],
      rotation: orientationQuaternion(state.orientations[piece.id]!),
    };
  }), [state, cell]);

  useEffect(() => { if (active) invalidate(); }, [active, invalidate]);
  useEffect(() => {
    if (active) return;
    state.pieces.forEach((piece) => {
      const group = pieceGroups.current[piece.id];
      const base = transforms[piece.id];
      if (!group || !base) return;
      group.position.set(...base.position);
      group.quaternion.copy(base.rotation);
    });
    invalidate();
  }, [active, state, transforms, invalidate]);

  useFrame(() => {
    if (!active) return;
    if (motion.current.token !== active.token) {
      motion.current = { token: active.token, startedAt: performance.now(), completed: false };
    }
    const progress = active.durationMs === 0 ? 1 : Math.min(1, (performance.now() - motion.current.startedAt) / active.durationMs);
    const axis = moveAxis(active.move);
    axisVector.set(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
    turnRotation.setFromAxisAngle(axisVector, easeSnap(progress) * moveQuarterTurns(active.move) * Math.PI / 2);
    for (const piece of state.pieces) {
      if (!isPieceInMove(state, piece.id, active.move)) continue;
      const group = pieceGroups.current[piece.id];
      if (!group) continue;
      const base = transforms[piece.id]!;
      group.position.set(...base.position).applyQuaternion(turnRotation);
      group.quaternion.copy(turnRotation).multiply(base.rotation);
    }
    if (progress < 1) invalidate();
    else if (!motion.current.completed) {
      motion.current.completed = true;
      queueMicrotask(() => onTurnComplete(active.token));
    }
  });

  return (
    <group name={`nxn-${state.size}`}>
      {state.pieces.map((piece) => (
        <group
          key={piece.id}
          ref={(group) => { pieceGroups.current[piece.id] = group; }}
          position={transforms[piece.id]!.position}
          quaternion={transforms[piece.id]!.rotation}
        >
          <mesh geometry={resources.body} material={resources.core} castShadow receiveShadow />
          {piece.stickers.map((sticker) => (
            <mesh
              key={sticker.color}
              geometry={resources.cap}
              material={resources.caps[sticker.color]}
              position={sticker.normal.map((value) => value * capPos) as [number, number, number]}
              quaternion={normalQuaternion(sticker.normal)}
              castShadow
              receiveShadow
              onClick={(event) => {
                event.stopPropagation();
                const currentNormal = mulVec(state.orientations[piece.id]!, sticker.normal);
                onTurn(faceFromNormal(currentNormal), event.shiftKey);
              }}
              onPointerOver={(event) => {
                event.stopPropagation();
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => { document.body.style.cursor = ''; }}
            />
          ))}
        </group>
      ))}
    </group>
  );
}
