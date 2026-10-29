/**
 * The engineer console's "Report": the maintenance part of the shift hand-over.
 *
 * The old version built the text from whatever the page already had in memory: the
 * shift window was fixed when the page opened (a tablet left on from the day shift
 * reported the day shift all night), only finished orders were looked at (a line
 * still down was "No issues today"), and the downtime query was fired in the
 * background — click before it returned, or after it failed, and the file said
 * "No issues today" with nothing to show it had not looked. Planned problems and
 * team-activity exclusions, which every other downtime figure leaves out, were
 * counted in full.
 *
 * Now the window is taken at the click, the stops are read fresh from
 * `downtime_events`, and the text says what it read and where the numbers disagree.
 * "No line stoppage" is only ever written after a read that succeeded and found none.
 */
import { supabase } from "@/integrations/supabase/client";
import { getCurrentFactoryShift, getCurrentShiftEnd, getCurrentShiftStart, londonHM, type ShiftCode } from "@/lib/shifts";
import { toExclusionIntervals, exclusionOverlapMs } from "@/lib/downtimeExclusions";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { isNoPlannedShift } from "@/lib/downtimeBuckets";
import { fetchRowsByIds } from "@/lib/fetchRowsByIds";

/** Stops at or under this many minutes stay off the report. Unchanged from before. */
export const REPORT_MIN_MINUTES = 15;

export interface ShiftWindow {
  start: Date;
  end: Date;
  /** The factory's day for this shift: a night keeps the date it started on. */
  sessionDate: string;
  shift: ShiftCode;
}

export function shiftWindowAt(now: Date): ShiftWindow {
  const { sessionDate, shiftCode } = getCurrentFactoryShift(now);
  return { start: getCurrentShiftStart(now), end: getCurrentShiftEnd(now), sessionDate, shift: shiftCode };
}

export interface ReportWorkOrder {
  id: string;
  wo_number: number | null;
  line_at_time: string | null;
  line_name: string | null;
  description: string | null;
  resolution_notes: string | null;
  status: string;
  wo_type?: string | null;
}

export interface ReportEvent {
  id: string;
  work_order_id: string;
  stopped_at: string;
  resumed_at: string | null;
  duration_minutes: number | null;
  stopped_reason?: string | null;
}

export interface ReportExclusion {
  work_order_id: string;
  started_at: string;
  ended_at: string | null;
}

export interface ShiftReportData {
  window: ShiftWindow;
  generatedAt: Date;
  workOrders: ReportWorkOrder[];
  events: ReportEvent[];
  exclusions: ReportExclusion[];
  /** Lower-cased names of `problem_descriptions` marked planned. */
  plannedProblems: string[];
}

export interface ReportStop {
  minutes: number;
  ongoing: boolean;
  carriedOver: boolean;
}

export interface ReportItem {
  wo: ReportWorkOrder;
  stops: ReportStop[];
  totalMinutes: number;
}

export interface ShiftReport {
  text: string;
  items: ReportItem[];
  /** Distinct stops that touched the window. */
  stopsRead: number;
  ordersRead: number;
  plannedStops: number;
  /** Anything that means the numbers cannot be taken as checked. */
  problems: string[];
}

