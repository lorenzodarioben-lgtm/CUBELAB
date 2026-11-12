/**
 * Near-field light transport for Stickerless v2 (Y's studio; `material.ts`,
 * `V2_TRANSPORT`). While a layer turn is open, the cube is
 * two rigid groups: the turning layer and the rest. Each is a box of pieces in
 * its own lattice frame (the turning layer's is the cube's turned back by the
 * turn angle), so a surface of one group can find the other exactly, with a
 * few ray/box and polygon calculations, and nothing outside the cube matters:
 *
 *  - specular: the reflected ray is tested against the other group's box. Where
 *    it meets it (softly, over the reflection lobe's width at that distance)
 *    the gloss shows that surface's lit plastic instead of the studio: the
 *    piece really there, its colour from the puzzle state (`uCellFace`, the
 *    plastic each lattice cell shows each way), split along its moulding
 *    boundary as the pieces are, lit by the studio about its own normal, and
 *    dark where it is still covered. This is how a blue face near an orange
 *    one picks up orange: a mirror image, weighted by the plastic's Fresnel
 *    reflectance (strong at grazing angles), never a tint on the diffuse
 *    colour (diffuse orange light on blue plastic is close to black);
 *  - internal light: the studio light a surface receives loses the part of
 *    its hemisphere the other group fills (Lambert's polygon formula over the
 *    box faces it sees, clipped to its horizon), and the key light is
 *    shadowed where the ray to it meets the other group;
 *  - bounce: that part of the hemisphere instead sends the other group's own
 *    lit plastic (diffuse, one bounce);
 *  - sheen: the mirrored plastic also carries its own gloss.
 *
 * Y uses specular and internal light; its flags are constants, so the
 * compiler drops the bounce and sheen paths.
 *
 * Approximations: each group is a solid box (the hairline gaps, rounded rims
 * and the core's arms are not seen in reflection); a mirrored surface is lit
 * by the studio about its normal and by the key without its shadow, darkened
 * only by how much the other group covers it; one bounce, each box sending the
 * light of its largest visible face (that face's colour and light at its point
 * nearest the receiver). With no turn open, none of this runs.
 *
 * Cost (it runs for every fragment of the cube while a layer turn is open):
 * the turn's rotation is a per-frame matrix (`uTurnBack`), not sines and
 * cosines per vector; the other group's boxes are found once per fragment; a
 * box shows at most one face per axis to a point outside it, so only those
 * three are considered; and the polygon formula keeps no local arrays (which
 * GPUs index slowly), with one formula call per edge so the shader stays small
 * enough to compile quickly (ANGLE's Direct3D compiler slows sharply with code
 * size). The three faces stay three calls: a loop over them compiles faster
 * still but runs measurably slower.
 */
import { PIECE_HALF } from '../pieceGeometry';

