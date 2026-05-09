import { faceFromNormal, mulVec } from '../puzzle/geometry';
import type { Vec3 } from '../puzzle/geometry';
import { FACES } from '../puzzle/notation';
import type { Face } from '../puzzle/notation';
import { piecePosition } from './model';
import type { NxState } from './model';

function faceIndex(face: Face, position: Vec3, size: number): number {
  const [x, y, z] = position;
  const edge = size - 1;
  let row: number;
  let col: number;
  switch (face) {
    case 'U': row = (z + edge) / 2; col = (x + edge) / 2; break;
    case 'D': row = (edge - z) / 2; col = (x + edge) / 2; break;
    case 'F': row = (edge - y) / 2; col = (x + edge) / 2; break;
    case 'B': row = (edge - y) / 2; col = (edge - x) / 2; break;
    case 'R': row = (edge - y) / 2; col = (edge - z) / 2; break;
    case 'L': row = (edge - y) / 2; col = (z + edge) / 2; break;
  }
  return row * size + col;
}

/** What each sticker physically shows, indexed in net-reading order. */
export function nxFacelets(state: NxState): Readonly<Record<Face, readonly Face[]>> {
  const output = Object.fromEntries(FACES.map((face) => [face, Array<Face | null>(state.size ** 2).fill(null)])) as Record<Face, Array<Face | null>>;
  for (const piece of state.pieces) {
    const orientation = state.orientations[piece.id]!;
    const position = piecePosition(state, piece.id);
    for (const sticker of piece.stickers) {
      const face = faceFromNormal(mulVec(orientation, sticker.normal));
      output[face][faceIndex(face, position, state.size)] = sticker.color;
    }
  }
  for (const face of FACES) if (output[face].some((color) => color === null)) throw new Error(`Incomplete ${state.size}×${state.size} face ${face}.`);
  return output as Record<Face, Face[]>;
}
