/** Time-only annotations from a record; no shift inference or clock dependency. */
export function nextDaySuffix(startsAt: string, endsAt: string): string {
  const start = startsAt.slice(0, 5), end = endsAt.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && end <= start ? " +1" : "";
}

export function ShiftTimeRange({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  return <span className="inline-flex flex-wrap items-baseline gap-1 tabular-nums">
    <span>{startsAt.slice(0, 5)}–{endsAt.slice(0, 5)}</span>
    {nextDaySuffix(startsAt, endsAt) && <sup className="text-2xs font-semibold" title="Ends the next calendar day">+1</sup>}
  </span>;
}