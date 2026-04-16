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
 *
 * Slices: cubing.js's 3×3 solver ignores centres and solves corners and edges
 * relative to the home centres. After M/E/S turns the centres may sit in any
 * of the 24 rotational arrangements, which (combined with edge parity) can make
 * that sub-problem unsolvable with outer turns. So the solution is built in two
 * real parts: a shortest slice sequence that returns the centres home (found
 * by breadth-first search over the 24 arrangements), then the outer-face
 * solution of the resulting state. Every move is a genuine puzzle move, and
 * the cube ends in the canonical orientation (white top, green front).
 */
import { applyMoves, isSolved, stateFacelets } from '../puzzle/cubeState';
import type { CubeState } from '../puzzle/cubeState';
import { isFaceletStringSolved } from '../puzzle/facelets';
import { SLICES, mv, parseAlg } from '../puzzle/notation';
import type { Move } from '../puzzle/notation';
import { applyMoveToPattern, centersAtHome } from '../puzzle/kpattern';

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

const CENTER_FIX_MOVES: readonly Move[] = SLICES.flatMap((family) => [mv(family, 1), mv(family, 3), mv(family, 2)]);

/**
 * Shortest sequence of slice moves that brings every centre back to its home
 * slot (empty when they already are). At most three moves: the 24 centre
 * arrangements form the rotation group, and slices generate it.
 */
export function centerFixSequence(state: CubeState): Move[] {
  if (centersAtHome(state.pattern)) return [];
  const key = (pattern: CubeState['pattern']) => pattern.patternData['CENTERS']!.pieces.join('');
  const seen = new Set<string>([key(state.pattern)]);
  let frontier: Array<{ pattern: CubeState['pattern']; path: Move[] }> = [{ pattern: state.pattern, path: [] }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const move of CENTER_FIX_MOVES) {
        const pattern = applyMoveToPattern(node.pattern, move);
        const k = key(pattern);
        if (seen.has(k)) continue;
        seen.add(k);
        const path = [...node.path, move];
        if (centersAtHome(pattern)) return path;
        next.push({ pattern, path });
      }
    }
    frontier = next;
  }
  throw new SolverError('unsupported-notation', 'Centre arrangement is not a rotation of the cube.');
}

/** Returns a verified solution for `state` (empty when already solved). */
export async function solveState(state: CubeState, options: SolveOptions = {}): Promise<Move[]> {
  if (isSolved(state)) return [];
  const centerFix = centerFixSequence(state);
  const homed = applyMoves(state, centerFix);
  if (isSolved(homed)) return verified(state, centerFix);
  let search: typeof import('cubing/search');
  try {
    search = await loadSearchModule();
  } catch (cause) {
    throw new SolverError('unavailable', 'The solver could not be loaded.', { cause });
  }
  let text: string;
  try {
    const alg = await withTimeout(search.experimentalSolve3x3x3IgnoringCenters(homed.pattern), options.timeoutMs ?? 30_000);
    text = alg.toString();
  } catch (cause) {
    if (cause instanceof SolverError) throw cause;
    throw new SolverError('unavailable', 'The solver failed to run.', { cause });
  }
  let outer: Move[];
  try {
    outer = parseAlg(text);
  } catch (cause) {
    throw new SolverError('unsupported-notation', `Solver returned unsupported notation: ${text}`, { cause });
  }
  return verified(state, [...centerFix, ...outer]);
}

/** Accepts `moves` only if they solve the captured state, logically and on the stickers. */
function verified(state: CubeState, moves: Move[]): Move[] {
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
