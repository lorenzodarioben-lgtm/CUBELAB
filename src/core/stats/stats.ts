/**
 * Solve statistics with common WCA conventions.
 *
 * - Effective time = raw time, +2000 ms for a `+2`, and `Infinity` for DNF.
 * - aoN (N = 5 or 12) over the last N eligible solves: drop the single best
 *   and single worst, take the arithmetic mean of the rest. One DNF is simply
 *   the dropped worst; two or more DNFs make the whole average DNF.
 * - Assisted (practice) records are never eligible for PB or averages.
 * - Times stay in exact milliseconds; rounding happens only when formatting
 *   (singles truncate to hundredths, averages round to hundredths).
 *
 * `null` means "not enough data", `Infinity` means DNF.
 */
import type { Penalty } from '../timing/timerMachine';

export interface TimedResult {
  readonly durationMs: number;
  readonly penalty: Penalty;
  readonly assisted: boolean;
}

export const DNF = Number.POSITIVE_INFINITY;

export function effectiveMs(result: Pick<TimedResult, 'durationMs' | 'penalty'>): number {
  if (result.penalty === 'DNF') return DNF;
  return result.penalty === '+2' ? result.durationMs + 2000 : result.durationMs;
}

export function eligible<T extends TimedResult>(results: readonly T[]): T[] {
  return results.filter((r) => !r.assisted);
}

/** Best eligible single, or null if there is no finished (non-DNF) eligible solve. */
export function bestSingle(results: readonly TimedResult[]): number | null {
  let best: number | null = null;
  for (const r of eligible(results)) {
    const t = effectiveMs(r);
    if (t !== DNF && (best === null || t < best)) best = t;
  }
  return best;
}

/** Trimmed mean of exactly `times` (already effective, any order). */
export function trimmedAverage(times: readonly number[]): number {
  if (times.length < 3) throw new RangeError('A trimmed average needs at least 3 times.');
  const dnfs = times.filter((t) => t === DNF).length;
  if (dnfs >= 2) return DNF;
  const sorted = [...times].sort((a, b) => a - b);
  const kept = sorted.slice(1, -1);
  return kept.reduce((sum, t) => sum + t, 0) / kept.length;
}

/** Average of the last `n` eligible solves (chronological input), or null. */
export function currentAverage(results: readonly TimedResult[], n: number): number | null {
  const pool = eligible(results);
  if (pool.length < n) return null;
  return trimmedAverage(pool.slice(-n).map(effectiveMs));
}

/** Best rolling average of `n` over the eligible solves, or null. */
export function bestAverage(results: readonly TimedResult[], n: number): number | null {
  const times = eligible(results).map(effectiveMs);
  if (times.length < n) return null;
  let best = DNF;
  for (let i = 0; i + n <= times.length; i++) {
    const avg = trimmedAverage(times.slice(i, i + n));
    if (avg < best) best = avg;
  }
  return best;
}

/** Mean of finished eligible solves (DNFs excluded), or null. */
export function sessionMean(results: readonly TimedResult[]): number | null {
  const finished = eligible(results).map(effectiveMs).filter((t) => t !== DNF);
  if (finished.length === 0) return null;
  return finished.reduce((a, b) => a + b, 0) / finished.length;
}

export interface StatsSummary {
  readonly count: number;
  readonly finished: number;
  readonly best: number | null;
  readonly ao5: number | null;
  readonly ao12: number | null;
  readonly bestAo5: number | null;
  readonly bestAo12: number | null;
  readonly mean: number | null;
}

export function summarize(results: readonly TimedResult[]): StatsSummary {
  const pool = eligible(results);
  return {
    count: pool.length,
    finished: pool.filter((r) => r.penalty !== 'DNF').length,
    best: bestSingle(pool),
    ao5: currentAverage(pool, 5),
    ao12: currentAverage(pool, 12),
    bestAo5: bestAverage(pool, 5),
    bestAo12: bestAverage(pool, 12),
    mean: sessionMean(pool),
  };
}
