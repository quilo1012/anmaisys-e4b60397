/**
 * Single source-of-truth duration formatter.
 * Always renders as "Xh Ym" (e.g. "1h 25m", "0h 45m", "2h 0m").
 * No seconds. Always pair with a metric label (e.g. "Line Downtime: " + formatDuration(sec)).
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return "—";
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

/**
 * Same standard format ("Xh Ym") but receives MINUTES instead of seconds.
 * Use when an upstream value is already in minutes.
 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || isNaN(minutes)) return "—";
  return formatDuration(minutes * 60);
}

/**
 * Standardized MTBF formatter. Input in HOURS.
 * - < 24h: "2h 30min" (or "45min" when under an hour)
 * - >= 24h: "3.5 days" (one decimal)
 */
export function formatMTBF(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || isNaN(hours) || hours < 0) return "—";
  if (hours >= 24) {
    const days = hours / 24;
    return `${days.toFixed(1)} days`;
  }
  const h = Math.floor(hours);
  const min = Math.round((hours - h) * 60);
  if (h === 0) return `${min}min`;
  if (min === 0) return `${h}h`;
  return `${h}h ${min}min`;
}
