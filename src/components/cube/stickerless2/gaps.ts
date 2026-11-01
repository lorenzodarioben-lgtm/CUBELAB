/**
 * How dark the gaps of the closed cube are.
 *
 * Light reaches an internal surface only through the opening above it, so
 * every internal surface, flat or curved, darkens with its depth below the
 * outer face. How fast depends on how wide the opening is: a plain seam is a
 * hairline and goes dark at once; where four pieces meet at an interior
 * lattice line of an outer face, their rounded outlines leave an open vertical
 * shaft, which darkens gradually. The rule has no notion of surface type, so a
 * shaft reads as one soft dark hole whatever shapes line it.
 *
 * `gapOcclusion` is the reference; `gapGlsl` is the same function for the shader.
 */
export const GAPS = {
  /** Light left at the bottom of any gap. */
  floor: 0.03,
  /** Depth over which a surface is still the rim's edge, fully lit. */
  lip: 0.012,
  /** Fall-off length (depth) in a hairline seam and in the middle of a shaft. */
  seamDecay: 0.01,
  shaftDecay: 0.045,
  /** A point is in a shaft within these distances of the lattice line (start, end of the fade). */
  shaftNear: 0.04,
  shaftFar: 0.3,
} as const;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Occlusion (1 lit … `floor`) of an internal surface at `depth` below the outer
 * face, `lattice` away from the nearest interior lattice line of that face
 * (measured in the face's plane).
 */
export function gapOcclusion(depth: number, lattice: number): number {
  const shaft = 1 - smoothstep(GAPS.shaftNear, GAPS.shaftFar, lattice);
  const decay = GAPS.seamDecay + (GAPS.shaftDecay - GAPS.seamDecay) * shaft;
  return GAPS.floor + (1 - GAPS.floor) * Math.exp(-Math.max(depth - GAPS.lip, 0) / decay);
}

const glsl = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** GLSL twin: `float v2GapOcclusion(float depth, float lattice)`. */
export function gapGlsl(): string {
  return /* glsl */ `
float v2GapOcclusion(float depth, float lattice) {
  float shaft = 1.0 - smoothstep(${glsl(GAPS.shaftNear)}, ${glsl(GAPS.shaftFar)}, lattice);
  float decay = mix(${glsl(GAPS.seamDecay)}, ${glsl(GAPS.shaftDecay)}, shaft);
  return ${glsl(GAPS.floor)} + ${glsl(1 - GAPS.floor)} * exp(-max(depth - ${glsl(GAPS.lip)}, 0.0) / decay);
}
`;
}
