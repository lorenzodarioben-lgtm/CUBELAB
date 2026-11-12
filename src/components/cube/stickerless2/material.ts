/**
 * Stickerless v2 plastic. The exterior is the production Stickerless finish:
 * the same physical material values, per-piece variation and, for Gloss, the
 * production Strong Hybrid shell response and lighting (`stickerlessHybrid.ts`).
 * What v2 changes is everything a turn exposes, plus exact normals:
 *
 *  - colour: each point takes the colour of the outer face it is nearest to,
 *    all the way through the piece (production: a thin cap over black plastic),
 *    so a cut face splits diagonally between its piece's colours;
 *  - normals (High, Medium): corners and edges recompute them per pixel from
 *    the production SDF (`shape.ts`); the centre uses production's own
 *    analytic centre normals;
 *  - internal faces: uncoated and rougher. The corner pieces' internal faces
 *    carry the moulded scale motif: one field of complete engraved arches per
 *    face, laid out to fit it and running across the colour change
 *    (`scales.ts`), convex toward the face's outer corner;
 *  - occlusion: analytic, from the lattice. In the closed cube every internal
 *    surface, flat or curved, darkens with depth below the outer face, quickly
 *    in a hairline seam and more gradually in the open shafts that the
 *    pieces' rounded outlines leave where four pieces meet. A cut plane of a
 *    turn in flight is lit where the turned layer no longer covers it, darker
 *    near the overhanging edge. No screen-space pass is needed;
 *  - bounce: an opened cut face also takes one bounce of light, and a glossy
 *    reflection, from the actual piece across the opening (its colour comes
 *    from a 27-cell table kept in step with the puzzle state);
 *  - near-field transport (Y's studio, Gloss only, `transport.ts`): every
 *    surface a turn opens sees the other layers as geometry, in its gloss,
 *    its share of the studio, its key-light shadow and their bounce.
 */
import * as THREE from 'three';
import { sdfGlsl } from './shape';
import { DIAGONAL, scalesGlsl } from './scales';
import { gapGlsl } from './gaps';
import { PIECE_HALF } from '../pieceGeometry';
import { fixedStudioDefines } from './studio';
import { TRANSPORT_GLSL, transportDeclarationsGlsl, transportFunctionsGlsl } from './transport';
import type { RenderTier } from '../renderTier';

/** Turn state shared by every piece material (updated once per frame). */
export interface TurnUniforms {
  readonly uTurnAxis: { value: THREE.Vector3 };
  /** −1, 0, 1 for a layer turn; 9 while the whole cube rotates. */
  readonly uTurnLayer: { value: number };
  readonly uTurnActive: { value: number };
  /** |sin 2θ| of the turn in flight (0 closed … 1 at 45°). */
  readonly uExposure: { value: number };
  /**
   * Plastic colour (linear) each lattice cell shows on its internal faces across each
   * axis: texel (x·9 + y·3 + z, axis), cells by committed position (`resources.ts`).
   */
  readonly uCellTint: { value: THREE.DataTexture };
  /**
   * Plastic colour (linear) of the piece in each lattice cell facing each way:
   * texel (cell, slot), slots +X, −X, +Y, −Y, +Z, −Z (a = has that outer face)
   * and 6, the piece's own colour where it has just one (`transport.ts`).
   */
  readonly uCellFace: { value: THREE.DataTexture };
  /** Rotation from the cube's frame to the camera's (updated at every piece draw). */
  readonly uCubeToView: { value: THREE.Matrix3 };
  /** Rotation from the cube's frame to the turning layer's: back by the turn angle about uTurnAxis (set with the turn, once per frame). */
  readonly uTurnBack: { value: THREE.Matrix3 };
}

