/**
 * The 54-facelet projection of a cube, used for invariants, tests, the 2D net
 * fallback and the model ↔ renderer agreement checks.
 *
 * Layout is the conventional Kociemba ordering: faces `U R F D L B`, nine
 * facelets each, read row by row as seen from outside the cube with the
 * standard cross unfolding:
 *
 *             U0 U1 U2
 *             U3 U4 U5            U is viewed from above with B at the top.
 *             U6 U7 U8            D is viewed from below with F at the top.
 *   L0 L1 L2  F0 F1 F2  R0 R1 R2  B0 B1 B2
 *   L3 L4 L5  F3 F4 F5  R3 R4 R5  B3 B4 B5
 *   L6 L7 L8  F6 F7 F8  R6 R7 R8  B6 B7 B8
 *             D0 D1 D2
 *             D3 D4 D5
 *             D6 D7 D8
 *
 * Each character names the face whose colour a sticker carries, so a solved
 * cube is `UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB`.
 */
import type { Face } from './notation';
import type { Vec3 } from './geometry';

export const FACELET_FACE_ORDER: readonly Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];

export const SOLVED_FACELETS =
  'UUUUUUUUU' + 'RRRRRRRRR' + 'FFFFFFFFF' + 'DDDDDDDDD' + 'LLLLLLLLL' + 'BBBBBBBBB';

const FACE_OFFSET: Readonly<Record<Face, number>> = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };

/**
 * Index (0–53) of the facelet on `face` belonging to the cubie at lattice
 * position `pos`. Row/column are derived from the viewing direction described
 * above.
 */
export function faceletIndex(face: Face, pos: Vec3): number {
  const [x, y, z] = pos;
  let row: number;
  let col: number;
  switch (face) {
    case 'U':
      row = z + 1;
      col = x + 1;
      break;
    case 'D':
      row = 1 - z;
      col = x + 1;
      break;
    case 'F':
      row = 1 - y;
      col = x + 1;
      break;
    case 'B':
      row = 1 - y;
      col = 1 - x;
      break;
    case 'R':
      row = 1 - y;
      col = 1 - z;
      break;
    case 'L':
      row = 1 - y;
      col = z + 1;
      break;
  }
  return FACE_OFFSET[face] + row * 3 + col;
}

/** True when every face shows a single colour (centre spin and whole-cube orientation ignored). */
export function isFaceletStringSolved(facelets: string): boolean {
  if (facelets.length !== 54) return false;
  for (let f = 0; f < 6; f++) {
    const first = facelets[f * 9];
    for (let i = 1; i < 9; i++) if (facelets[f * 9 + i] !== first) return false;
  }
  return true;
}

export function faceSlice(facelets: string, face: Face): string {
  const start = FACE_OFFSET[face];
  return facelets.slice(start, start + 9);
}

/** Counts each colour; a legal cube always has exactly nine of every colour. */
export function colorHistogram(facelets: string): Record<Face, number> {
  const counts: Record<Face, number> = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
  for (const ch of facelets) counts[ch as Face]++;
  return counts;
}
