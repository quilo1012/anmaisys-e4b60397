import type { PatternDayOverride } from "@/lib/overtime";

interface PatternHours {
  starts_at?: string | null;
  ends_at?: string | null;
  dayOverrides?: PatternDayOverride[];
}

const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const hhmm = (t: string) => t.slice(0, 5);

/**
 * The hours a person's rota gives them on this date, shown on their board name only
 * when they are not the standard 12-hour shift ("08:00–16:00"). Null when the rota has
 * no hours, or the hours are a full 12-hour shift.
 */
export function patternHoursLabel(pattern: PatternHours | null | undefined, onDate: string): string | null {
  if (!pattern) return null;
  const iso = ((new Date(`${onDate}T12:00:00`).getDay() + 6) % 7) + 1;
  const o = pattern.dayOverrides?.find((d) => d.weekday === iso);
  const start = o?.starts_at ?? pattern.starts_at;
  const end = o?.ends_at ?? pattern.ends_at;
  if (!start || !end) return null;
  const length = (mins(end) - mins(start) + 1440) % 1440;
  if (length === 12 * 60 || length === 0) return null;
  return `${hhmm(start)}–${hhmm(end)}`;
}
