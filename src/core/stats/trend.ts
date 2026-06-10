import { effectiveMs } from './stats';
import type { TimedResult } from './stats';

export interface SolveTrend {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly firstMs: number;
  readonly lastMs: number;
}

/** Last 24 finished, unassisted singles, mapped to a small fixed view box. */
export function buildSolveTrend(solves: readonly TimedResult[]): SolveTrend | null {
  const times = solves.filter((solve) => !solve.assisted && solve.penalty !== 'DNF').map(effectiveMs).slice(-24);
  if (times.length < 2) return null;
  const lowest = Math.min(...times);
  const highest = Math.max(...times);
  const span = highest - lowest;
  return {
    points: times.map((time, index) => ({
      x: 4 + index * 172 / (times.length - 1),
      y: span === 0 ? 26 : 7 + (time - lowest) * 38 / span,
    })),
    firstMs: times[0]!,
    lastMs: times.at(-1)!,
  };
}