export function createTurnUniforms(): TurnUniforms {
  const tint = new THREE.DataTexture(new Uint8Array(27 * 3 * 4), 27, 3, THREE.RGBAFormat);
  tint.magFilter = THREE.NearestFilter;
  tint.minFilter = THREE.NearestFilter;
  tint.needsUpdate = true;
  const faces = new THREE.DataTexture(new Uint8Array(27 * 7 * 4), 27, 7, THREE.RGBAFormat);
  faces.magFilter = THREE.NearestFilter;
  faces.minFilter = THREE.NearestFilter;
  faces.needsUpdate = true;
  return {
    uTurnAxis: { value: new THREE.Vector3(1, 0, 0) },
    uTurnLayer: { value: 0 },
    uTurnActive: { value: 0 },
    uExposure: { value: 0 },
    uCellTint: { value: tint },
    uCellFace: { value: faces },
    uCubeToView: { value: new THREE.Matrix3() },
    uTurnBack: { value: new THREE.Matrix3() },
  };
}

export interface PieceMaterialV2 extends THREE.MeshPhysicalMaterial {
  /** Transform from the piece mesh to the cube's own frame, set before each draw. */
  readonly pieceToCube: THREE.Matrix4;
}


/**
 * The assembly seam between a piece's coloured mouldings: a V-groove of
 * half-width `halfWidth` and depth `depth` (object units; a piece is 1 ≈
 * 18.5 mm, so 0.0055 ≈ 0.1 mm) with flat walls whose top `shoulder` fraction
 * rounds over into the surface. Its recess loses up to `shade` of the light,
 * most at the bottom (`falloff` shapes how fast), and the wall facing away from
 * the key light is shadowed by the opposite wall's lip by up to `selfShadow`.
 * `wallRoughness` (if set) is the finish of the groove's walls: a moulded edge
 * is smoother than the textured face around it, so a wall turned toward the
 * light catches a narrow reflection.
 *
 * `SEAM` is the approved profile: the reviewed strong candidate made 10%
 * deeper (616a2dc).
 */
export interface SeamProfile {
  readonly halfWidth: number;
  readonly depth: number;
  readonly shoulder: number;
  readonly shade: number;
  readonly falloff: number;
  readonly selfShadow: number;
  readonly wallRoughness: number | null;
}
export const SEAM: SeamProfile = { halfWidth: 0.0095, depth: 0.0121, shoulder: 0.35, shade: 0.97, falloff: 2.5, selfShadow: 0.85, wallRoughness: 0.14 };

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vPiecePos;
varying vec3 vPieceNormal;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec3 uFaceColor[6];
uniform float uFaceOn[6];
uniform float uKind;
uniform mat4 uPieceToCube;
uniform vec3 uTurnAxis;
uniform float uTurnLayer;
// The cube's frame to the turning layer's: turned back by the turn angle about uTurnAxis (one matrix per frame).
uniform mat3 uTurnBack;
uniform float uTurnActive;
uniform float uExposure;
uniform float uInnerRoughness;
uniform mat3 normalMatrix;
// The studio's internal-light gain and exposure, compiled in (studio.ts).
#ifdef V2_INNER_FIXED
#define V2_INNER V2_INNER_FIXED
#endif
#ifdef V2_EXPOSURE_FIXED
#define V2_EXPOSURE V2_EXPOSURE_FIXED
#endif
#ifdef V2_BOUNCE
uniform sampler2D uCellTint;
#endif
varying vec3 vPiecePos;
varying vec3 vPieceNormal;
${sdfGlsl()}
${gapGlsl()}
#ifdef V2_SCALES
${scalesGlsl()}
#endif
#if defined(V2_TRANSPORT) && defined(USE_ENVMAP)
${transportDeclarationsGlsl()}
#endif
`;

const COLOUR = /* glsl */ `
#include <color_fragment>
int v2Kind = int(uKind + 0.5);
float v2Heights[6];
v2Heights[0] = vPiecePos.x;
v2Heights[1] = -vPiecePos.x;
v2Heights[2] = vPiecePos.y;
v2Heights[3] = -vPiecePos.y;
v2Heights[4] = vPiecePos.z;
v2Heights[5] = -vPiecePos.z;
float v2Best = -10.0;
float v2Second = -10.0;
vec3 v2BestColor = vec3(0.0);
vec3 v2SecondColor = vec3(0.0);
int v2BestFace = 0;
int v2SecondFace = 0;
for (int i = 0; i < 6; i++) {
  if (uFaceOn[i] < 0.5) continue;
  float h = v2Heights[i];
  if (h > v2Best) {
    v2Second = v2Best;
    v2SecondColor = v2BestColor;
    v2SecondFace = v2BestFace;
    v2Best = h;
    v2BestColor = uFaceColor[i];
    v2BestFace = i;
  } else if (h > v2Second) {
    v2Second = h;
    v2SecondColor = uFaceColor[i];
    v2SecondFace = i;
  }
}
float v2Gap = v2Best - v2Second;
float v2Blend = v2Second < -5.0 ? 1.0 : 0.5 + 0.5 * smoothstep(0.0, max(fwidth(v2Gap) * 1.25, 1e-5), v2Gap);
diffuseColor.rgb = mix(v2SecondColor, v2BestColor, v2Blend);
// Depth below the nearest outer face; the coated exterior includes the rim fillets and the centre's lip.
float v2Depth = V2_HALF - v2Best;
float v2Ext = 1.0 - smoothstep(0.045, 0.07, v2Depth);