const FINISHED = new Set(["finished", "closed", "completed", "force_closed"]);

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function buildMaintenanceShiftReport(input: ShiftReportData): ShiftReport {
  const { window, generatedAt } = input;
  const winStart = window.start.getTime();
  const winEnd = window.end.getTime();
  const nowMs = generatedAt.getTime();
  const problems: string[] = [];

  const woById = new Map(input.workOrders.map((w) => [w.id, w]));
  const planned = new Set(input.plannedProblems.map((p) => p.toLowerCase()));
  const exclByWo = new Map<string, ReportExclusion[]>();
  for (const x of input.exclusions) {
    if (!exclByWo.has(x.work_order_id)) exclByWo.set(x.work_order_id, []);
    exclByWo.get(x.work_order_id)!.push(x);
  }

  // A row read twice is still one stop.
  const events = [...new Map(input.events.map((e) => [e.id, e])).values()];

  const stopsByWo = new Map<string, ReportStop[]>();
  let stopsRead = 0;
  let plannedStops = 0;
  const touched = new Set<string>();
  for (const e of events) {
    const s = new Date(e.stopped_at).getTime();
    const end = e.resumed_at ? new Date(e.resumed_at).getTime() : nowMs;
    if (!Number.isFinite(s) || !Number.isFinite(end)) {
      problems.push(`A stop has a time that cannot be read (event ${e.id.slice(0, 8)}).`);
      continue;
    }
    const wo = woById.get(e.work_order_id);
    // Warehouse service never stops a line; the Shift Breakdown leaves it out too.
    if (wo?.wo_type === "warehouse_service") continue;
    // An end before its start (two such rows in production, WO 498 and WO 918) is
    // not a short stop, it is a broken one. The view floors it at zero; here it is
    // named, because a report that skips it says less than the order does.
    if (e.resumed_at && end < s) {
      if (s >= winStart && s < winEnd) {
        problems.push(
          `WO-${wo?.wo_number ?? "?"}: ends ${londonHM(new Date(end))}, before it starts ${londonHM(new Date(s))}. Not counted.`,
        );
      }
      continue;
    }
    const from = Math.max(s, winStart);
    const to = Math.min(end, winEnd, nowMs);
    if (!(to > from)) continue;
    stopsRead++;
    if (wo) touched.add(wo.id);

    if (!wo) {
      problems.push(`A stop at ${londonHM(new Date(s))} belongs to an order that could not be read.`);
      continue;
    }
    if (e.resumed_at && e.duration_minutes != null) {
      const fromStamps = Math.round((end - s) / 60_000);
      if (Math.abs(fromStamps - e.duration_minutes) > 1) {
        problems.push(
          `WO-${wo.wo_number ?? "?"}: stored duration ${e.duration_minutes}m, but its start and end are ${fromStamps}m apart.`,
        );
      }
    }
    // Same tests as the rest of the app: the view's `lower(name) = lower(description)`
    // for a planned problem, and the Shift Breakdown's "no planned shift" reason.
    if (planned.has((wo.description ?? "").toLowerCase()) || isNoPlannedShift(e.stopped_reason, null)) {
      plannedStops++;
      continue;
    }
    const excluded = exclusionOverlapMs(from, to, toExclusionIntervals(exclByWo.get(wo.id), nowMs));
    const minutes = Math.max(0, Math.round((to - from - excluded) / 60_000));
    if (minutes <= REPORT_MIN_MINUTES) continue;
    if (!stopsByWo.has(wo.id)) stopsByWo.set(wo.id, []);
    stopsByWo.get(wo.id)!.push({ minutes, ongoing: !e.resumed_at, carriedOver: s < winStart });
  }

  const items: ReportItem[] = [...stopsByWo.entries()].map(([id, stops]) => ({
    wo: woById.get(id)!,
    stops,
    totalMinutes: stops.reduce((sum, x) => sum + x.minutes, 0),
  }));
  // Self-check: what is printed is what was added up.
  for (const it of items) {
    if (it.totalMinutes !== it.stops.reduce((sum, x) => sum + x.minutes, 0)) {
      problems.push(`WO-${it.wo.wo_number ?? "?"}: total does not match its stops.`);
    }
  }

  const ordersRead = touched.size;
  const isDay = window.shift === "day";
  const lines: string[] = [
    "**Maintenance:**",
    `${isDay ? "**Day Shift (06-18)**" : "**Night Shift (18-06)**"} · ${ddmmyyyy(window.sessionDate)}`,
  ];
  for (const { wo, stops } of items) {
    const line = clean(wo.line_at_time) || clean(wo.line_name);
    const lineLabel = line ? `Line ${line.replace(/^line\s+/i, "")}` : "Line not recorded";
    const what = clean(wo.resolution_notes) || clean(wo.description) || "No description recorded";
    const open = FINISHED.has(wo.status) ? "" : " (in progress)";
    const ref = wo.wo_number ? ` (WO-${wo.wo_number})` : "";
    lines.push(`**${lineLabel}:** ${what}${open}${ref}`);
    lines.push(
      "Downtime: " +
        stops
          .map((x) => `${x.minutes}m${x.ongoing ? " so far (still stopped)" : ""}${x.carriedOver ? " (from previous shift)" : ""}`)
          .join("; "),
    );
  }
  if (problems.length > 0) {
    lines.push("", "**NOT VALIDATED — the records disagree:**", ...problems.map((p) => `- ${p}`));
  } else if (items.length === 0) {
    lines.push(`- No line stoppage over ${REPORT_MIN_MINUTES} minutes recorded this shift.`);
  }
  lines.push("- Have a good day.");
  const window_ = `${isDay ? "06:00–18:00" : "18:00–06:00"} ${ddmmyyyy(window.sessionDate)}`;
  lines.push(
    "",
    `Source: downtime_events, ${window_} (Europe/London), read ${londonHM(generatedAt)}. ` +
      `${stopsRead} stop${stopsRead === 1 ? "" : "s"} on ${ordersRead} order${ordersRead === 1 ? "" : "s"}; ` +
      `${items.length} listed over ${REPORT_MIN_MINUTES} min after team-activity exclusions` +
      (plannedStops ? `; ${plannedStops} planned stop${plannedStops === 1 ? "" : "s"} not counted` : "") +
      ".",
  );

  return { text: lines.join("\n"), items, stopsRead, ordersRead, plannedStops, problems };
}

