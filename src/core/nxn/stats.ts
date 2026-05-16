import { currentAverage, effectiveMs, eligible, sessionMean } from '../stats/stats';
import type { CubeEventId } from './catalog';
import type { NxSolve } from './session';

export function currentMeanOf3(solves: readonly NxSolve[]): number | null {
  const recent = eligible(solves).slice(-3);
  if (recent.length < 3) return null;
  const times = recent.map(effectiveMs);
  return times.some((time) => !Number.isFinite(time)) ? Infinity : times.reduce((total, time) => total + time, 0) / 3;
}

export function bestMeanOf3(solves: readonly NxSolve[]): number | null {
  const clean = eligible(solves);
  if (clean.length < 3) return null;
  let best = Infinity;
  for (let i = 0; i <= clean.length - 3; i++) {
    const times = clean.slice(i, i + 3).map(effectiveMs);
    if (times.every(Number.isFinite)) best = Math.min(best, times.reduce((sum, time) => sum + time, 0) / 3);
  }
  return best;
}

export interface NxStats {
  readonly count: number;
  readonly mean: number | null;
  readonly current: number | null;
  readonly secondary: number | null;
  readonly currentLabel: string;
  readonly secondaryLabel: string;
}

/** 6×6/7×7 use mean of three; the smaller events show rolling averages. */
export function summarizeNx(eventId: CubeEventId, solves: readonly NxSolve[]): NxStats {
  const clean = eligible(solves);
  const large = eventId === '666' || eventId === '777';
  return {
    count: clean.length,
    mean: sessionMean(clean),
    current: large ? currentMeanOf3(clean) : currentAverage(clean, 5),
    secondary: large ? bestMeanOf3(clean) : currentAverage(clean, 12),
    currentLabel: large ? 'Current mo3' : 'Current ao5',
    secondaryLabel: large ? 'Best mo3' : 'Current ao12',
  };
}
