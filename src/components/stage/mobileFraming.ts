/** Fixed perspective fit of the cube's circumsphere, including intermediate
 * layer turns. Rotations preserve each vertex's distance from the origin, so
 * this envelope never follows the view or animated geometry. A 4px margin
 * keeps the enlarged presentation clear of the edges. OrbitRig owns zoom. */
export function mobileFitDistance(width: number, height: number, half: number, fov: number): number {
  const radius = Math.sqrt(3) * half;
  const focal = height / (2 * Math.tan(fov * Math.PI / 360));
  const aperture = Math.max(1, Math.min(width, height) / 2 - 4);
  // Exact sphere tangent in perspective, accounting for the near side.
  return radius * Math.hypot(1, focal / aperture);
}
