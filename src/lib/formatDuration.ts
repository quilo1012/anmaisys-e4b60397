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

/**
 * The same duration, without the "0h" in front of a sub-hour figure, and with the
 * minutes padded once there is an hour to read them against: "45m", "1h 05m".
 *
 * This lived in useDailyIssueSummary.ts under the name `formatDuration` — a second
 * function with the same name and the same signature as the one above, disagreeing
 * with it. 2700 seconds was "0h 45m" here and "45m" there; 3660 was "1h 1m" against
 * "1h 01m". Nothing linked the two files, so the same stop printed two ways on two
 * screens and neither looked wrong on its own.
 *
 * Both renderings are wanted: this one goes into a block of text an admin pastes into
 * a weekly report, where "0h" in front of every short stop is noise. What is gone is
 * the second definition. The name now says which one you are getting.
 *
 * The copy also printed "NaNh NaNm" for NaN — `NaN < 60` is false, so it fell through
 * to the hours branch.
 */
export function formatDurationCompact(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}