vec3 v2N = normalize(vPieceNormal);
#ifdef V2_SDF_NORMALS
if (v2Kind == 2) {
#ifdef V2_CHAMFER_CENTRE
  if (vPiecePos.y > 0.0) v2N = normalize(pieceAnalyticRimNormal(vPiecePos, 2));
#endif
} else {
  v2N = v2SdfNormal(vPiecePos, v2Kind);
}
#endif

// The same surface in the cube's frame, and in its layer's own (lattice-aligned)
// frame: a piece of the turning layer is turned back by the turn angle.
vec3 v2Centre = uPieceToCube[3].xyz;
float v2Moving = 0.0;
if (uTurnActive > 0.5) v2Moving = uTurnLayer > 5.0 ? 1.0 : 1.0 - step(0.25, abs(dot(v2Centre, uTurnAxis) - uTurnLayer));
vec3 v2P = (uPieceToCube * vec4(vPiecePos, 1.0)).xyz;
vec3 v2Nc = normalize(mat3(uPieceToCube) * v2N);
vec3 v2Pl = v2Moving > 0.5 ? uTurnBack * v2P : v2P;
vec3 v2Nl = v2Moving > 0.5 ? uTurnBack * v2Nc : v2Nc;
vec3 v2Cl = v2Moving > 0.5 ? uTurnBack * v2Centre : v2Centre;
vec3 v2An = abs(v2Nl);
float v2Dom = max(v2An.x, max(v2An.y, v2An.z));
vec3 v2A = v2An.x >= v2An.y && v2An.x >= v2An.z ? vec3(1.0, 0.0, 0.0) : (v2An.y >= v2An.z ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
// The lattice plane this surface looks across (±0.5 inside the cube, ±1.5 on its outside).
float v2Plane = dot(v2Cl, v2A) + 0.5 * sign(dot(v2Nl, v2A));
float v2Inner = 1.0 - step(1.0, abs(v2Plane));
float v2Planar = smoothstep(0.93, 0.985, v2Dom) * v2Inner;

// Coverage by the neighbouring layer: > 0 covered (by that margin), < 0 exposed.
// Only a cut plane of a layer turn in flight can be exposed.
float v2Cover;
float v2Cut = 0.0;
{
  vec3 q = v2Pl;
  bool cut = uTurnActive > 0.5 && uTurnLayer < 5.0 && dot(v2A, uTurnAxis) > 0.9 && abs(abs(v2Plane - uTurnLayer) - 0.5) < 0.1;
  if (cut) {
    q = v2Moving > 0.5 ? v2P : uTurnBack * v2P;
    v2Cut = 1.0;
  }
  vec3 inPlane = abs(q) * (vec3(1.0) - v2A);
  v2Cover = 1.5 - max(inPlane.x, max(inPlane.y, inPlane.z));
}
float v2Exposed = max(-v2Cover, 0.0);

// The closed cube: every internal surface, flat or curved, darkens with depth by one rule (gaps.ts).
float v2Closed;
{
  vec3 a = abs(v2Pl);
  vec2 q = a.x >= a.y && a.x >= a.z ? v2Pl.yz : (a.y >= a.z ? v2Pl.xz : v2Pl.xy);
  v2Closed = v2GapOcclusion(v2Depth, length(abs(q) - 0.5));
}
// A layer turn in flight opens the cube around its cut planes: nearby internal surfaces see the opening.
// v2Opening: how near this surface is to an opened cut (1 at the cut, 0 from 0.4 away).
float v2Opening = 0.0;
if (uTurnActive > 0.5 && uTurnLayer < 5.0) {
  float along = dot(v2P, uTurnAxis);
  float near = min(abs(along - uTurnLayer - 0.5), abs(along - uTurnLayer + 0.5));
#ifdef V2_OPEN_CUTS
  // Only the cut planes inside the cube open: a face turn's other plane (±1.5) is
  // the cube's own outer surface, whose seams stay as closed as at rest.
  float v2Lo = uTurnLayer - 0.5;
  float v2Hi = uTurnLayer + 0.5;
  near = min(abs(v2Lo) < 1.0 ? abs(along - v2Lo) : 9.0, abs(v2Hi) < 1.0 ? abs(along - v2Hi) : 9.0);
#endif
  v2Opening = 1.0 - smoothstep(0.08, 0.4, near);
  v2Closed = mix(v2Closed, max(v2Closed, 0.5), uExposure * v2Opening);
}
// A cut plane: lit where the turned layer no longer covers it, darker under and near the overhang.
// The exposed part sees a wedge of the studio, opening quickly away from the
// overhang; the overhanging layer's own face, the other side of the wedge, adds
// its bounce below (V2_BOUNCE).
float v2PlaneOcc = v2Cover > 0.0
  ? mix(v2Closed, 0.5, exp(-v2Cover / 0.012))
  : 1.0 - 0.5 * (1.0 - v2Exposed / sqrt(v2Exposed * v2Exposed + 0.08));
float v2Internal = mix(v2Closed, v2PlaneOcc, v2Planar * v2Cut);
// The piece across the opening from a cut face of a turn in flight, and the
// colour it shows this face: its cell in the other layer's committed grid.
vec3 v2Tint = vec3(0.0);
float v2TintOn = 0.0;
#ifdef V2_BOUNCE
if (v2Cut > 0.5) {
  vec3 q = v2P + 0.5 * v2Nc;
  if (v2Moving < 0.5) q = uTurnBack * q;
  ivec3 cell = ivec3(floor(q + 0.5)) + 1;
  if (all(greaterThanEqual(cell, ivec3(0))) && all(lessThanEqual(cell, ivec3(2)))) {
    int axisIndex = uTurnAxis.x > 0.5 ? 0 : (uTurnAxis.y > 0.5 ? 1 : 2);
    v2Tint = texelFetch(uCellTint, ivec2(cell.x * 9 + cell.y * 3 + cell.z, axisIndex), 0).rgb;
    v2TintOn = v2Planar;
  }
}
#endif
// Exterior that turns to face a neighbour (the lower part of a rim, rolling into
// its seam) is shaded by it, as production does; less so while a turn opens it.
float v2Facing = 0.0;
{
  vec3 n = v2N;
  float facing[6];
  facing[0] = n.x;
  facing[1] = -n.x;
  facing[2] = n.y;
  facing[3] = -n.y;
  facing[4] = n.z;
  facing[5] = -n.z;
  for (int i = 0; i < 6; i++) if (uFaceOn[i] < 0.5) v2Facing = max(v2Facing, facing[i]);
}
float v2Seam = 1.0 - smoothstep(0.35, 0.9, v2Facing);
#ifdef V2_OPEN_CUTS
// Only near an opened cut: elsewhere the seams stay as closed as at rest, whatever the turn angle.
float v2ExtOcc = mix(mix(0.22, 1.0, v2Seam), mix(0.6, 1.0, v2Seam), uExposure * v2Opening);
#else
float v2ExtOcc = mix(mix(0.22, 1.0, v2Seam), mix(0.6, 1.0, v2Seam), uExposure);
#endif
float v2Occ = mix(v2Internal, v2ExtOcc, v2Ext);

#ifdef V2_SCALES
// The scale motif, on the internal faces of corner pieces only. In the piece's
// canonical frame (home +1,+1,+1) these are the faces at −0.493 along each axis;
// each face's outer corner, the motif's apex, is at +0.493 along the other two.
// Only a cut face of a turn in flight can show it: in the closed cube every
// internal face is hidden or deep in a dark gap, so it is not evaluated there.
if (v2Kind == 0 && v2Cut > 0.5) {
  vec3 n0 = normalize(vPieceNormal);
  int axis = -1;
  if (n0.x < -0.985 && vPiecePos.x < -0.47) axis = 0;
  else if (n0.y < -0.985 && vPiecePos.y < -0.47) axis = 1;
  else if (n0.z < -0.985 && vPiecePos.z < -0.47) axis = 2;
  if (axis >= 0) {
    vec3 eb = axis == 0 ? vec3(0.0, 1.0, 0.0) : (axis == 1 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0));
    vec3 ec = axis == 0 ? vec3(0.0, 0.0, 1.0) : (axis == 1 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0));
    vec2 rel = vec2(dot(vPiecePos, eb), dot(vPiecePos, ec)) - ${PIECE_HALF.toFixed(4)};
    // v from the apex along the diagonal; u across it. One pattern spans the whole
    // face: the colour change at u = 0 is not a seam, so arches run across it.
    vec2 uv = vec2(rel.x - rel.y, -(rel.x + rel.y)) * 0.70710678;
    vec3 tu = (eb - ec) * 0.70710678;
    vec3 tv = -(eb + ec) * 0.70710678;
    if (uv.y > 0.0 && uv.y < ${DIAGONAL.toFixed(4)}) {
      vec3 sc = v2Scales(uv);
      // Anti-aliasing only: grooves narrower than a pixel lose their relief evenly, never arch by arch.
      float pixel = length(fwidth(uv));
      float detail = 1.0 - smoothstep(0.012, 0.03, pixel);
      v2N = normalize(v2N - detail * (sc.y * tu + sc.z * tv));
      diffuseColor.rgb *= 1.0 - 0.14 * sc.x * detail;
    }
  }
}
#endif

