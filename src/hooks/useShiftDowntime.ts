import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DowntimeEvent } from "@/hooks/useDowntimeEvents";

/**
 * Returns Day/Night shift downtime events for a given local (Europe/London) date.
 * - Day shift: selected date 06:00 → 18:00 (London)
 * - Night shift: selected date 18:00 → next day 06:00 (London)
 *
 * Includes any event that overlaps the shift window (open or closed).
 */
export type ShiftType = "day" | "night";

export interface ShiftDowntimeData {
  day: DowntimeEvent[];
  night: DowntimeEvent[];
}

/** Build a Date in London local time then convert to UTC for query bounds. */
function londonDateAtHour(dateISO: string, hour: number): Date {
  // dateISO = 'YYYY-MM-DD'. Build a UTC reference, then offset using London hour math.
  // We pass through Intl to detect the offset for that wall-clock instant.
  const naiveUtc = new Date(`${dateISO}T${String(hour).padStart(2, "0")}:00:00Z`);
  const offsetMin = getLondonOffsetMinutes(naiveUtc);
  // London wall-clock h:00 = UTC (h - offsetHours):00
  return new Date(naiveUtc.getTime() - offsetMin * 60_000);
}

function getLondonOffsetMinutes(at: Date): number {
  // Use Intl to compare London time vs UTC
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour"), get("minute"), get("second"),
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
}

export function getShiftWindows(dateISO: string) {
  const dayStart = londonDateAtHour(dateISO, 6);
  const dayEnd = londonDateAtHour(dateISO, 18);
  // Night = same day 18:00 → next day 06:00
  const next = new Date(dateISO + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const nextISO = next.toISOString().slice(0, 10);
  const nightStart = dayEnd;
  const nightEnd = londonDateAtHour(nextISO, 6);
  return { dayStart, dayEnd, nightStart, nightEnd };
}

export function useShiftDowntime(dateISO: string) {
  return useQuery({
    queryKey: ["shift_downtime", dateISO],
    queryFn: async (): Promise<ShiftDowntimeData> => {
      const { dayStart, nightEnd } = getShiftWindows(dateISO);
      // Fetch any event that could overlap (stopped before nightEnd AND (resumed_at>=dayStart OR open))
      const { data, error } = await (supabase as any)
        .from("downtime_events")
        .select("*")
        .lt("stopped_at", nightEnd.toISOString())
        .or(`resumed_at.gte.${dayStart.toISOString()},resumed_at.is.null`)
        .order("stopped_at", { ascending: true });
      if (error) throw error;
      const events = (data || []) as DowntimeEvent[];
      return splitByShift(events, dateISO);
    },
    refetchInterval: 30_000,
  });
}

/** Allocate each event's duration to day/night windows based on overlap. */
export function splitByShift(events: DowntimeEvent[], dateISO: string): ShiftDowntimeData {
  const { dayStart, dayEnd, nightStart, nightEnd } = getShiftWindows(dateISO);
  const day: DowntimeEvent[] = [];
  const night: DowntimeEvent[] = [];
  events.forEach((e) => {
    const start = new Date(e.stopped_at).getTime();
    const end = e.resumed_at ? new Date(e.resumed_at).getTime() : Date.now();
    if (overlap(start, end, dayStart.getTime(), dayEnd.getTime()) > 0) day.push(e);
    if (overlap(start, end, nightStart.getTime(), nightEnd.getTime()) > 0) night.push(e);
  });
  return { day, night };
}

export function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** Minutes of an event that fall within [winStart, winEnd]. */
export function eventMinutesInWindow(e: DowntimeEvent, winStart: Date, winEnd: Date): number {
  const start = new Date(e.stopped_at).getTime();
  const end = e.resumed_at ? new Date(e.resumed_at).getTime() : Date.now();
  return Math.round(overlap(start, end, winStart.getTime(), winEnd.getTime()) / 60_000);
}
