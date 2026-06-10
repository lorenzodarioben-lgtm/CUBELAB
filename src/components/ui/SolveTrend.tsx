import { formatTime } from '../../core/stats/format';
import { buildSolveTrend } from '../../core/stats/trend';
import type { TimedResult } from '../../core/stats/stats';

export function SolveTrend({ solves }: { readonly solves: readonly TimedResult[] }) {
  const trend = buildSolveTrend(solves);
  if (!trend) return null;
  const path = trend.points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const last = trend.points.at(-1)!;
  return <div className="solve-trend">
    <span>Recent clean singles</span>
    <svg viewBox="0 0 180 52" preserveAspectRatio="none" role="img" aria-label={`Recent solve times, from ${formatTime(trend.firstMs)} to ${formatTime(trend.lastMs)}`}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="3.5" fill="currentColor" />
    </svg>
  </div>;
}