// The assembly seam where two coloured mouldings of a piece meet. The colour
// boundary is the plane where the two nearest outer faces are equally near
// (height gap 0); on a corner piece's internal faces it is each face's
// diagonal, the three meeting at the piece's innermost corner; on an edge
// piece it runs down each side face's diagonal and along the inner edge. A
// V-groove is cut along it: flat walls (one turned toward the light, the other
// away), shoulders rounding into the surface, a recess that darkens toward the
// bottom, and the wall facing away from the key light shadowed by the opposite
// lip. Internal surfaces only: it fades out across the coated exterior band.
// Independent of the scale motif, which continues across it; where the two
// cross, both grooves are simply cut.
float v2SeamShade = 1.0;
float v2SeamWall = 0.0;
#ifdef V2_SEAM
if (v2Second > -5.0 && v2Ext < 0.999) {
  // Distance from the boundary plane (the two faces' axes are perpendicular).
  float d = v2Gap * 0.70710678;
  float px = max(fwidth(d), 1e-6);
  const float W = ${SEAM.halfWidth.toFixed(5)};
  const float D = ${SEAM.depth.toFixed(5)};
  const float SH = ${SEAM.shoulder.toFixed(3)};
  if (d < W + 2.0 * px) {
    float t = clamp(d / W, 0.0, 1.0);
    // Profile: straight wall up to the shoulder, then a parabola tangent to it
    // that meets the surface level. f is the depth below the surface (1 at the bottom).
    float k = 1.0 - 0.5 * SH;
    float f = t < 1.0 - SH ? ((1.0 - t) - 0.5 * SH) / k : (1.0 - t) * (1.0 - t) / (2.0 * SH * k);
    float dfdt = t < 1.0 - SH ? 1.0 / k : (1.0 - t) / (SH * k);
    float slope = D * dfdt / W;
    // Below a pixel the relief cannot be resolved: keep its average shade, drop the tilt.
    float resolve = 1.0 - smoothstep(0.6, 1.6, px / W);
    float coverage = min(1.0, W / px);
    float inside = (1.0 - v2Ext) * (d < W ? 1.0 : 0.0);
    // Gradient of d on the surface: from the second face's axis toward the best's, over √2.
    vec3 gBest = vec3(0.0);
    vec3 gSecond = vec3(0.0);
    gBest[v2BestFace / 2] = (v2BestFace % 2 == 0) ? 1.0 : -1.0;
    gSecond[v2SecondFace / 2] = (v2SecondFace % 2 == 0) ? 1.0 : -1.0;
    vec3 g = (gBest - gSecond) * 0.70710678;
    g -= v2N * dot(g, v2N);
    vec3 v2SurfaceN = v2N;
    // The height rises away from the seam: h' = +slope along ∇d.
    v2N = normalize(v2N - inside * resolve * slope * g);
    v2SeamWall = inside * resolve;
    // Recess: the deeper, the less of the room it sees.
    float recess = ${SEAM.shade.toFixed(3)} * pow(clamp(f, 0.0, 1.0), ${SEAM.falloff.toFixed(3)});
#if NUM_DIR_LIGHTS > 0
    // The wall turned away from the key light is shadowed by the opposite lip, more so deeper down.
    vec3 lightDir = directionalLights[0].direction;
    float away = dot(normalize(normalMatrix * v2SurfaceN), lightDir) - dot(normalize(normalMatrix * v2N), lightDir);
    float wallSin = max(length(v2N - v2SurfaceN), 1e-3);
    recess = max(recess, ${SEAM.selfShadow.toFixed(3)} * clamp(away / wallSin, 0.0, 1.0) * sqrt(clamp(f, 0.0, 1.0)) * resolve);
#endif
    // Unresolved: the average of the recess over the groove's width, spread over the pixel.
    float average = ${SEAM.shade.toFixed(3)} / (${SEAM.falloff.toFixed(3)} + 1.0) * coverage;
    v2SeamShade = 1.0 - (1.0 - v2Ext) * mix(average, recess, resolve) * (d < W + px ? 1.0 : 0.0);
  }
}
#endif
#if defined(V2_TRANSPORT) && defined(USE_ENVMAP)
// The same occlusion with an opened cut plane's wedge left to the traced transport.
float v2OccOpen = mix(mix(v2Closed, v2Cover > 0.0 ? v2PlaneOcc : 1.0, v2Planar * v2Cut), v2ExtOcc, v2Ext);
float v2Px = length(fwidth(v2P));
bool v2Traced = uTurnActive > 0.5 && uTurnLayer < 5.0 && dot(v2TFlags, vec4(1.0)) > 0.5;
#endif
`;

const ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(uInnerRoughness, roughnessFactor, v2Ext);
${SEAM.wallRoughness === null ? '' : `roughnessFactor = mix(roughnessFactor, ${SEAM.wallRoughness.toFixed(3)}, v2SeamWall);`}
`;

