/**
 * Stickerless v2 resources, behind the same `StickerlessResources` seam as v1
 * (`CubeVisuals` owns them; `CubeModel` hangs `pieces[kind]` with
 * `materials[id]` on each cubie).
 *
 * The geometry is production's: the shared corner and edge meshes and, for
 * Gloss, the production chamfer centre on v2's plan (`V2_CENTRE_PLAN`), from the
 * same reference-counted caches. The finish and lighting are production's too:
 * the same material values and per-piece variation, and for Gloss the Strong
 * Hybrid shell response under the production stickerless lighting. v2 changes
 * the plastic a turn exposes and the shading (`material.ts`).
 *
 * Additions the seam carries for v2:
 *  - `onPieceRender`: set as each piece mesh's `onBeforeRender`, it gives the
 *    piece's material the mesh → cube transform for the analytic occlusion;
 *  - `setTurn`: the layer turn in flight (axis, layer, angle);
 *  - `setCells`: the puzzle state, for the colour each lattice cell shows
 *    across each axis (an opened cut face's bounce light comes from it) and
 *    each way (the near-field transport's mirrored and bounced plastic);
 *  - `coreFollowsSlices`: the mechanism core (with its six arms) turns with
 *    slice moves and whole-cube rotations, as a real core does.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FACES } from '../../../core/puzzle/notation';
import type { Face } from '../../../core/puzzle/notation';
import type { Finish } from '../../../core/persistence/settings';
import type { VisualTurn } from '../../../core/engine/cubeEngine';
import { prng } from '../../../core/audio/synth';
import { CUBIE_DEFS } from '../../../core/puzzle/cubies';
import type { CubieOrientations } from '../../../core/puzzle/cubies';
import { mulVec } from '../../../core/puzzle/geometry';
import { PIECE_FRAMES } from '../pieceFrames';
import { STICKERLESS_SHAPE } from '../pieceGeometry';
import { acquirePieceMeshes, releasePieceMeshes } from '../pieceMeshes';
import type { RenderTier } from '../renderTier';
import { STICKERLESS_CENTRE_MESH } from '../stickerlessCenterGeometry';
import { acquireStickerlessChamferGeometry, releaseStickerlessChamferGeometry } from '../stickerlessChamferGeometry';
import { applyStrongHybrid } from '../stickerlessHybrid';
import { PIECE_DETAIL } from '../stickerlessResources';
import type { StickerlessResources } from '../stickerlessResources';
import { KIND_INDEX, V2_CENTRE_PLAN } from './shape';
import { createMechanismMaterialV2, createPieceMaterialV2, createTurnUniforms } from './material';
import type { PieceMaterialV2 } from './material';
import { V2_MECHANISM, V2_PALETTE } from './palette';

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as const;

/** Core sphere and its six arms (to the centre caps). */
function buildMechanism(tier: RenderTier): THREE.BufferGeometry {
  const segments = tier === 'low' ? 12 : 24;
  const parts: THREE.BufferGeometry[] = [new THREE.SphereGeometry(0.4, segments * 2, segments)];
  for (const rotate of [(g: THREE.BufferGeometry) => g, (g: THREE.BufferGeometry) => g.rotateZ(Math.PI / 2), (g: THREE.BufferGeometry) => g.rotateX(Math.PI / 2)]) {
    parts.push(rotate(new THREE.CylinderGeometry(0.11, 0.11, 2.1, segments, 1, true)));
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  parts.forEach((g) => g.dispose());
  return merged;
}

export function createStickerlessV2Resources(tier: RenderTier, _finish: Finish): StickerlessResources {
  const detail = PIECE_DETAIL[tier];
  const shared = acquirePieceMeshes(STICKERLESS_SHAPE, detail, STICKERLESS_CENTRE_MESH);
  const pieces = { ...shared, center: acquireStickerlessChamferGeometry(detail, V2_CENTRE_PLAN) };
  const palette = Object.fromEntries(FACES.map((face) => [face, new THREE.Color(V2_PALETTE[face])])) as Record<Face, THREE.Color>;
  const turn = createTurnUniforms();
  // Production's deterministic per-piece finish variation (same seed and order).
  const vary = prng(4242);
  const materials: PieceMaterialV2[] = PIECE_FRAMES.map((frame) =>
    createPieceMaterialV2(
      KIND_INDEX[frame.kind],
      frame.slots.map((face) => (face ? palette[face] : null)),
      { tier, variation: { roughness: (vary() - 0.5) * 0.14, coat: (vary() - 0.5) * 0.4 } },
      turn,
    ),
  );
  const core = buildMechanism(tier);
  const coreMaterial = createMechanismMaterialV2(V2_MECHANISM);
  // Gloss: production's Strong Hybrid shell response and window lighting, on every tier.
  const diffuseEnvironment = { value: null as THREE.Texture | null };
  for (const material of materials) applyStrongHybrid(material, diffuseEnvironment);
  applyStrongHybrid(coreMaterial, diffuseEnvironment, false);
  const toCube = new THREE.Matrix4();
  const cubeToView = new THREE.Matrix4();
  const tintTexture = turn.uCellTint.value;
  const tintData = tintTexture.image.data as Uint8Array;
  const facesTexture = turn.uCellFace.value;
  const facesData = facesTexture.image.data as Uint8Array;
  const mechanism = new THREE.Color(V2_MECHANISM);
  let cells: CubieOrientations | null = null;

  function onPieceRender(this: THREE.Object3D, _renderer: THREE.WebGLRenderer, _scene: THREE.Scene, camera: THREE.Camera) {
    const material = (this as THREE.Mesh).material as PieceMaterialV2;
    // Mesh → cubie group → cube: the transform within the cube, turn included.
    const cube = this.parent?.parent;
    if (!cube || !material.pieceToCube) return;
    toCube.copy(cube.matrixWorld).invert();
    // Each piece has its own material, so three.js uploads its uniforms at every draw.
    material.pieceToCube.multiplyMatrices(toCube, this.matrixWorld);
    // The cube's frame as the camera drawing this piece sees it (rotation only).
    cubeToView.multiplyMatrices(camera.matrixWorldInverse, cube.matrixWorld);
    const e = turn.uCubeToView.value.setFromMatrix4(cubeToView).elements;
    for (let column = 0; column < 9; column += 3) {
      const length = Math.hypot(e[column]!, e[column + 1]!, e[column + 2]!) || 1;
      e[column] /= length;
      e[column + 1] /= length;
      e[column + 2] /= length;
    }
  }

  let disposed = false;
  return {
    pieces,
    materials,
    core,
    coreMaterial,
    coreFollowsSlices: true,
    onPieceRender,
    setExposure(value) {
      turn.uExposure.value = value;
    },
    setTurn(visual: VisualTurn | null) {
      turn.uTurnActive.value = visual ? 1 : 0;
      if (!visual) return;
      turn.uTurnAxis.value.copy(AXES[visual.axis]);
      turn.uTurnLayer.value = visual.layer === null ? 9 : visual.layer;
      setTurnBack(turn.uTurnBack.value, AXES[visual.axis], visual.angle);
    },
    setCells(cubies: CubieOrientations) {
      if (cubies === cells) return;
      cells = cubies;
      writeCellTints(tintData, cubies, palette, mechanism);
      tintTexture.needsUpdate = true;
      writeCellFaces(facesData, cubies, palette, mechanism);
      facesTexture.needsUpdate = true;
    },
    setEnvironment(texture, diffuse = null) {
      for (const m of materials) m.envMap = texture;
      coreMaterial.envMap = texture;
      diffuseEnvironment.value = diffuse ?? texture;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releasePieceMeshes(STICKERLESS_SHAPE, detail, STICKERLESS_CENTRE_MESH);
      releaseStickerlessChamferGeometry(detail, V2_CENTRE_PLAN);
      materials.forEach((m) => m.dispose());
      core.dispose();
      coreMaterial.dispose();
      tintTexture.dispose();
      facesTexture.dispose();
    },
  };
}

const rotation = new THREE.Matrix4();

/** `out` = the rotation from the cube's frame to a layer turned by `angle` about `axis`: back by the angle. */
export function setTurnBack(out: THREE.Matrix3, axis: THREE.Vector3, angle: number): THREE.Matrix3 {
  return out.setFromMatrix4(rotation.makeRotationAxis(axis, -angle));
}

/**
 * Fills the cell-tint table (`uCellTint`): for each lattice cell and axis, the
 * average linear colour of the piece now in that cell over its visible faces
 * not along that axis, which are the colours its internal faces across that
 * axis show. The empty centre cell shows the mechanism.
 */
export function writeCellTints(data: Uint8Array, cubies: CubieOrientations, palette: Readonly<Record<Face, THREE.Color>>, mechanism: THREE.Color): void {
  const put = (cell: number, axis: number, r: number, g: number, b: number) => {
    const i = (axis * 27 + cell) * 4;
    data[i] = Math.round(Math.min(1, r) * 255);
    data[i + 1] = Math.round(Math.min(1, g) * 255);
    data[i + 2] = Math.round(Math.min(1, b) * 255);
    data[i + 3] = 255;
  };
  for (let axis = 0; axis < 3; axis++) put(13, axis, mechanism.r, mechanism.g, mechanism.b);
  for (const def of CUBIE_DEFS) {
    const o = cubies[def.id]!;
    const [x, y, z] = mulVec(o, def.home);
    const cell = (x + 1) * 9 + (y + 1) * 3 + (z + 1);
    const faces = def.stickers.map((sticker) => ({ axis: mulVec(o, sticker.normal).findIndex((c) => c !== 0), color: palette[sticker.color] }));
    for (let axis = 0; axis < 3; axis++) {
      const across = faces.filter((f) => f.axis !== axis);
      const shown = across.length ? across : faces;
      const sum = shown.reduce((acc, f) => [acc[0]! + f.color.r, acc[1]! + f.color.g, acc[2]! + f.color.b], [0, 0, 0]);
      put(cell, axis, sum[0]! / shown.length, sum[1]! / shown.length, sum[2]! / shown.length);
    }
  }
}

/**
 * Fills the cell-face table (`uCellFace`): for each lattice cell, the linear
 * colour of the piece now in it facing each way (+X, −X, +Y, −Y, +Z, −Z;
 * alpha 255 where it has that outer face) and, in slot 6, the colour it shows
 * where it has just one face (a centre: its own; the empty centre cell: the
 * mechanism, in every slot).
 */
export function writeCellFaces(data: Uint8Array, cubies: CubieOrientations, palette: Readonly<Record<Face, THREE.Color>>, mechanism: THREE.Color): void {
  data.fill(0);
  const put = (cell: number, slot: number, color: THREE.Color) => {
    const i = (slot * 27 + cell) * 4;
    data[i] = Math.round(Math.min(1, color.r) * 255);
    data[i + 1] = Math.round(Math.min(1, color.g) * 255);
    data[i + 2] = Math.round(Math.min(1, color.b) * 255);
    data[i + 3] = 255;
  };
  for (let slot = 0; slot < 7; slot++) put(13, slot, mechanism);
  for (const def of CUBIE_DEFS) {
    const o = cubies[def.id]!;
    const [x, y, z] = mulVec(o, def.home);
    const cell = (x + 1) * 9 + (y + 1) * 3 + (z + 1);
    for (const sticker of def.stickers) {
      const normal = mulVec(o, sticker.normal);
      const axis = normal.findIndex((c) => c !== 0);
      put(cell, axis * 2 + (normal[axis]! > 0 ? 0 : 1), palette[sticker.color]);
    }
    put(cell, 6, palette[def.stickers[0]!.color]);
  }
}
