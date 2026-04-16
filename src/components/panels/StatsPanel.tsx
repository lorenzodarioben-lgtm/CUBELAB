import { useMemo } from 'react';
import { History } from 'lucide-react';
import { useServices, useStudio } from '../../app/context';
import { DNF, effectiveMs, eligible, summarize, trimmedAverage } from '../../core/stats/stats';
import { formatAverage, formatTime } from '../../core/stats/format';
import type { SolveRecord } from '../../core/persistence/storage';
import { Button } from '../ui/primitives';

const CHART_POINTS = 40;

/** Tiny dependency-free trend chart of recent eligible singles and rolling ao5. */
function Sparkline({ records }: { records: readonly SolveRecord[] }) {
  const data = useMemo(() => {
    const pool = eligible(records).slice(-CHART_POINTS);
    const times = pool.map(effectiveMs);
    const ao5 = times.map((_, i) => (i >= 4 ? trimmedAverage(times.slice(i - 4, i + 1)) : null));
    const finite = [...times, ...ao5].filter((t): t is number => t !== null && t !== DNF);
    if (finite.length === 0) return null;
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const span = Math.max(1, max - min);
    return { times, ao5, min, max, span };
  }, [records]);

  if (!data || data.times.length < 2) return null;
  const W = 280;
  const H = 64;
  const pad = 6;
  const x = (i: number) => pad + (i / Math.max(1, data.times.length - 1)) * (W - pad * 2);
  const y = (t: number) => pad + (1 - (t - data.min) / data.span) * (H - pad * 2);
  /** Polyline point lists, broken wherever a value is missing or DNF. */
  const line = (values: ReadonlyArray<number | null>): string[] => {
    const segments: string[][] = [[]];
    values.forEach((t, i) => {
      if (t === null || t === DNF) {
        if (segments[segments.length - 1]!.length > 0) segments.push([]);
      } else {
        segments[segments.length - 1]!.push(`${x(i).toFixed(1)},${y(t).toFixed(1)}`);
      }
    });
    return segments.filter((seg) => seg.length > 1).map((seg) => seg.join(' '));
  };
  const best = Math.min(...data.times.filter((t) => t !== DNF));

  return (
    <figure className="sparkline">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trend of your last ${data.times.length} eligible solves`} preserveAspectRatio="none">
        {line(data.times).map((points, i) => (
          <polyline key={`t${i}`} points={points} className="sparkline__singles" />
        ))}
        {line(data.ao5).map((points, i) => (
          <polyline key={`a${i}`} points={points} className="sparkline__ao5" />
        ))}
        {data.times.map((t, i) =>
          t === DNF ? (
            <text key={i} x={x(i)} y={pad + 4} className="sparkline__dnf" textAnchor="middle">
              ×
            </text>
          ) : t === best ? (
            <circle key={i} cx={x(i)} cy={y(t)} r={3} className="sparkline__best" />
          ) : null,
        )}
      </svg>
      <figcaption>
        <span className="legend legend--singles">Singles</span>
        <span className="legend legend--ao5">ao5</span>
        <span className="legend legend--best">Best</span>
      </figcaption>
    </figure>
  );
}

export function StatsPanel() {
  const { ui } = useServices();
  const history = useStudio((s) => s.history);
  const summary = useMemo(() => summarize(history), [history]);
  const practice = history.length - summary.count;

  return (
    <section className="panel panel-stats" aria-labelledby="stats-title">
      <header className="panel__header">
        <h2 id="stats-title" className="eyebrow">
          Session
        </h2>
        <Button size="sm" variant="quiet" icon={<History size={14} />} onClick={() => ui.setState({ historyOpen: true })}>
          History{history.length > 0 ? ` · ${history.length}` : ''}
        </Button>
      </header>

      {summary.count === 0 ? (
        <div className="panel__empty panel__empty--stats">
          <p className="serif-lg">No timed solves yet.</p>
          <p>Scramble, then turn any face — the clock starts with your first move and stops on the solving turn.</p>
          {practice > 0 && <p className="muted">{practice} practice solve{practice === 1 ? '' : 's'} saved (not ranked).</p>}
        </div>
      ) : (
        <>
          <dl className="stat-grid">
            <div className="stat">
              <dt>Best</dt>
              <dd>{formatTime(summary.best)}</dd>
            </div>
            <div className="stat">
              <dt>ao5</dt>
              <dd>{formatAverage(summary.ao5)}</dd>
            </div>
            <div className="stat">
              <dt>ao12</dt>
              <dd>{formatAverage(summary.ao12)}</dd>
            </div>
            <div className="stat">
              <dt>Mean</dt>
              <dd>{formatAverage(summary.mean)}</dd>
            </div>
          </dl>
          <Sparkline records={history} />
          <p className="panel__meta panel__meta--row">
            <span>
              {summary.count} timed · {summary.finished} finished
            </span>
            {practice > 0 && <span>{practice} practice</span>}
            {summary.bestAo5 !== null && <span>best ao5 {formatAverage(summary.bestAo5)}</span>}
          </p>
        </>
      )}
    </section>
  );
}