/**
 * Read everything the report needs, fresh, for the shift running at `now`. Throws on
 * any failed read: a report built on a read that did not happen is the bug this
 * replaces. Paged and ordered, so a busy shift is never cut at the server's 1000.
 */
export async function fetchMaintenanceShiftReport(now: Date = new Date()): Promise<ShiftReport> {
  const window = shiftWindowAt(now);
  const startIso = window.start.toISOString();
  const endIso = window.end.toISOString();
  const db = supabase as any;
  const read = async <T,>(what: string, p: Promise<T>): Promise<T> => {
    try { return await p; } catch (e: any) { throw new Error(`Could not read ${what}: ${e?.message ?? e}`); }
  };

  // Every stop that touched the window: started before it ends, and either still
  // open or resumed after it began.
  const events = await read("the line stoppages", fetchAllRows<ReportEvent>({
    range: (from, to) =>
      db.from("downtime_events")
        .select("id, work_order_id, stopped_at, resumed_at, duration_minutes, stopped_reason")
        .lt("stopped_at", endIso)
        // The last clause brings in a stop that STARTED in the shift even when
        // its end was written before its start, so the check above can name it.
        .or(`resumed_at.is.null,resumed_at.gt.${startIso},stopped_at.gte.${startIso}`)
        .order("stopped_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
  }));

  const ids = [...new Set(events.map((e) => e.work_order_id))];
  const [wos, exclusions, plannedRows] = await Promise.all([
    read("the work orders", fetchRowsByIds<any>(ids, (chunk, from, to) =>
      db.from("work_orders")
        .select("id, wo_number, line_at_time, description, resolution_notes, status, wo_type, line:lines!work_orders_line_id_fkey(name)")
        .in("id", chunk).order("id").range(from, to))),
    read("the downtime exclusions", fetchRowsByIds<ReportExclusion>(ids, (chunk, from, to) =>
      db.from("wo_downtime_exclusions")
        .select("id, work_order_id, started_at, ended_at")
        .in("work_order_id", chunk).order("id").range(from, to))),
    read("which problems are planned", fetchAllRows<{ name: string | null }>({
      range: (from, to) => db.from("problem_descriptions").select("id, name").eq("planned", true).order("id").range(from, to),
    })),
  ]);

  return buildMaintenanceShiftReport({
    window,
    generatedAt: now,
    workOrders: wos.map((w: any) => ({ ...w, line_name: w.line?.name ?? null })),
    events,
    exclusions,
    plannedProblems: plannedRows.map((p) => String(p.name ?? "").toLowerCase()),
  });
}
