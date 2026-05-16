/** Accept seconds, or minutes:seconds, with up to millisecond precision. */
export function parseManualTime(text: string): number | null {
  const match = /^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = Number(match[2]);
  const fraction = Number((match[3] ?? '').padEnd(3, '0'));
  if (match[1] && seconds >= 60) return null;
  const result = minutes * 60_000 + seconds * 1000 + fraction;
  return Number.isFinite(result) && result > 0 && result <= 86_400_000 ? result : null;
}
