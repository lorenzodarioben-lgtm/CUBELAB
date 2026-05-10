import { applyNxMoves, isNxSolved } from './model';
import type { NxMove, NxState } from './model';
import { formatNxAlg, parseNxAlg } from './notation';

/**
 * 2×2 state solving through cubing.js. The move history reconstructs the
 * canonical pattern from solved; the answer is then verified against our
 * independent physical piece model before it is offered to the UI.
 */
export async function solveTwoByTwo(
  state: NxState,
  scramble: string | null,
  moves: readonly NxMove[],
  timeoutMs = 30_000,
): Promise<NxMove[]> {
  if (state.size !== 2) throw new Error('This solver supports the 2×2 cube only.');
  if (isNxSolved(state)) return [];
  const [{ cube2x2x2 }, { experimentalSolve2x2x2 }] = await Promise.all([import('cubing/puzzles'), import('cubing/search')]);
  const kpuzzle = await cube2x2x2.kpuzzle();
  const history = [scramble, formatNxAlg(moves)].filter(Boolean).join(' ');
  const pattern = kpuzzle.defaultPattern().applyAlg(history);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const solution = await Promise.race([
      experimentalSolve2x2x2(pattern),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('2×2 solver timed out.')), timeoutMs); }),
    ]);
    const parsed = parseNxAlg(solution.toString(), 2);
    if (!isNxSolved(applyNxMoves(state, parsed))) throw new Error('2×2 solver returned an invalid solution.');
    return parsed;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
