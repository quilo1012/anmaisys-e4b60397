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

      // 1) Per-WO downtime events (new model) + manual downtime records.
      // Keep this source set aligned with useDowntime(), otherwise Shift Breakdown
      // and Downtime Records can legitimately show different totals.
      const [dtRes, manualRes] = await Promise.all([
        (supabase as any)
          .from("downtime_events")
          .select("*, work_order:work_orders!inner(machine, wo_type, line_at_time, line:lines!work_orders_line_id_fkey(name))")
          .neq("work_order.wo_type", "warehouse_service")
          .lt("stopped_at", nightEnd.toISOString())
          .or(`resumed_at.gte.${dayStart.toISOString()},resumed_at.is.null`)
          .order("stopped_at", { ascending: true }),
        (supabase as any)
          .from("downtime")
          .select("*")
          .lt("started_at", nightEnd.toISOString())
          .or(`ended_at.gte.${dayStart.toISOString()},ended_at.is.null`)
          .order("started_at", { ascending: true }),
      ]);
      if (dtRes.error) throw dtRes.error;
      if (manualRes.error) throw manualRes.error;

      const dtData = dtRes.data || [];
      const events = (dtData || []).map((event: any) => ({
        ...event,
        machine: event.work_order?.machine ?? null,
        line_at_time: event.work_order?.line?.name || event.work_order?.line_at_time || null,
        line_name: event.work_order?.line?.name || null,
      })) as DowntimeEvent[];
      const woIdsWithEvents = new Set(events.map((e) => e.work_order_id));

      const manualEvents = (manualRes.data || []).map((r: any) => ({
        id: `manual-${r.id}`,
        work_order_id: r.work_order_id || `manual-${r.id}`,
        stopped_at: r.started_at,
        stopped_by: r.reported_by,
        stopped_by_name: null,
        stopped_reason: r.reason || null,
        resumed_at: r.ended_at,
        resumed_by: null,
        resumed_by_name: null,
        resumed_note: r.notes || null,
        duration_minutes: null,
        created_at: r.created_at,
        machine: r.machine || null,
        line_at_time: r.line || null,
        line_name: r.line || null,
      })) as DowntimeEvent[];

      // 2) Fallback: legacy work_orders with line_stopped_at populated but no event row
      const { data: woData, error: woErr } = await (supabase as any)
        .from("work_orders")
        .select("id, wo_type, machine, line_at_time, line_stopped_at, line_stopped_by, line_resumed_at, line_resumed_by, created_at, line:lines!work_orders_line_id_fkey(name)")
        .neq("wo_type", "warehouse_service")
        .not("line_stopped_at", "is", null)
        .lt("line_stopped_at", nightEnd.toISOString())
        .or(`line_resumed_at.gte.${dayStart.toISOString()},line_resumed_at.is.null`);
      if (woErr) throw woErr;

      const synthetic: DowntimeEvent[] = (woData || [])
        .filter((w: any) => !woIdsWithEvents.has(w.id))
        .map((w: any) => ({
          id: `wo-${w.id}`,
          work_order_id: w.id,
          stopped_at: w.line_stopped_at,
          stopped_by: w.line_stopped_by,
          stopped_by_name: null,
          stopped_reason: w.machine || w.line_at_time || null,
          resumed_at: w.line_resumed_at,
          resumed_by: w.line_resumed_by,
          resumed_by_name: null,
          resumed_note: null,
          duration_minutes: null,
          created_at: w.created_at,
          // attach for label aggregation
          machine: w.machine,
          line_at_time: w.line?.name || w.line_at_time,
          line_name: w.line?.name || null,
        } as any));

      return splitByShift([...events, ...synthetic, ...manualEvents], dateISO);
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
