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
 *
 * The Classic Stickered style uses the same material for its black bodies
 * (every cap black, see `stickeredResources.ts`) with its own options: a
 * glossier exterior, and a moulded honeycomb texture on the internal faces
 * that a turn exposes (bump-mapped in the shader, no textures).
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
uniform vec2 uSeamRange;
uniform float uCavityMin;
// Light kept in fully occluded seams: indirect diffuse, indirect specular, direct diffuse, direct specular.
uniform vec4 uSeamFloor;
// The same while a layer turn has opened the cube; uExposure (0 = closed, 1 = 45° open) blends to them.
uniform float uCavityMinOpen;
uniform vec4 uSeamFloorOpen;
uniform float uExposure;
varying vec3 vPiecePos;
varying vec3 vPieceNormal;

#ifdef PIECE_HONEYCOMB
// Distance from the centre of the nearest cell of a hexagonal grid (0 at the centre, 0.5 at a wall).
float pieceHex(vec2 p) {
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = abs(dot(a, a) < dot(b, b) ? a : b);
  return max(dot(g, vec2(0.5, 0.8660254)), g.x);
}

// Bump mapping from a screen-space height gradient (as three.js's perturbNormalArb).
vec3 pieceBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sigmaX = normalize(dFdx(surfPos));
  vec3 sigmaY = normalize(dFdy(surfPos));
  vec3 r1 = cross(sigmaY, surfNorm);
  vec3 r2 = cross(surfNorm, sigmaX);
  float det = dot(sigmaX, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
#endif

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

/** Honeycomb cell size and wall height (object units) on internal faces. */
const HEX_CELL = 0.05;
const HEX_DEPTH = 0.003;

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
float pieceCavity = mix(1.0, mix(uCavityMin, uCavityMinOpen, uExposure), smoothstep(0.012, 0.2, pieceDepth));
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
float pieceSeam = 1.0 - smoothstep(uSeamRange.x, uSeamRange.y, pieceHidden);
#ifdef PIECE_HONEYCOMB
// Moulded honeycomb on flat internal faces (squarely facing a neighbour), away from the visible rims.
vec3 pieceAbsN = abs(pieceN);
vec2 pieceHexUv = pieceAbsN.x > max(pieceAbsN.y, pieceAbsN.z) ? vPiecePos.yz : (pieceAbsN.y > pieceAbsN.z ? vPiecePos.zx : vPiecePos.xy);
float pieceHexWeight = smoothstep(0.9, 0.98, pieceHidden) * smoothstep(0.07, 0.16, pieceDepth);
float pieceHexWall = smoothstep(0.36, 0.47, pieceHex(pieceHexUv / ${HEX_CELL.toFixed(3)})) * pieceHexWeight;
float pieceHexHeight = pieceHexWall * ${HEX_DEPTH.toFixed(4)};
diffuseColor.rgb *= 1.0 + 2.2 * pieceHexWall;
#endif
`;

const HONEYCOMB = /* glsl */ `
#include <normal_fragment_maps>
#ifdef PIECE_HONEYCOMB
normal = pieceBump(-vViewPosition, normal, vec2(dFdx(pieceHexHeight), dFdy(pieceHexHeight)), faceDirection);
#endif
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
vec4 pieceFloor = mix(uSeamFloor, uSeamFloorOpen, uExposure);
float pieceSeamSpecular = mix(pieceFloor.w, 1.0, pieceSeam);
reflectedLight.indirectDiffuse *= pieceCavity * mix(pieceFloor.x, 1.0, pieceSeam);
reflectedLight.indirectSpecular *= pieceSheen * mix(pieceFloor.y, 1.0, pieceSeam);
reflectedLight.directDiffuse *= pieceDirect * mix(pieceFloor.z, 1.0, pieceSeam);
reflectedLight.directSpecular *= pieceDirect * pieceSeamSpecular;
#ifdef USE_CLEARCOAT
  clearcoatSpecularIndirect *= pieceSheen * mix(pieceFloor.y, 1.0, pieceSeam);
  clearcoatSpecularDirect *= pieceDirect * pieceSeamSpecular;
#endif
`;

const BLACK = new THREE.Color('#0b0b0d');

export interface PieceLook {
  readonly tier: RenderTier;
  readonly finish: Finish;
}

/** Per-design adjustments; omitted fields keep the stickerless defaults. */
export interface PieceMaterialOptions {
  /** Exterior plastic (within the caps): roughness and clear coat. */
  readonly capRoughness?: number;
  readonly capCoat?: number;
  readonly capCoatRoughness?: number;
  /** Interior (mechanism) plastic roughness. */
  readonly blackRoughness?: number;
  /** How squarely a surface must face a neighbour before seam shading starts and is complete. */
  readonly seamRange?: readonly [number, number];
  /** Light left deep inside the openings (1 = no cavity darkening). */
  readonly cavityMin?: number;
  /** Light kept in fully occluded seams: indirect diffuse, indirect specular, direct diffuse, direct specular. */
  readonly seamFloor?: readonly [number, number, number, number];
  /**
   * Softer occlusion for while a turn has opened the cube, so the faces it
   * exposes are lit; blended in by `exposure` (shared uniform, 0…1). With the
   * cube closed every seam is shut, so full occlusion cannot hide anything.
   */
  readonly open?: { readonly cavityMin: number; readonly seamFloor: readonly [number, number, number, number] };
  readonly exposure?: { value: number };
  /** Strength of studio reflections (environment light); 1 = as lit. */
  readonly envIntensity?: number;
  /** Colour of the interior (mechanism) plastic. */
  readonly interiorColor?: THREE.ColorRepresentation;
  /** Moulded honeycomb on internal faces, seen mid-turn. */
  readonly honeycomb?: boolean;
}

/**
 * One piece's material. `slotColors` gives the plastic colour for each
 * canonical face slot (null where the piece has no visible face). All piece
 * materials compile to one shared program.
 */
export function createPieceMaterial(
  slotColors: readonly (THREE.Color | null)[],
  look: PieceLook,
  seed: number,
  options: PieceMaterialOptions = {},
): THREE.Material {
  const gloss = look.finish === 'gloss';
  const physical = look.tier !== 'low';
  const honeycomb = options.honeycomb === true && physical;
  const uniforms = {
    uFaceColor: { value: slotColors.map((c) => (c ? c.clone() : BLACK.clone())) },
    uFaceOn: { value: slotColors.map((c) => (c ? 1 : 0)) },
    uBlack: { value: options.interiorColor !== undefined ? new THREE.Color(options.interiorColor) : BLACK.clone() },
    uBlackRoughness: { value: options.blackRoughness ?? (gloss ? 0.34 : 0.5) },
    uBlackCoat: { value: 0.35 },
    uSeed: { value: seed },
    uSeamRange: { value: new THREE.Vector2(...(options.seamRange ?? [0.08, 0.6])) },
    uCavityMin: { value: options.cavityMin ?? 0.12 },
    uSeamFloor: { value: new THREE.Vector4(...(options.seamFloor ?? [0.6, 0.22, 0.45, 0.03])) },
    uCavityMinOpen: { value: options.open?.cavityMin ?? options.cavityMin ?? 0.12 },
    uSeamFloorOpen: { value: new THREE.Vector4(...(options.open?.seamFloor ?? options.seamFloor ?? [0.6, 0.22, 0.45, 0.03])) },
    uExposure: options.exposure ?? { value: 0 },
  };
  const common = { color: '#ffffff', roughness: options.capRoughness ?? (gloss ? 0.2 : 0.42), metalness: 0 };
  const material = physical
    ? new THREE.MeshPhysicalMaterial({
        ...common,
        clearcoat: options.capCoat ?? (gloss ? 0.6 : 0.12),
        clearcoatRoughness: options.capCoatRoughness ?? (gloss ? 0.1 : 0.4),
        specularIntensity: 0.75,
        ior: 1.5,
      })
    : new THREE.MeshStandardMaterial(common);
  if (honeycomb) material.defines = { ...material.defines, PIECE_HONEYCOMB: '' };
  if (options.envIntensity !== undefined) (material as THREE.MeshStandardMaterial).envMapIntensity = options.envIntensity;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPiecePos = position;\nvPieceNormal = objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <color_fragment>', COLOUR)
      .replace('#include <roughnessmap_fragment>', ROUGHNESS)
      .replace('#include <normal_fragment_maps>', HONEYCOMB)
      .replace('#include <lights_physical_fragment>', COAT)
      .replace('#include <aomap_fragment>', CAVITY);
  };
  material.customProgramCacheKey = () => `cubelab-piece-${physical ? 'physical' : 'standard'}${honeycomb ? '-honeycomb' : ''}`;
  return material;
}
