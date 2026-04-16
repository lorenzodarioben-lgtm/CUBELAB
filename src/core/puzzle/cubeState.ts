/**
 * `CubeState` — the single authoritative puzzle value.
 *
 * It is one immutable object carrying two synchronised views of the same
 * physical cube:
 *
 *  - `pattern`: the cubing.js `KPattern`, canonical for solving, solved
 *    detection and scramble verification.
 *  - `cubies`: per-piece integer orientations with stable identities, which the
 *    renderer draws and animates.
 *
 * Both are advanced together by `applyMove` and nothing else, so they cannot
 * diverge unless a convention is wrong — and `agrees()` (plus the test suite)
 * proves they don't by comparing their independently derived facelets.
 */
import type { KPattern, KPuzzle } from 'cubing/kpuzzle';
import { applyMoveToCubies, cubieFacelets, SOLVED_ORIENTATIONS } from './cubies';
import type { CubieOrientations } from './cubies';
import { applyMoveToPattern, isPatternSolved, patternFacelets } from './kpattern';
import type { Move } from './notation';

export interface CubeState {
  readonly pattern: KPattern;
  readonly cubies: CubieOrientations;
}

export function createSolvedState(kpuzzle: KPuzzle): CubeState {
  return { pattern: kpuzzle.defaultPattern(), cubies: SOLVED_ORIENTATIONS };
}

export function applyMove(state: CubeState, move: Move): CubeState {
  return {
    pattern: applyMoveToPattern(state.pattern, move),
    cubies: applyMoveToCubies(state.cubies, move),
  };
}

export function applyMoves(state: CubeState, moves: readonly Move[]): CubeState {
  let next = state;
  for (const m of moves) next = applyMove(next, m);
  return next;
}

export function isSolved(state: CubeState): boolean {
  return isPatternSolved(state.pattern);
}

/** Facelets from the physical cubie model (what the renderer shows). */
export function stateFacelets(state: CubeState): string {
  return cubieFacelets(state.cubies);
}

/** True when the cubie model and the KPattern describe the same sticker layout. */
export function agrees(state: CubeState): boolean {
  return cubieFacelets(state.cubies) === patternFacelets(state.pattern);
}

/** Same logical puzzle state (centre spin ignored, as in KPattern). */
export function sameLogicalState(a: CubeState, b: CubeState): boolean {
  return a.pattern.isIdentical(b.pattern);
}