/** Uniforms and geometry helpers (injected with the other v2 declarations). */
export function transportDeclarationsGlsl(): string {
  return /* glsl */ `
const vec4 v2TFlags = vec4(V2_TRANSPORT_FLAGS);
uniform sampler2D uCellFace;
uniform mat3 uCubeToView;
const float V2_PH = ${PIECE_HALF.toFixed(5)};

// The other group's boxes (found once per fragment).
struct V2Boxes {
  vec3 c0;
  vec3 h0;
  vec3 c1;
  vec3 h1;
  int n;
};

// Slab test of the ray (o, d) against the box (centre c, half-size h): its
// coverage of the ray in [0, 1], soft over blur0 + blurT · t at the entry
// face's edges (a reflection lobe's width there), with the entry distance and
// normal. A ray starting inside is covered at once.
float v2BoxCover(vec3 o, vec3 d, vec3 c, vec3 h, float blur0, float blurT, out float t, out vec3 n) {
  vec3 dd = d + vec3(equal(d, vec3(0.0))) * 1e-6;
  vec3 ta = (c - h - o) / dd;
  vec3 tb = (c + h - o) / dd;
  vec3 tn = min(ta, tb);
  vec3 tf = max(ta, tb);
  float tin = max(max(tn.x, tn.y), tn.z);
  float tout = min(min(tf.x, tf.y), tf.z);
  n = tin == tn.x ? vec3(-sign(dd.x), 0.0, 0.0) : (tin == tn.y ? vec3(0.0, -sign(dd.y), 0.0) : vec3(0.0, 0.0, -sign(dd.z)));
  t = max(tin, 0.0);
  if (tout <= 0.0) return 0.0;
  if (tin <= 0.0) return 1.0;
  vec3 m = h - abs(o + d * tin - c);
  vec3 face = abs(n);
  float margin = min(mix(m.x, 1e3, face.x), min(mix(m.y, 1e3, face.y), mix(m.z, 1e3, face.z)));
  return clamp(0.5 + margin / (blur0 + blurT * tin), 0.0, 1.0);
}

// The other group's boxes, in its own frame: the turning layer (seen from the
// rest), or the rest (seen from the turning layer: one box for a face turn,
// the two outer layers for a slice).
V2Boxes v2OtherBoxes(bool moving) {
  vec3 a = uTurnAxis;
  vec3 plane = vec3(1.0 + V2_PH) * (vec3(1.0) - a);
  V2Boxes b;
  b.c1 = vec3(0.0);
  b.h1 = vec3(0.0);
  if (!moving) {
    b.c0 = a * uTurnLayer;
    b.h0 = plane + a * V2_PH;
    b.n = 1;
  } else if (abs(uTurnLayer) > 0.5) {
    b.c0 = a * (-0.5 * uTurnLayer);
    b.h0 = plane + a * (0.5 + V2_PH);
    b.n = 1;
  } else {
    b.c0 = a;
    b.h0 = plane + a * V2_PH;
    b.c1 = -a;
    b.h1 = b.h0;
    b.n = 2;
  }
  return b;
}

// The other group's frame from the cube's (and back): the turning layer's frame
// is the cube's turned back by the angle (uTurnBack; its transpose turns forward).
vec3 v2ToOther(bool moving, vec3 v) { return moving ? v : uTurnBack * v; }
vec3 v2FromOther(bool moving, vec3 v) { return moving ? v : v * uTurnBack; }

// Coverage of the ray (o, d) (cube frame) by the other group, with its entry
// distance, its entry normal and point in that group's frame.
float v2TraceOther(bool moving, V2Boxes boxes, vec3 o, vec3 d, float blur0, float blurT, out float t, out vec3 n, out vec3 q) {
  vec3 oo = v2ToOther(moving, o);
  vec3 od = v2ToOther(moving, d);
  float cover = v2BoxCover(oo, od, boxes.c0, boxes.h0, blur0, blurT, t, n);
  if (boxes.n == 2) {
    float t1;
    vec3 n1;
    float cover1 = v2BoxCover(oo, od, boxes.c1, boxes.h1, blur0, blurT, t1, n1);
    if (cover1 > cover + 1e-3 || (cover1 > 0.999 && cover > 0.999 && t1 < t)) {
      cover = cover1;
      t = t1;
      n = n1;
    }
  }
  q = oo + od * t;
  return cover;
}

int v2Slot(vec3 v) {
  vec3 a = abs(v);
  return a.x > 0.5 ? (v.x > 0.0 ? 0 : 1) : (a.y > 0.5 ? (v.y > 0.0 ? 2 : 3) : (v.z > 0.0 ? 4 : 5));
}

// Whether a point of the other group's surface (its frame) lies on a cut plane rather than the cube's outside.
bool v2OnCut(vec3 q, vec3 n) {
  return abs(dot(n, uTurnAxis)) > 0.5 && abs(dot(q, uTurnAxis)) < 1.0;
}

// Plastic colour (linear) of the other group's surface at q with normal n (its
// frame): an outer face shows its own colour; a cut face, like every internal
// surface, the colour of the piece's nearest outer face.
vec3 v2SurfaceColour(vec3 q, vec3 n) {
  vec3 cellPos = clamp(floor(q - n * 0.05 + 0.5), -1.0, 1.0);
  int cell = int(cellPos.x + 1.0) * 9 + int(cellPos.y + 1.0) * 3 + int(cellPos.z + 1.0);
  vec4 own = texelFetch(uCellFace, ivec2(cell, 6), 0);
  if (!v2OnCut(q, n)) {
    vec4 face = texelFetch(uCellFace, ivec2(cell, v2Slot(n)), 0);
    return face.a > 0.5 ? face.rgb : own.rgb;
  }
  vec3 local = q - cellPos;
  vec3 e1 = uTurnAxis.x > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 e2 = cross(uTurnAxis, e1);
  float l1 = dot(local, e1);
  float l2 = dot(local, e2);
  vec4 f1 = texelFetch(uCellFace, ivec2(cell, v2Slot(l1 >= 0.0 ? e1 : -e1)), 0);
  vec4 f2 = texelFetch(uCellFace, ivec2(cell, v2Slot(l2 >= 0.0 ? e2 : -e2)), 0);
  float h1 = f1.a > 0.5 ? abs(l1) : -1.0;
  float h2 = f2.a > 0.5 ? abs(l2) : -1.0;
  if (max(h1, h2) < 0.0) return own.rgb;
  return h1 >= h2 ? f1.rgb : f2.rgb;
}

// How much light the other group's surface at q (its frame, normal n) gets: a
// cut face is dark where this side still covers it, and where opened sees the
// studio past this side's one-layer wall (the form factor of a wall of height 1).
float v2SurfaceVisibility(bool moving, vec3 q, vec3 n) {
  if (!v2OnCut(q, n)) return 1.0;
  // That point in this side's own lattice frame.
  vec3 mine = moving ? uTurnBack * q : q * uTurnBack;
  vec3 inPlane = abs(mine) * (vec3(1.0) - uTurnAxis);
  float cover = (1.0 + V2_PH) - max(inPlane.x, max(inPlane.y, inPlane.z));
  if (cover > 0.0) return mix(0.08, 0.5, exp(-cover / 0.012));
  float opened = -cover;
  return 1.0 - 0.5 * (1.0 - opened / sqrt(opened * opened + 1.0));
}

// One edge of Lambert's polygon formula (a, b unit vectors from the receiver):
// the edge's angle times its normalised cross product, with the angle over sin
// from Heitz et al.'s rational fit (no atan; accurate to well under 1%).
vec3 v2EdgeVec(vec3 a, vec3 b) {
  float x = dot(a, b);
  float y = abs(x);
  float v = (0.8543985 + (0.4965155 + 0.0145206 * y) * y) / (3.4175940 + (4.1616724 + y) * y);
  float thetaOverSin = x > 0.0 ? v : 0.5 * inversesqrt(max(1.0 - x * x, 1e-7)) - v;
  return cross(a, b) * thetaOverSin;
}

// Cosine-weighted share of the hemisphere above (p, nrm) that the convex quad
// q0..q3 covers: Lambert's formula for a polygon, clipped to the horizon.
// Clipped, the polygon's edges are the parts of the quad's edges above the
// horizon and one edge along it, from where the outline goes below to where it
// comes back; each is summed as it is met, so no vertex list is kept. Each
// edge has one formula call, so the shader stays small to compile.
// One edge a -> b (directions na, nb; heights above the horizon da, db): the part above it.
void v2ClipEdge(vec3 a, vec3 b, vec3 na, vec3 nb, float da, float db, inout vec3 sum, inout vec3 leave, inout vec3 enter) {
  bool aUp = da >= 0.0;
  bool bUp = db >= 0.0;
  if (!aUp && !bUp) return;
  vec3 x = aUp == bUp ? na : normalize(mix(a, b, da / (da - db)));
  if (aUp && !bUp) leave = x;
  if (!aUp && bUp) enter = x;
  sum += v2EdgeVec(aUp ? na : x, bUp ? nb : x);
}

float v2QuadFormFactor(vec3 p, vec3 nrm, vec3 q0, vec3 q1, vec3 q2, vec3 q3) {
  q0 -= p;
  q1 -= p;
  q2 -= p;
  q3 -= p;
  vec4 heights = vec4(dot(q0, nrm), dot(q1, nrm), dot(q2, nrm), dot(q3, nrm));
  if (all(lessThan(heights, vec4(0.0)))) return 0.0;
  vec3 n0 = normalize(q0);
  vec3 n1 = normalize(q1);
  vec3 n2 = normalize(q2);
  vec3 n3 = normalize(q3);
  vec3 sum = vec3(0.0);
  vec3 leave = vec3(0.0);
  vec3 enter = vec3(0.0);
  v2ClipEdge(q0, q1, n0, n1, heights.x, heights.y, sum, leave, enter);
  v2ClipEdge(q1, q2, n1, n2, heights.y, heights.z, sum, leave, enter);
  v2ClipEdge(q2, q3, n2, n3, heights.z, heights.w, sum, leave, enter);
  v2ClipEdge(q3, q0, n3, n0, heights.w, heights.x, sum, leave, enter);
  // The edge along the horizon (zero when nothing was clipped).
  sum += v2EdgeVec(leave, enter);
  return abs(dot(sum, nrm)) * 0.5 / PI;
}
`;
}

