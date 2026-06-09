import { effectiveMs } from './stats';
import type { TimedResult } from './stats';

export interface CsvSolve extends TimedResult {
  readonly id: string;
  readonly at: number;
  readonly scramble: string;
  readonly moves: number;
  readonly source: 'virtual' | 'manual';
}

function field(value: string | number | boolean): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportPracticeCsv(eventId: string, solves: readonly CsvSolve[]): string {
  const rows = [['id', 'event', 'timestamp_utc', 'raw_seconds', 'penalty', 'effective_seconds', 'source', 'moves', 'assisted', 'scramble'].join(',')];
  for (const solve of solves) {
    const effective = effectiveMs(solve);
    rows.push([
      solve.id,
      eventId,
      new Date(solve.at).toISOString(),
      (solve.durationMs / 1000).toFixed(3),
      solve.penalty,
      Number.isFinite(effective) ? (effective / 1000).toFixed(3) : 'DNF',
      solve.source,
      solve.moves,
      solve.assisted,
      solve.scramble,
    ].map(field).join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}
