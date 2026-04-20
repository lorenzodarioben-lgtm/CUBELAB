/**
 * The rendered cube: 26 cubie groups with stable identities, each carrying its
 * own body and stickers. Every frame, each group's transform is rebuilt from
 * the committed integer state (position = O·home, rotation = O), plus — for the
 * nine pieces of the layer in flight — the engine's current visual rotation.
 * Nothing accumulates frame to frame, so there is no drift and no gaps.
 *
 * Each tile is seated individually, with a deterministic hair of tilt and
 * offset (well under a degree and a few hundredths of a millimetre at real
 * scale) and one of a few moulding variants, so neighbouring tiles catch the
 * studio reflections slightly differently, as on a physical cube.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CubeEngine } from '../../core/engine/cubeEngine';
import type { CubeState } from '../../core/puzzle/cubeState';
import { CUBIE_DEFS } from '../../core/puzzle/cubies';
import { mulVec } from '../../core/puzzle/geometry';
import type { Face } from '../../core/puzzle/notation';
import type { Finish } from '../../core/persistence/settings';
import { SPACING, STICKER_OFFSET, TILE_TOP, TILE_VARIANTS, createCubeResources, seededRandom } from './cubeResources';
import type { RenderTier } from './cubeResources';

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as const;
const Z = new THREE.Vector3(0, 0, 1);
/** Largest tile tilt (radians, ≈0.45°) and in-plane offset (world units). */
const TILT = 0.008;
const SHIFT = 0.0035;

function stickerQuaternion(normal: readonly number[]): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(Z, new THREE.Vector3(normal[0], normal[1], normal[2]));
}

interface TileSeat {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly variant: number;
}

/** A tile's deterministic seat on its piece: nominal pose plus a tiny tilt and shift. */
function tileSeat(normal: readonly number[], rand: () => number): TileSeat {
  const quaternion = stickerQuaternion(normal);
  const angle = rand() * Math.PI * 2;
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0), TILT * Math.sqrt(rand()));
  const shift = new THREE.Vector3((rand() - 0.5) * 2 * SHIFT, (rand() - 0.5) * 2 * SHIFT, 0).applyQuaternion(quaternion);
  return {
    position: new THREE.Vector3(normal[0], normal[1], normal[2]).multiplyScalar(STICKER_OFFSET).add(shift),
    quaternion: quaternion.multiply(tilt),
    variant: Math.floor(rand() * TILE_VARIANTS),
  };
}

export interface StickerRegistry {
  readonly meshes: THREE.Mesh[];
}

interface CubeModelProps {
  readonly engine: CubeEngine;
  readonly quality: RenderTier;
  readonly finish: Finish;
  readonly faceLabels: boolean;
  readonly registry: StickerRegistry;
}

export function CubeModel({ engine, quality, finish, faceLabels, registry }: CubeModelProps) {
  const invalidate = useThree((s) => s.invalidate);
  const groups = useRef<Array<THREE.Group | null>>([]);
  const resources = useMemo(() => createCubeResources(quality, finish), [quality, finish]);
  useEffect(() => () => resources.dispose(), [resources]);

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
    const visual = engine.getVisualTurn(now);
    scratch.inLayer.fill(false);
    if (visual) {
      for (const id of visual.cubies) scratch.inLayer[id] = true;
      scratch.q.setFromAxisAngle(AXES[visual.axis], visual.angle);
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

  const stickers = useMemo(() => {
    const rand = seededRandom(2024);
    return CUBIE_DEFS.map((def) => def.stickers.map((s) => ({ color: s.color as Face, ...tileSeat(s.normal, rand) })));
  }, []);

  // Sticker meshes register themselves for the debug/verification API and
  // unregister via React 19 ref cleanups when they unmount.
  const registerSticker = useCallback(
    (mesh: THREE.Mesh | null) => {
      if (!mesh) return;
      registry.meshes.push(mesh);
      return () => {
        const index = registry.meshes.indexOf(mesh);
        if (index >= 0) registry.meshes.splice(index, 1);
      };
    },
    [registry],
  );

  const shadows = resources.shadows;
  return (
    <group name="cube">
      {/* The mechanism's dark core: only ever glimpsed through seams mid-turn. */}
      <mesh geometry={resources.core} material={resources.coreMaterial} />
      {CUBIE_DEFS.map((def) => (
        <group
          key={def.id}
          name={`cubie-${def.name}`}
          ref={(g) => {
            groups.current[def.id] = g;
          }}
          userData={{ cubie: def.id }}
        >
          <mesh geometry={resources.body} material={resources.bodyMaterial} castShadow={shadows} receiveShadow={shadows} />
          {stickers[def.id]!.map((s, i) => (
            <group key={i} position={s.position} quaternion={s.quaternion}>
              <mesh
                ref={registerSticker}
                geometry={resources.sticker}
                material={resources.stickerMaterials[s.color][s.variant]}
                userData={{ color: s.color, cubie: def.id }}
                castShadow={shadows}
                receiveShadow={shadows}
              />
              {faceLabels && (
                <mesh geometry={resources.label} material={resources.labelMaterials[s.color]} position-z={TILE_TOP + 0.0006} renderOrder={2} />
              )}
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}
