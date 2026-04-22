/**
 * Material for stickerless pieces: colour comes from the plastic, not from a
 * sticker, so it is decided per fragment from the piece's own geometry.
 *
 * In the piece's canonical frame each visible face has a coloured cap of depth
 * CAP_DEPTH; everything deeper is black mechanism plastic. A point takes the
 * colour of the cap it lies in; where two caps meet on a rounded cube edge the
 * one it is further into wins, so colours meet on the edge's 45° line, exactly
 * like moulded two-shot parts. Boundaries are anti-aliased with screen-space
 * derivatives, so they stay crisp at any tessellation.
 *
 * The same lookup drives: lower, satin roughness for the black internals; a
 * thinner coat on black; a faint, low-frequency roughness drift so the plastic
 * never looks synthetic; a cavity term — light falls off with depth below
 * the nearest visible face — that keeps the openings at the diagonals and the
 * insides exposed mid-turn reading as deep mechanism instead of lit grey; and
 * a seam term — surfaces facing into a neighbouring piece's cell are shaded by
 * that piece — so seams read as tight dark lines and never sparkle, with or
 * without shadow maps.
 */
import * as THREE from 'three';
import type { Finish } from '../../core/persistence/settings';
import { CAP_DEPTH, PIECE_HALF } from './pieceGeometry';
import type { RenderTier } from './renderTier';


/** Canonical face slots: +X, −X, +Y, −Y, +Z, −Z. */
export const FACE_SLOTS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vPiecePos;
varying vec3 vPieceNormal;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec3 uFaceColor[6];
uniform float uFaceOn[6];
uniform vec3 uBlack;
uniform float uBlackRoughness;
uniform float uBlackCoat;
uniform float uSeed;
varying vec3 vPiecePos;
varying vec3 vPieceNormal;

float pieceHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float pieceNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(pieceHash(i), pieceHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(pieceHash(i + vec3(0.0, 1.0, 0.0)), pieceHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(pieceHash(i + vec3(0.0, 0.0, 1.0)), pieceHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(pieceHash(i + vec3(0.0, 1.0, 1.0)), pieceHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}
`;

const COLOUR = /* glsl */ `
#include <color_fragment>
float pieceHeights[6];
pieceHeights[0] = vPiecePos.x;
pieceHeights[1] = -vPiecePos.x;
pieceHeights[2] = vPiecePos.y;
pieceHeights[3] = -vPiecePos.y;
pieceHeights[4] = vPiecePos.z;
pieceHeights[5] = -vPiecePos.z;
// The black body competes with a fixed score: it wins below every cap.
float pieceBest = ${(PIECE_HALF - CAP_DEPTH).toFixed(4)};
vec3 pieceBestColor = uBlack;
float pieceBestCap = 0.0;
float pieceSecond = -10.0;
vec3 pieceSecondColor = uBlack;
float pieceSecondCap = 0.0;
float pieceDepth = 10.0;
for (int i = 0; i < 6; i++) {
  if (uFaceOn[i] < 0.5) continue;
  float h = pieceHeights[i];
  pieceDepth = min(pieceDepth, ${PIECE_HALF.toFixed(4)} - h);
  if (h > pieceBest) {
    pieceSecond = pieceBest;
    pieceSecondColor = pieceBestColor;
    pieceSecondCap = pieceBestCap;
    pieceBest = h;
    pieceBestColor = uFaceColor[i];
    pieceBestCap = 1.0;
  } else if (h > pieceSecond) {
    pieceSecond = h;
    pieceSecondColor = uFaceColor[i];
    pieceSecondCap = 1.0;
  }
}
float pieceGap = pieceBest - pieceSecond;
float pieceBlend = 0.5 + 0.5 * smoothstep(0.0, max(fwidth(pieceGap) * 1.25, 1e-5), pieceGap);
float pieceCap = mix(pieceSecondCap, pieceBestCap, pieceBlend);
diffuseColor.rgb = mix(pieceSecondColor, pieceBestColor, pieceBlend);
float pieceCavity = mix(1.0, 0.12, smoothstep(0.012, 0.2, pieceDepth));
// How squarely the surface faces a hidden side, i.e. a neighbouring piece.
vec3 pieceN = normalize(vPieceNormal);
float pieceFacing[6];
pieceFacing[0] = pieceN.x;
pieceFacing[1] = -pieceN.x;
pieceFacing[2] = pieceN.y;
pieceFacing[3] = -pieceN.y;
pieceFacing[4] = pieceN.z;
pieceFacing[5] = -pieceN.z;
float pieceHidden = 0.0;
for (int i = 0; i < 6; i++) {
  if (uFaceOn[i] < 0.5) pieceHidden = max(pieceHidden, pieceFacing[i]);
}
float pieceSeam = 1.0 - smoothstep(0.08, 0.6, pieceHidden);
`;

const ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(uBlackRoughness, roughnessFactor, pieceCap) * (0.9 + 0.2 * pieceNoise(vPiecePos * 5.0 + uSeed));
`;

const COAT = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= mix(uBlackCoat, 1.0, pieceCap);
#endif
`;

const CAVITY = /* glsl */ `
#include <aomap_fragment>
// Reflections are occluded less than diffuse light, so glossy black plastic
// exposed mid-turn still shows its form instead of reading as a void.
float pieceDirect = mix(1.0, pieceCavity, 0.7);
float pieceSheen = mix(pieceCavity, 1.0, 0.3);
float pieceSeamSpecular = mix(0.03, 1.0, pieceSeam);
reflectedLight.indirectDiffuse *= pieceCavity * mix(0.6, 1.0, pieceSeam);
reflectedLight.indirectSpecular *= pieceSheen * mix(0.22, 1.0, pieceSeam);
reflectedLight.directDiffuse *= pieceDirect * mix(0.45, 1.0, pieceSeam);
reflectedLight.directSpecular *= pieceDirect * pieceSeamSpecular;
#ifdef USE_CLEARCOAT
  clearcoatSpecularIndirect *= pieceSheen * mix(0.22, 1.0, pieceSeam);
  clearcoatSpecularDirect *= pieceDirect * pieceSeamSpecular;
#endif
`;

const BLACK = new THREE.Color('#0b0b0d');

export interface PieceLook {
  readonly tier: RenderTier;
  readonly finish: Finish;
}

/**
 * One piece's material. `slotColors` gives the plastic colour for each
 * canonical face slot (null where the piece has no visible face). All piece
 * materials compile to one shared program.
 */
export function createPieceMaterial(slotColors: readonly (THREE.Color | null)[], look: PieceLook, seed: number): THREE.Material {
  const gloss = look.finish === 'gloss';
  const physical = look.tier !== 'low';
  const uniforms = {
    uFaceColor: { value: slotColors.map((c) => (c ? c.clone() : BLACK.clone())) },
    uFaceOn: { value: slotColors.map((c) => (c ? 1 : 0)) },
    uBlack: { value: BLACK.clone() },
    uBlackRoughness: { value: gloss ? 0.34 : 0.5 },
    uBlackCoat: { value: 0.35 },
    uSeed: { value: seed },
  };
  const common = { color: '#ffffff', roughness: gloss ? 0.2 : 0.42, metalness: 0 };
  const material = physical
    ? new THREE.MeshPhysicalMaterial({
        ...common,
        clearcoat: gloss ? 0.6 : 0.12,
        clearcoatRoughness: gloss ? 0.1 : 0.4,
        specularIntensity: 0.75,
        ior: 1.5,
      })
    : new THREE.MeshStandardMaterial(common);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPiecePos = position;\nvPieceNormal = objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <color_fragment>', COLOUR)
      .replace('#include <roughnessmap_fragment>', ROUGHNESS)
      .replace('#include <lights_physical_fragment>', COAT)
      .replace('#include <aomap_fragment>', CAVITY);
  };
  material.customProgramCacheKey = () => `cubelab-piece-${physical ? 'physical' : 'standard'}`;
  return material;
}
