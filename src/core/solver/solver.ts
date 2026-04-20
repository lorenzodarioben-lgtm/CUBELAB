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
 * Slices and rotations: cubing.js's 3×3 solver ignores centres and solves
 * corners and edges relative to the home centres. After M/E/S turns or x/y/z
 * rotations the centres sit in one of 24 rotational arrangements, so the
 * solve is set up in a frame where they are home — see `solveState`. Every
 * returned move is a genuine puzzle move and the whole solution is verified.
 */
import { applyMoves, isSolved, stateFacelets } from '../puzzle/cubeState';
import type { CubeState } from '../puzzle/cubeState';
import { isFaceletStringSolved } from '../puzzle/facelets';
import { FACES, ROTATIONS, SLICES, invertAlg, mv, parseAlg } from '../puzzle/notation';
import type { Move } from '../puzzle/notation';
import { applyMoveToPattern, centersAtHome, isPatternSolved } from '../puzzle/kpattern';

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
const ROTATION_MOVES: readonly Move[] = ROTATIONS.flatMap((family) => [mv(family, 1), mv(family, 3), mv(family, 2)]);
const FACE_MOVES: readonly Move[] = FACES.flatMap((family) => [mv(family, 1), mv(family, 3), mv(family, 2)]);

type Pattern = CubeState['pattern'];

/** Breadth-first search over centre arrangements using `generators`, until every centre is home. */
function homeCenters(pattern: Pattern, generators: readonly Move[]): Move[] {
  if (centersAtHome(pattern)) return [];
  const key = (p: Pattern) => p.patternData['CENTERS']!.pieces.join('');
  const seen = new Set<string>([key(pattern)]);
  let frontier: Array<{ pattern: Pattern; path: Move[] }> = [{ pattern, path: [] }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const move of generators) {
        const moved = applyMoveToPattern(node.pattern, move);
        const k = key(moved);
        if (seen.has(k)) continue;
        seen.add(k);
        const path = [...node.path, move];
        if (centersAtHome(moved)) return path;
        next.push({ pattern: moved, path });
      }
    }
    frontier = next;
  }
  throw new SolverError('unsupported-notation', 'Centre arrangement is not a rotation of the cube.');
}

/**
 * Shortest sequence of slice moves that brings every centre back to its home
 * slot (empty when they already are). At most three moves: the 24 centre
 * arrangements form the rotation group, and slices generate it.
 */
export function centerFixSequence(state: CubeState): Move[] {
  return homeCenters(state.pattern, CENTER_FIX_MOVES);
}

/**
 * The shortest run of up to three slice turns that solves the cube outright
 * (no two in a row on the same slice), or null. Catches cubes disturbed only
 * by slices — `M2 E' S` comes back as its own inverse rather than as a longer
 * outer-face solve — which the single path from `centerFixSequence` can miss
 * when several slice sequences home the centres.
 */
function directSliceSolve(pattern: Pattern): Move[] | null {
  const search = (p: Pattern, path: Move[], depth: number): Move[] | null => {
    if (path.length === depth) return isPatternSolved(p) ? path : null;
    const last = path[path.length - 1];
    for (const move of CENTER_FIX_MOVES) {
      if (last && last.family === move.family) continue;
      const found = search(applyMoveToPattern(p, move), [...path, move], depth);
      if (found) return found;
    }
    return null;
  };
  for (let depth = 1; depth <= 3; depth++) {
    const found = search(pattern, [], depth);
    if (found) return found;
  }
  return null;
}

/** Shortest whole-cube rotation ρ after which the centres are home (the cube's current frame). */
export function orientationFrame(state: CubeState): Move[] {
  return homeCenters(state.pattern, ROTATION_MOVES);
}

/**
 * Rewrites outer moves found in the rotated frame back into the cube as it is
 * held: each m becomes ρ·m·ρ⁻¹, which is again a single face turn (a rotation
 * just relabels faces). Found by comparing transformations, not by a table.
 */
function conjugateIntoFrame(moves: readonly Move[], rho: readonly Move[], base: Pattern): Move[] {
  const back = invertAlg(rho);
  const cache = new Map<Move, Move>();
  return moves.map((move) => {
    let relabelled = cache.get(move);
    if (!relabelled) {
      let target = base;
      for (const m of [...rho, move, ...back]) target = applyMoveToPattern(target, m);
      relabelled = FACE_MOVES.find((candidate) => applyMoveToPattern(base, candidate).isIdentical(target));
      if (!relabelled) throw new SolverError('invalid-solution', 'Could not express the solution in the current orientation.');
      cache.set(move, relabelled);
    }
    return relabelled;
  });
}

async function solveOuter(pattern: Pattern, options: SolveOptions): Promise<Move[]> {
  let search: typeof import('cubing/search');
  try {
    search = await loadSearchModule();
  } catch (cause) {
    throw new SolverError('unavailable', 'The solver could not be loaded.', { cause });
  }
  let text: string;
  try {
    const alg = await withTimeout(search.experimentalSolve3x3x3IgnoringCenters(pattern), options.timeoutMs ?? 30_000);
    text = alg.toString();
  } catch (cause) {
    if (cause instanceof SolverError) throw cause;
    throw new SolverError('unavailable', 'The solver failed to run.', { cause });
  }
  try {
    return parseAlg(text);
  } catch (cause) {
    throw new SolverError('unsupported-notation', `Solver returned unsupported notation: ${text}`, { cause });
  }
}

/**
 * Returns a verified solution for `state` (empty when already solved).
 *
 * With centres at home this is one outer-face solve. Otherwise (after slices
 * or whole-cube rotations) real-move candidates are built and verified:
 *  (a) undo it with at most three slice turns, when that alone solves it;
 *  (b) home the centres with ≤ 3 slice turns, then solve — ends in the
 *      canonical white-top, green-front orientation;
 *  (c) solve in the cube's current orientation — solve the rotated frame and
 *      relabel the faces back — so a cube re-gripped white-down stays so.
 * The shortest wins; ties go to the canonical orientation.
 */
export async function solveState(state: CubeState, options: SolveOptions = {}): Promise<Move[]> {
  if (isSolved(state)) return [];
  if (centersAtHome(state.pattern)) return verified(state, await solveOuter(state.pattern, options));

  const direct = directSliceSolve(state.pattern);

  const fix = centerFixSequence(state);
  const homed = applyMoves(state, fix);
  const viaSlices = isSolved(homed) ? fix : [...fix, ...(await solveOuter(homed.pattern, options))];

  const rho = orientationFrame(state);
  const framed = applyMoves(state, rho);
  const inFrame = conjugateIntoFrame(await solveOuter(framed.pattern, options), rho, state.pattern.kpuzzle.defaultPattern());

  // Order matters for ties: the first of equally short candidates wins.
  const candidates = [...(direct ? [direct] : []), viaSlices, inFrame].filter((moves) => solves(state, moves));
  if (candidates.length === 0) throw new SolverError('invalid-solution', 'The solver returned a solution that does not solve the cube.');
  return candidates.reduce((best, moves) => (moves.length < best.length ? moves : best));
}

function solves(state: CubeState, moves: readonly Move[]): boolean {
  const end = applyMoves(state, moves);
  return isSolved(end) && isFaceletStringSolved(stateFacelets(end));
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
