/**
 * State-based solving via cubing.js `experimentalSolve3x3x3IgnoringCenters`.
 *
 * The solver receives the *current canonical KPattern* — never a move history —
 * so it solves any legal state, however it was reached. It runs in cubing.js's
 * search worker, loaded lazily. Every returned solution is verified by applying
 * it to the captured state through the same `applyMove` the engine uses; an
 * unverifiable answer is rejected rather than played.
 *
 * The function name is "experimental" upstream; the integration is therefore
 * guarded by a timeout, notation validation and the verification step, and is
 * exercised against hundreds of real states in the test suite.
 */
import { applyMoves, isSolved, stateFacelets } from '../puzzle/cubeState';
import type { CubeState } from '../puzzle/cubeState';
import { isFaceletStringSolved } from '../puzzle/facelets';
import { mv, parseAlg } from '../puzzle/notation';
import type { Move } from '../puzzle/notation';
import { applyMoveToPattern } from '../puzzle/kpattern';

export type SolverErrorCode = 'unavailable' | 'timeout' | 'unsupported-notation' | 'invalid-solution';

export class SolverError extends Error {
  readonly code: SolverErrorCode;
  constructor(code: SolverErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SolverError';
    this.code = code;
  }
}

let searchModule: Promise<typeof import('cubing/search')> | null = null;

function loadSearchModule(): Promise<typeof import('cubing/search')> {
  searchModule ??= import('cubing/search')
    .then((search) => {
      search.setSearchDebug({ logPerf: false });
      return search;
    })
    .catch((error: unknown) => {
      searchModule = null;
      throw error;
    });
  return searchModule;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SolverError('timeout', 'The solver took too long to respond.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface SolveOptions {
  /** Generous by default: the first call also boots the worker and its tables. */
  readonly timeoutMs?: number;
}

/** Returns a verified solution for `state` (empty when already solved). */
export async function solveState(state: CubeState, options: SolveOptions = {}): Promise<Move[]> {
  if (isSolved(state)) return [];
  let search: typeof import('cubing/search');
  try {
    search = await loadSearchModule();
  } catch (cause) {
    throw new SolverError('unavailable', 'The solver could not be loaded.', { cause });
  }
  let text: string;
  try {
    const alg = await withTimeout(search.experimentalSolve3x3x3IgnoringCenters(state.pattern), options.timeoutMs ?? 30_000);
    text = alg.toString();
  } catch (cause) {
    if (cause instanceof SolverError) throw cause;
    throw new SolverError('unavailable', 'The solver failed to run.', { cause });
  }
  let moves: Move[];
  try {
    moves = parseAlg(text);
  } catch (cause) {
    throw new SolverError('unsupported-notation', `Solver returned unsupported notation: ${text}`, { cause });
  }
  const end = applyMoves(state, moves);
  if (!isSolved(end) || !isFaceletStringSolved(stateFacelets(end))) {
    throw new SolverError('invalid-solution', 'The solver returned a solution that does not solve the cube.');
  }
  return moves;
}

/** Boots the worker and its pruning tables with a trivial one-move state. */
export async function warmUpSolver(state: CubeState): Promise<void> {
  const search = await loadSearchModule();
  await search.experimentalSolve3x3x3IgnoringCenters(applyMoveToPattern(state.pattern, mv('R', 1)));
}
