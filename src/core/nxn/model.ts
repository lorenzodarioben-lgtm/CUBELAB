/**
 * Exact, immutable NxN cube state. A piece keeps its home position and stickers;
 * a signed-permutation matrix gives its current orientation. Rotating the matrix
 * rotates the position and the stickers together, with no floating-point drift.
 */
import { FACE_NORMAL, faceFromNormal, mulMat, mulVec, quarterRotation } from '../puzzle/geometry';
import type { Axis, Mat3, Vec3 } from '../puzzle/geometry';
import { IDENTITY } from '../puzzle/geometry';
import type { Face } from '../puzzle/notation';

export interface NxSticker {
  readonly color: Face;
  readonly normal: Vec3;
}

export interface NxPiece {
  readonly id: number;
  readonly home: Vec3;
  readonly stickers: readonly NxSticker[];
}

export interface NxState {
  readonly size: number;
  readonly pieces: readonly NxPiece[];
  readonly orientations: readonly Mat3[];
}

export interface NxMove {
  readonly face: Face;
  /** Number of adjacent layers turned from this face. */
  readonly width: number;
  /** Clockwise quarter turns as viewed from outside this face. */
  readonly turns: 1 | 2 | 3;
}

const AXIS: Readonly<Record<Face, Axis>> = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };
const SIGN: Readonly<Record<Face, 1 | -1>> = { R: 1, U: 1, F: 1, L: -1, D: -1, B: -1 };

export function createNxState(size: number): NxState {
  if (!Number.isInteger(size) || size < 2 || size > 7) throw new RangeError('Cube size must be an integer from 2 to 7.');
  const edge = size - 1;
  const pieces: NxPiece[] = [];
  for (let y = edge; y >= -edge; y -= 2) {
    for (let z = edge; z >= -edge; z -= 2) {
      for (let x = -edge; x <= edge; x += 2) {
        if (Math.abs(x) !== edge && Math.abs(y) !== edge && Math.abs(z) !== edge) continue;
        const home: Vec3 = [x, y, z];
        const stickers: NxSticker[] = [];
        for (const face of ['U', 'R', 'F', 'D', 'L', 'B'] as const) {
          const normal = FACE_NORMAL[face];
          if (home[AXIS[face]] === edge * SIGN[face]) stickers.push({ color: face, normal });
        }
        pieces.push({ id: pieces.length, home, stickers });
      }
    }
  }
  return { size, pieces, orientations: pieces.map(() => IDENTITY) };
}

export function piecePosition(state: NxState, id: number): Vec3 {
  return mulVec(state.orientations[id]!, state.pieces[id]!.home);
}

export function moveAxis(move: NxMove): Axis {
  return AXIS[move.face];
}

export function moveQuarterTurns(move: NxMove): number {
  const clockwise = -SIGN[move.face];
  return clockwise * (move.turns === 3 ? -1 : move.turns);
}

export function isPieceInMove(state: NxState, id: number, move: NxMove): boolean {
  const coordinate = piecePosition(state, id)[AXIS[move.face]];
  return coordinate * SIGN[move.face] >= state.size - 1 - 2 * (move.width - 1);
}

export function applyNxMove(state: NxState, move: NxMove): NxState {
  if (!Number.isInteger(move.width) || move.width < 1 || move.width >= state.size) {
    throw new RangeError('A turn must move at least one layer and leave at least one layer still.');
  }
  const rotation = quarterRotation(AXIS[move.face], moveQuarterTurns(move));
  return {
    ...state,
    orientations: state.orientations.map((orientation, id) =>
      isPieceInMove(state, id, move) ? mulMat(rotation, orientation) : orientation,
    ),
  };
}

export function applyNxMoves(state: NxState, moves: readonly NxMove[]): NxState {
  return moves.reduce(applyNxMove, state);
}

/** Uniform sticker colours on every side, independent of the puzzle's view. */
export function isNxSolved(state: NxState): boolean {
  return state.pieces.every((piece) =>
    piece.stickers.every((sticker) => {
      const normal = mulVec(state.orientations[piece.id]!, sticker.normal);
      return faceFromNormal(normal) === sticker.color;
    }),
  );
}

export function invertNxMove(move: NxMove): NxMove {
  return { ...move, turns: (4 - move.turns) as NxMove['turns'] };
}
