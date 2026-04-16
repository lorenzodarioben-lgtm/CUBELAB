/**
 * Time formatting. Internally everything is exact milliseconds.
 *
 * `truncate` (default, used for singles and the live clock) never shows a time
 * better than what was achieved; `round` is used for averages and means.
 */
export type RoundingMode = 'truncate' | 'round';

const pad2 = (n: number) => n.toString().padStart(2, '0');

export function formatTime(ms: number | null, rounding: RoundingMode = 'truncate'): string {
  if (ms === null || Number.isNaN(ms)) return '—';
  if (ms === Number.POSITIVE_INFINITY) return 'DNF';
  const centis = rounding === 'round' ? Math.round(ms / 10) : Math.floor(ms / 10 + 1e-9);
  const cs = centis % 100;
  const totalSeconds = Math.floor(centis / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${pad2(cs)}`;
  if (totalMinutes > 0) return `${totalMinutes}:${pad2(seconds)}.${pad2(cs)}`;
  return `${totalSeconds}.${pad2(cs)}`;
}

/** Splits a formatted time into the whole part and the hundredths for display styling. */
export function splitTime(ms: number, rounding: RoundingMode = 'truncate'): { whole: string; fraction: string } {
  const text = formatTime(ms, rounding);
  const dot = text.lastIndexOf('.');
  if (dot < 0) return { whole: text, fraction: '' };
  return { whole: text.slice(0, dot), fraction: text.slice(dot) };
}

export function formatAverage(ms: number | null): string {
  return formatTime(ms, 'round');
}

export function formatTps(turns: number, ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0 || turns <= 0) return null;
  return (turns / (ms / 1000)).toFixed(2);
}
