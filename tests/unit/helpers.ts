import { loadKPuzzle } from '../../src/core/puzzle/kpattern';
import { createSolvedState } from '../../src/core/puzzle/cubeState';
import type { CubeState } from '../../src/core/puzzle/cubeState';
import { FACES, mv } from '../../src/core/puzzle/notation';
import type { Move, Turns } from '../../src/core/puzzle/notation';

/** Small deterministic PRNG (mulberry32) so every "random" test is reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random mixed-axis outer-face sequence (consecutive same-face turns allowed on purpose). */
export function randomMoves(rand: () => number, length: number): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i < length; i++) {
    const face = FACES[Math.floor(rand() * 6)]!;
    const turns = (1 + Math.floor(rand() * 3)) as Turns;
    moves.push(mv(face, turns));
  }
  return moves;
}

export async function solvedState(): Promise<CubeState> {
  return createSolvedState(await loadKPuzzle());
}

/** Manually advanced clock for deterministic engine tests. */
export function fakeClock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
      return t;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}