const NORMAL = /* glsl */ `
#include <normal_fragment_begin>
normal = normalize(normalMatrix * v2N);
nonPerturbedNormal = normal;
`;

const COAT = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= v2Ext;
#endif
`;

const OCCLUSION = /* glsl */ `
#include <aomap_fragment>
v2Occ *= v2SeamShade;
vec3 v2DiffOcc = vec3(v2Occ);
#if defined(V2_TRANSPORT) && defined(USE_ENVMAP)
// Traced: the opened wedge's share of the studio, and its bounce, are already in the light.
if (v2DiffTraced > 0.5) {
  v2DiffOcc = vec3(v2OccOpen * v2SeamShade);
} else {
#endif
#ifdef V2_MULTIBOUNCE
// In the wedge a turn opens, light also arrives after bouncing between the two
// cut faces, more so the brighter the plastic: Jimenez et al.'s multi-bounce fit
// with this plastic's own colour. Only there: in the closed cube's hairline gaps
// almost no light gets in to bounce, and they stay as dark as approved.
{
  vec3 albedo = diffuseColor.rgb;
  vec3 a = 2.0404 * albedo - 0.3324;
  vec3 b = -4.7951 * albedo + 0.6417;
  vec3 c = 2.7552 * albedo + 0.6903;
  vec3 multi = max(vec3(v2Occ), ((v2Occ * a + b) * v2Occ + c) * v2Occ);
  v2DiffOcc = mix(v2DiffOcc, multi, v2Planar * v2Cut * (1.0 - v2Ext));
}
#endif
#ifdef V2_BOUNCE
// An opened cut face also receives light from the face across the opening: that
// face sees about as much of the studio as this one (v) and reflects its own
// colour, filling the part of this face's view that it covers (1 − v). One bounce.
v2DiffOcc += v2TintOn * v2Tint * v2Occ * (1.0 - v2Occ);
#endif
#if defined(V2_TRANSPORT) && defined(USE_ENVMAP)
}
#endif
reflectedLight.indirectDiffuse *= v2DiffOcc;
float v2SpecOcc = v2Occ;
#if defined(V2_TRANSPORT) && defined(USE_ENVMAP)
// Traced: the reflection already shows the other group, or the studio past it.
if (v2SpecTraced > 0.5) v2SpecOcc = v2SeamShade;
#endif
reflectedLight.indirectSpecular *= v2SpecOcc;
#ifdef V2_INNER
// The studio's light reaching internal plastic (studio.ts): more in a brighter, whiter studio.
// Written so a gain of 1 multiplies by exactly 1.0.
float v2StudioGain = 1.0 + (V2_INNER - 1.0) * (1.0 - v2Ext);
reflectedLight.indirectDiffuse *= v2StudioGain;
reflectedLight.indirectSpecular *= v2StudioGain;
#endif
// Inside a seam or gap the key light is blocked entirely; on the exterior the shadow map does most of it.
reflectedLight.directDiffuse *= mix(v2DiffOcc, mix(vec3(1.0), v2DiffOcc, 0.75), v2Ext);
#if defined(V2_TRANSPORT) && defined(USE_ENVMAP)
reflectedLight.directDiffuse *= v2KeyShadow;
#endif
#ifdef USE_CLEARCOAT
  clearcoatSpecularIndirect *= v2SpecOcc;