/**
 * Functions that light the other group's plastic (they need the studio's
 * irradiance and the key light, so they are injected just before main()).
 */
export function transportFunctionsGlsl(): string {
  return /* glsl */ `
// Radiance the other group's plastic at q (its frame; normal n there and nCube
// in the cube's) sends back along -d: its colour lit by the studio about its
// normal and by the key, by how much light reaches it; with its own gloss if asked.
vec3 v2SurfaceRadiance(bool moving, vec3 q, vec3 n, vec3 nCube, vec3 d, bool sheen) {
  vec3 albedo = v2SurfaceColour(q, n);
  float visible = v2SurfaceVisibility(moving, q, n);
  vec3 nv = uCubeToView * nCube;
  vec3 irradiance = getIBLIrradiance(nv);
#if NUM_DIR_LIGHTS > 0
  irradiance += saturate(dot(nv, directionalLights[0].direction)) * directionalLights[0].color;
#endif
  vec3 radianceOut = albedo * irradiance * RECIPROCAL_PI;
  if (sheen) {
    float c = saturate(dot(-d, nCube));
    float fresnel = 0.04 + 0.96 * pow(1.0 - c, 5.0);
    radianceOut += fresnel * getIBLRadiance(-(uCubeToView * d), nv, 0.14);
  }
  return radianceOut * visible;
}

// One face of a box (centre c, half-size h) as seen from op (normal on), all in
// the box's frame: the face with outward normal fn (half-size hn along it), if
// op is in front of it. u and w are the face's half-extents. Adds its share of the hemisphere
// to boxForm and its direction to towardOther, and keeps the largest.
void v2GatherFace(vec3 op, vec3 on, vec3 c, vec3 h, vec3 fn, float hn, vec3 u, vec3 w, inout float boxForm, inout vec3 towardOther, inout float best, inout vec3 bestPoint, inout vec3 bestNormal) {
  vec3 fc = c + fn * hn;
  float front = dot(op - fc, fn);
  if (front <= 1e-4) return;
  // Bound: the face's area over its nearest distance squared, as seen square-on; skip what cannot matter.
  vec3 offset = max(abs(op - fc) - (u + w), vec3(0.0));
  if (4.0 * length(u) * length(w) * front / pow(dot(offset, offset) + 1e-4, 1.5) < 0.004 * PI) return;
  float share = v2QuadFormFactor(op, on, fc - u - w, fc + u - w, fc + u + w, fc - u + w);
  if (share < 1e-4) return;
  // The face's point nearest the receiver.
  vec3 near = clamp(op, c - h, c + h);
  near += fn * dot(fc - near, fn);
  boxForm += share;
  towardOther += share * normalize(near - op);
  if (share > best) {
    best = share;
    bestPoint = near;
    bestNormal = fn;
  }
}

// The other group's box faces that face p (cube frame, normal nrm): the share of
// the hemisphere they fill (form), its mean direction (cube frame, unnormalised)
// and, if asked, the light they bounce. Each box's bounce is its largest
// visible face's light (colour and lighting at that face's point nearest p)
// over all its share: one lookup per box. A point outside a box sees at most
// one face across each axis, the one on its side.
void v2GatherOther(bool moving, V2Boxes boxes, vec3 p, vec3 nrm, bool bounce, inout float form, inout vec3 toward, inout vec3 light) {
  vec3 op = v2ToOther(moving, p);
  vec3 on = v2ToOther(moving, nrm);
  vec3 towardOther = vec3(0.0);
  for (int b = 0; b < 2; b++) {
    if (b >= boxes.n) break;
    vec3 c = b == 0 ? boxes.c0 : boxes.c1;
    vec3 h = b == 0 ? boxes.h0 : boxes.h1;
    // Entirely below the horizon: nothing to see.
    if (dot(c - op, on) + dot(h, abs(on)) <= 0.0) continue;
    vec3 hx = vec3(h.x, 0.0, 0.0);
    vec3 hy = vec3(0.0, h.y, 0.0);
    vec3 hz = vec3(0.0, 0.0, h.z);
    vec3 side = vec3(greaterThanEqual(op - c, vec3(0.0))) * 2.0 - 1.0;
    float boxForm = 0.0;
    float best = 0.0;
    vec3 bestPoint = c;
    vec3 bestNormal = vec3(0.0, 1.0, 0.0);
    v2GatherFace(op, on, c, h, vec3(side.x, 0.0, 0.0), h.x, hy, hz, boxForm, towardOther, best, bestPoint, bestNormal);
    v2GatherFace(op, on, c, h, vec3(0.0, side.y, 0.0), h.y, hx, hz, boxForm, towardOther, best, bestPoint, bestNormal);
    v2GatherFace(op, on, c, h, vec3(0.0, 0.0, side.z), h.z, hx, hy, boxForm, towardOther, best, bestPoint, bestNormal);
    form += boxForm;
    if (bounce && boxForm > 1e-4) {
      vec3 dir = v2FromOther(moving, normalize(bestPoint - op));
      light += boxForm * v2SurfaceRadiance(moving, bestPoint, bestNormal, v2FromOther(moving, bestNormal), dir, false);
    }
  }
  toward += v2FromOther(moving, towardOther);
}
`;
}