#endif
#if defined(V2_BOUNCE) && defined(USE_ENVMAP)
#if defined(V2_TRANSPORT)
if (v2TintOn > 0.0 && v2SpecTraced < 0.5) {
#else
if (v2TintOn > 0.0) {
#endif
  // Where the face across the opening hides the studio, the reflection shows that face instead.
  float nv = saturate(dot(geometryNormal, geometryViewDir));
  float fresnel = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  vec3 across = v2Tint * getIBLIrradiance(geometryNormal) * RECIPROCAL_PI * v2Occ;
  reflectedLight.indirectSpecular += v2TintOn * (1.0 - v2Occ) * fresnel * across;
}
#endif
`;

const TRANSPORT = /* glsl */ `
#if defined(V2_TRANSPORT) && defined(USE_ENVMAP)
${TRANSPORT_GLSL}
#else
#include <lights_fragment_maps>
#endif
`;

// The plastic's exposure for the studio shown (the stage's own exposure is unchanged).
const EXPOSURE = /* glsl */ `
#ifdef V2_EXPOSURE
gl_FragColor.rgb *= V2_EXPOSURE;
#endif
#include <tonemapping_fragment>
`;

export interface PieceLookV2 {
  readonly tier: RenderTier;
  readonly matte: boolean;
  /** Deterministic per-piece finish variation, as production: relative roughness and coat-roughness offsets. */
  readonly variation: { readonly roughness: number; readonly coat: number };
}

/**
 * One piece's material. `slotColors` is the plastic colour of each canonical
 * face slot (+X, −X, +Y, −Y, +Z, −Z; null = no visible face). All 26 piece
 * materials of a tier compile to one program. Values are production's
 * (`stickerlessResources.ts`); Gloss then takes production's Strong Hybrid.
 */
export function createPieceMaterialV2(kind: number, slotColors: readonly (THREE.Color | null)[], look: PieceLookV2, turn: TurnUniforms): PieceMaterialV2 {
  const detailed = look.tier !== 'low';
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: look.matte ? 0.42 : 0.26,
    clearcoat: look.matte ? 0.12 : 0.35,
    clearcoatRoughness: look.matte ? 0.4 : 0.07,
    specularIntensity: 0.75,
    ior: 1.5,
    envMapIntensity: look.matte ? 0.9 : 1,
  }) as THREE.MeshPhysicalMaterial & { pieceToCube: THREE.Matrix4 };
  material.roughness *= 1 + look.variation.roughness;
  material.clearcoatRoughness *= 1 + look.variation.coat;
  const pieceToCube = new THREE.Matrix4();
  material.pieceToCube = pieceToCube;
  const uniforms = {
    uFaceColor: { value: slotColors.map((c) => (c ? c.clone() : new THREE.Color(0, 0, 0))) },
    uFaceOn: { value: slotColors.map((c) => (c ? 1 : 0)) },
    uKind: { value: kind },
    uPieceToCube: { value: pieceToCube },
    uInnerRoughness: { value: 0.3 },
    ...turn,
  };
  const defines: Record<string, string> = {};
  // On every tier: both are a few ALU operations, applied only where a turn opens the cube.
  defines.V2_BOUNCE = '';
  defines.V2_MULTIBOUNCE = '';
  defines.V2_SEAM = '';
  if (detailed) {
    defines.V2_SDF_NORMALS = '';
    defines.V2_SCALES = '';
    // Gloss carries production's chamfer centre and its analytic normals; Matte its continuous centre.
    if (!look.matte) defines.V2_CHAMFER_CENTRE = '';
  }
  // The studio lights Gloss only (its maps and key light; Matte keeps production's matte lighting).
  if (!look.matte) Object.assign(defines, fixedStudioDefines());
  // Gloss: a turn lifts the seam shading only around the cut planes it opens (Matte keeps the whole-cube lift).
  if (!look.matte) defines.V2_OPEN_CUTS = '';
  material.defines = { ...material.defines, ...defines };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPiecePos = position;\nvPieceNormal = objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <color_fragment>', COLOUR)
      .replace('#include <roughnessmap_fragment>', ROUGHNESS)
      .replace('#include <normal_fragment_begin>', NORMAL)
      .replace('#include <lights_physical_fragment>', COAT)
      .replace('#include <aomap_fragment>', OCCLUSION)
      .replace('#include <lights_fragment_maps>', TRANSPORT)
      .replace('#include <tonemapping_fragment>', EXPOSURE)
      .replace('void main() {', `#if defined(V2_TRANSPORT) && defined(USE_ENVMAP)\n${transportFunctionsGlsl()}\n#endif\nvoid main() {`);
  };
  material.customProgramCacheKey = () => `cubelab-v2-piece${detailed ? '-detailed' : ''}${look.matte ? '-matte' : '-studio-y'}`;
  return material;
}

/** The mechanism core: light grey moulding deep inside the cube, so it takes little light. */
export function createMechanismMaterialV2(color: string): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, metalness: 0, clearcoat: 0 });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= 0.3;\nreflectedLight.indirectSpecular *= 0.3;\nreflectedLight.directDiffuse *= 0.5;',
    );
  };
  material.customProgramCacheKey = () => 'cubelab-v2-mechanism';
  return material;
}