/**
 * After the studio's light is gathered (`lights_fragment_maps`): replace what
 * the other group hides with what it sends. Sets the flags the occlusion step
 * reads (`v2SpecTraced`, `v2DiffTraced`, `v2KeyShadow`).
 */
export const TRANSPORT_GLSL = /* glsl */ `
#include <lights_fragment_maps>
float v2SpecTraced = 0.0;
float v2DiffTraced = 0.0;
float v2KeyShadow = 1.0;
vec3 v2NbSpec = vec3(0.0);
vec3 v2NbDiff = vec3(0.0);
if (v2Traced) {
  bool moving = v2Moving > 0.5;
  V2Boxes boxes = v2OtherBoxes(moving);
  vec3 nCube = normalize(transpose(uCubeToView) * geometryNormal);
  vec3 origin = v2P + nCube * 0.004;
  if (v2TFlags.x > 0.5) {
    vec3 r = normalize(transpose(uCubeToView) * reflect(-geometryViewDir, geometryNormal));
    float t;
    vec3 n;
    vec3 q;
    float lobe = material.roughness * material.roughness + 0.01;
    float cover = v2TraceOther(moving, boxes, origin, r, 0.002 + 1.5 * v2Px, lobe, t, n, q);
    vec3 mirrored = cover > 0.0 ? v2SurfaceRadiance(moving, q, n, v2FromOther(moving, n), r, v2TFlags.w > 0.5) : vec3(0.0);
    // The studio part keeps the closed cube's occlusion; the opened wedge is the traced geometry's.
    radiance = mix(radiance * v2OccOpen, mirrored, cover);
#ifdef USE_CLEARCOAT
    clearcoatRadiance = mix(clearcoatRadiance * v2OccOpen, mirrored, cover);
#endif
    v2NbSpec = mirrored * cover;
    v2SpecTraced = 1.0;
  }
  if (v2TFlags.y > 0.5 || v2TFlags.z > 0.5) {
    float form = 0.0;
    vec3 toward = vec3(0.0);
    vec3 light = vec3(0.0);
    v2GatherOther(moving, boxes, origin, nCube, v2TFlags.y > 0.5, form, toward, light);
    if (v2TFlags.z > 0.5) {
      // The studio light the other group hides: the irradiance about its direction, by its share.
      if (form > 1e-4) iblIrradiance = max(iblIrradiance - form * getIBLIrradiance(uCubeToView * normalize(toward)), vec3(0.0));
#if NUM_DIR_LIGHTS > 0
      float tk;
      vec3 nk;
      vec3 qk;
      vec3 toKey = normalize(transpose(uCubeToView) * directionalLights[0].direction);
      v2KeyShadow = 1.0 - v2TraceOther(moving, boxes, origin, toKey, 0.01, 0.35, tk, nk, qk);
#endif
      v2DiffTraced = 1.0;
    }
    if (v2TFlags.y > 0.5) {
      v2NbDiff = PI * light;
      iblIrradiance += v2NbDiff;
    }
  }
}
`;
