/**
 * The engineer console's "Report": the maintenance report for one shift.
 *
 * The report answers three questions, in this order: how much counted downtime the
 * shift had, which work orders were genuinely completed, and which are still open.
 *
 * What it deliberately does NOT carry (owner's decision, 01/11/2026): database source
 * names, who generated it, long period descriptions, planned-stop / team-activity /
 * not-validated counters, a hand-over section and greetings. Those details are still
 * computed — `problems` and the counters stay on the report object for the dialog's
 * "Checked / NOT validated" badge and the audit history — but they are not printed.
 *
 * Data accuracy rules:
 * - A work order is "completed" only when its status is a finished one AND its
 *   completion time (finished_at, else completed_at, else closed_at) falls inside
 *   the shift. Open orders are listed separately and never counted as completed.
 * - Downtime comes from the validated downtime records: every stop that touched the
 *   shift, clipped to the shift, minus planned stops and team-activity exclusions —
 *   the same rules the rest of the app uses. There is no minimum-minutes floor: a
 *   1-minute stop is real downtime and is counted.
 * - Nothing is invented: a missing name, repair description, engineer or downtime
 *   value is shown as missing, never guessed.
 */
import { supabase } from "@/integrations/supabase/client";
import { getCurrentFactoryShift, getCurrentShiftEnd, getCurrentShiftStart, londonHM, londonWallToUtc, type ShiftCode } from "@/lib/shifts";
import { toExclusionIntervals, exclusionOverlapMs } from "@/lib/downtimeExclusions";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { isNoPlannedShift } from "@/lib/downtimeBuckets";
import { fetchRowsByIds } from "@/lib/fetchRowsByIds";
import { formatMinutes } from "@/lib/formatDuration";

/** At most this many open orders are written out; the rest are counted. */
export const OPEN_MAX_LISTED = 20;

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

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The shift that `sessionDate` names. Day: 06:00–18:00 that day. Night: 18:00 that day
 * to 06:00 the next — the night keeps the date it started on. London wall-clock times,
 * resolved at each boundary, so a night across a clock change is 11 or 13 hours long
 * rather than a fixed 12 hours after a fixed UTC offset.
 */
export function shiftWindowFor(sessionDate: string, shift: ShiftCode): ShiftWindow {
  const m = ISO_DATE.exec(sessionDate);
  if (!m) throw new Error(`Not a date: ${sessionDate}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`Not a date: ${sessionDate}`);
  }
  if (shift === "day") {
    return { start: new Date(londonWallToUtc(y, mo, d, 6)), end: new Date(londonWallToUtc(y, mo, d, 18)), sessionDate, shift };
  }
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return {
    start: new Date(londonWallToUtc(y, mo, d, 18)),
    end: new Date(londonWallToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 6)),
    sessionDate,
    shift,
  };
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type QuickShift = "current" | "previous" | "yesterday-day" | "yesterday-night";

/** The four one-tap choices. "Yesterday" is the factory day before the running one. */
export function quickShift(kind: QuickShift, now: Date): { sessionDate: string; shift: ShiftCode } {
  const cur = shiftWindowAt(now);
  switch (kind) {
    case "current": return { sessionDate: cur.sessionDate, shift: cur.shift };
    case "previous": {
      const prev = shiftWindowAt(new Date(cur.start.getTime() - 1));
      return { sessionDate: prev.sessionDate, shift: prev.shift };
    }
    case "yesterday-day": return { sessionDate: addDays(cur.sessionDate, -1), shift: "day" };
    case "yesterday-night": return { sessionDate: addDays(cur.sessionDate, -1), shift: "night" };
  }
}

/** A window that can be reported on, or the sentence saying why not. */
export function validateShiftSelection(
  sessionDate: string,
  shift: ShiftCode,
  now: Date,
): { ok: true; window: ShiftWindow } | { ok: false; error: string } {
  let window: ShiftWindow;
  try { window = shiftWindowFor(sessionDate, shift); } catch { return { ok: false, error: "Choose a valid date." }; }
  if (window.start.getTime() > now.getTime()) return { ok: false, error: "That shift has not started yet." };
  return { ok: true, window };
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
  engineer_name?: string | null;
  machine?: string | null;
  /** When it was finished: finished_at, else completed_at, else closed_at. */
  completed_at_effective?: string | null;
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

/** An order not yet finished, as it stands when the report is generated. */
export interface PendingOrder {
  id: string;
  wo_number: number | null;
  line_at_time: string | null;
  line_name: string | null;
  description: string | null;
  status: string;
  engineer_name: string | null;
  created_at: string;
}

export interface ShiftReportData {
  window: ShiftWindow;
  generatedAt: Date;
  /** Orders behind the stops that touched the shift. */
  workOrders: ReportWorkOrder[];
  events: ReportEvent[];
  exclusions: ReportExclusion[];
  /** Lower-cased names of `problem_descriptions` marked planned. */
  plannedProblems: string[];
  /** Who generated it. Kept for the audit history; never printed. */
  generatedBy?: string | null;
  /** Orders genuinely completed inside the shift (status finished + completion time in window). */
  completedOrders?: ReportWorkOrder[];
  /** Orders still open now. */
  pending?: PendingOrder[];
}

export interface ReportStop {
  minutes: number;
  ongoing: boolean;
  carriedOver: boolean;
}

/** A genuinely completed work order, with the downtime its stops caused this shift. */
export interface CompletedOrder {
  wo: ReportWorkOrder;
  stops: ReportStop[];
  totalMinutes: number;
}

export type StopVerdict = "counted" | "planned" | "inverted" | "order not read";

/** Every stop that touched the shift and what the report did with it — the audit trail. */
export interface StopRow {
  woNumber: number | null;
  line: string;
  description: string;
  status: string;
  stoppedAt: string;
  resumedAt: string | null;
  /** Minutes inside the shift after exclusions; null for a stop that was not counted. */
  minutes: number | null;
  excludedMinutes: number;
  verdict: StopVerdict;
}

export interface ShiftReport {
  window: ShiftWindow;
  generatedAt: Date;
  generatedBy: string | null;
  text: string;
  /** Genuinely completed in this shift, newest completion first. */
  completed: CompletedOrder[];
  /** Still open now, as recorded. Never counted as completed. */
  open: PendingOrder[];
  /** Validated stops that touched the window and were counted. */
  downtimeEvents: number;
  /** Sum of the counted stops' minutes inside the window, after exclusions. */
  totalCountedMinutes: number;
  rows: StopRow[];
  /** Distinct stops that touched the window, counted or not. */
  stopsRead: number;
  ordersRead: number;
  plannedStops: number;
  /** Minutes of team activity taken off the stops that were counted. */
  excludedMinutes: number;
  /** Anything that means the numbers cannot be taken as checked. */
  problems: string[];
}

const FINISHED = new Set(["finished", "closed", "completed", "force_closed"]);
/** Statuses an order passes through before the engineer finishes it. */
export const PENDING_STATUSES = ["open", "received", "arrived", "in_progress"] as const;

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "30/10/2026 18:00" on the factory's clock. */
export function londonStamp(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
}

export const shiftLabel = (s: ShiftCode) => (s === "day" ? "Day Shift (06:00–18:00)" : "Night Shift (18:00–06:00)");

export function lineLabelOf(lineAtTime: string | null, lineName: string | null): string {
  const line = clean(lineAtTime) || clean(lineName);
  return line ? `Line ${line.replace(/^line\s+/i, "")}` : "Line not recorded";
}

/** `Maintenance_Report_Night_Shift_2026-10-30.pdf` */
export function reportFileName(w: Pick<ShiftWindow, "sessionDate" | "shift">, ext: "pdf" | "txt" | "xlsx"): string {
  return `Maintenance_Report_${w.shift === "day" ? "Day" : "Night"}_Shift_${w.sessionDate}.${ext}`;
}

/** The heading of a completed order: "Line 2 – WO-1451". */
export function completedHeading(wo: ReportWorkOrder): string {
  const ref = wo.wo_number ? `WO-${wo.wo_number}` : "WO number not recorded";
  return `${lineLabelOf(wo.line_at_time, wo.line_name)} – ${ref}`;
}

export function buildMaintenanceShiftReport(input: ShiftReportData): ShiftReport {
  const { window, generatedAt } = input;
  const winStart = window.start.getTime();
  const winEnd = window.end.getTime();
  const nowMs = generatedAt.getTime();
  const problems: string[] = [];
  const rows: StopRow[] = [];

  const woById = new Map(input.workOrders.map((w) => [w.id, w]));
  const planned = new Set(input.plannedProblems.map((p) => p.toLowerCase()));
  const exclByWo = new Map<string, ReportExclusion[]>();
  for (const x of input.exclusions) {
    if (!exclByWo.has(x.work_order_id)) exclByWo.set(x.work_order_id, []);
    exclByWo.get(x.work_order_id)!.push(x);
  }

  // A row read twice is still one stop; and the file lists in the order the line
  // stopped, whatever order the rows arrived in.
  const events = [...new Map(input.events.map((e) => [e.id, e])).values()]
    .sort((x, y) => new Date(x.stopped_at).getTime() - new Date(y.stopped_at).getTime());

  const stopsByWo = new Map<string, ReportStop[]>();
  let stopsRead = 0;
  let plannedStops = 0;
  let excludedMinutes = 0;
  let downtimeEvents = 0;
  let totalCountedMinutes = 0;
  const touched = new Set<string>();
  const row = (e: ReportEvent, wo: ReportWorkOrder | undefined, verdict: StopVerdict, minutes: number | null, excluded = 0) =>
    rows.push({
      woNumber: wo?.wo_number ?? null,
      line: wo ? lineLabelOf(wo.line_at_time, wo.line_name) : "—",
      description: clean(wo?.description) || "—",
      status: wo?.status ?? "—",
      stoppedAt: e.stopped_at,
      resumedAt: e.resumed_at,
      minutes,
      excludedMinutes: excluded,
      verdict,
    });

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
    // An end before its start is not a short stop, it is a broken one. The view
    // floors it at zero; here it is named, because a report that skips it says less
    // than the order does.
    if (e.resumed_at && end < s) {
      if (s >= winStart && s < winEnd) {
        problems.push(
          `WO-${wo?.wo_number ?? "?"}: ends ${londonHM(new Date(end))}, before it starts ${londonHM(new Date(s))}. Not counted.`,
        );
        row(e, wo, "inverted", null);
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
      row(e, wo, "order not read", null);
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
      row(e, wo, "planned", null);
      continue;
    }
    const excluded = exclusionOverlapMs(from, to, toExclusionIntervals(exclByWo.get(wo.id), nowMs));
    const excludedMin = Math.round(excluded / 60_000);
    excludedMinutes += excludedMin;
    const minutes = Math.max(0, Math.round((to - from - excluded) / 60_000));
    row(e, wo, "counted", minutes, excludedMin);
    downtimeEvents++;
    totalCountedMinutes += minutes;
    if (!stopsByWo.has(wo.id)) stopsByWo.set(wo.id, []);
    stopsByWo.get(wo.id)!.push({ minutes, ongoing: !e.resumed_at, carriedOver: s < winStart });
  }

  // Genuinely completed in this shift. The list comes from the completed-orders read,
  // never from the stops: an order finished without a line stoppage is still completed,
  // and an open order with a long stop is still open.
  const completed: CompletedOrder[] = (input.completedOrders ?? [])
    .filter((w) => FINISHED.has(w.status) && w.wo_type !== "warehouse_service")
    .map((w) => {
      const stops = stopsByWo.get(w.id) ?? [];
      return { wo: w, stops, totalMinutes: stops.reduce((sum, x) => sum + x.minutes, 0) };
    })
    .sort((a, b) => {
      const ta = a.wo.completed_at_effective ? new Date(a.wo.completed_at_effective).getTime() : 0;
      const tb = b.wo.completed_at_effective ? new Date(b.wo.completed_at_effective).getTime() : 0;
      return tb - ta || (a.wo.wo_number ?? 0) - (b.wo.wo_number ?? 0);
    });

  const open = (input.pending ?? []).filter((p) => (PENDING_STATUSES as readonly string[]).includes(p.status));

  // Self-check: what is printed is what was added up, and the audit trail agrees.
  const countedRows = rows.filter((r) => r.verdict === "counted");
  if (countedRows.length !== downtimeEvents || countedRows.reduce((n, r) => n + (r.minutes ?? 0), 0) !== totalCountedMinutes) {
    problems.push("The stops counted do not match the stops listed.");
  }

  // ── Text (WhatsApp-friendly: *bold*, short lines, no technical detail) ──
  const by = clean(input.generatedBy);
  const lines: string[] = [
    "*Maintenance Report*",
    `${window.shift === "day" ? "Day" : "Night"} Shift · ${ddmmyyyy(window.sessionDate)}`,
  ];
  if (winEnd > nowMs) lines.push(`Shift still running — figures up to ${londonHM(generatedAt)}.`);
  lines.push(
    "",
    "*Shift summary*",
    `Completed work orders: ${completed.length}`,
    `Downtime events: ${downtimeEvents}`,
    `Total counted downtime: ${formatMinutes(totalCountedMinutes)}`,
    "",
    "*Completed work orders*",
  );
  if (completed.length === 0) {
    lines.push("None completed this shift.");
  }
  for (const { wo, totalMinutes } of completed) {
    const machine = clean(wo.machine);
    const problem = clean(wo.description) || "Not recorded";
    const work = clean(wo.resolution_notes) || "Not recorded";
    const engineer = clean(wo.engineer_name) || "Not assigned";
    lines.push(
      "",
      `*${completedHeading(wo)}*`,
      ...(machine ? [`Work Order: ${machine}`] : []),
      `Problem: ${problem}`,
      `Work carried out: ${work}`,
      `Engineer: ${engineer}`,
      `DOWNTIME: ${formatMinutes(totalMinutes)}`,
    );
  }
  if (open.length > 0) {
    lines.push("", "*Open work orders*");
    for (const p of open.slice(0, OPEN_MAX_LISTED)) {
      lines.push(
        `${p.wo_number ? `WO-${p.wo_number}` : "WO number not recorded"} · ${lineLabelOf(p.line_at_time, p.line_name)} · ` +
          `${clean(p.description) || "Not recorded"} · ${clean(p.engineer_name) || "not assigned"} · OPEN`,
      );
    }
    if (open.length > OPEN_MAX_LISTED) {
      lines.push(`…and ${open.length - OPEN_MAX_LISTED} more (see Work Orders).`);
    }
  }

  return {
    window, generatedAt, generatedBy: by || null,
    text: lines.join("\n"), completed, open, downtimeEvents, totalCountedMinutes,
    rows, stopsRead, ordersRead: touched.size, plannedStops, excludedMinutes, problems,
  };
}

/**
 * Read everything the report needs, fresh, for the chosen shift (the running one when
 * none is given). Throws on any failed read: a report built on a read that did not
 * happen is the bug this replaces. Paged and ordered, so a busy shift is never cut at
 * the server's 1000.
 */
export async function fetchMaintenanceShiftReport(
  now: Date = new Date(),
  opts: { window?: ShiftWindow; generatedBy?: string | null } = {},
): Promise<ShiftReport> {
  const window = opts.window ?? shiftWindowAt(now);
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
  // "Completed in this shift" = a finished status whose completion time falls inside
  // the window. PostgREST has no COALESCE, so the OR covers the three columns the
  // workflow writes; the builder picks the first non-null as the completion time.
  const completedInWindow =
    `and(status.in.(${[...FINISHED].join(",")}),finished_at.gte.${startIso},finished_at.lt.${endIso}),` +
    `and(status.in.(${[...FINISHED].join(",")}),completed_at.gte.${startIso},completed_at.lt.${endIso}),` +
    `and(status.in.(${[...FINISHED].join(",")}),closed_at.gte.${startIso},closed_at.lt.${endIso})`;

  const [wos, exclusions, plannedRows, completedRows, pendingRows] = await Promise.all([
    read("the work orders", fetchRowsByIds<any>(ids, (chunk, from, to) =>
      db.from("work_orders")
        .select("id, wo_number, line_at_time, description, resolution_notes, status, wo_type, engineer_name, machine, line:lines!work_orders_line_id_fkey(name)")
        .in("id", chunk).order("id").range(from, to))),
    read("the downtime exclusions", fetchRowsByIds<ReportExclusion>(ids, (chunk, from, to) =>
      db.from("wo_downtime_exclusions")
        .select("id, work_order_id, started_at, ended_at")
        .in("work_order_id", chunk).order("id").range(from, to))),
    read("which problems are planned", fetchAllRows<{ name: string | null }>({
      range: (from, to) => db.from("problem_descriptions").select("id, name").eq("planned", true).order("id").range(from, to),
    })),
    read("the completed work orders", fetchAllRows<any>({
      range: (from, to) =>
        db.from("work_orders")
          .select("id, wo_number, line_at_time, description, resolution_notes, status, wo_type, engineer_name, machine, finished_at, completed_at, closed_at, line:lines!work_orders_line_id_fkey(name)")
          .or(completedInWindow)
          .neq("wo_type", "warehouse_service")
          .order("wo_number", { ascending: true })
          .range(from, to),
    })),
    read("the open work orders", fetchAllRows<Omit<PendingOrder, "line_name"> & { line: { name: string } | null }>({
      range: (from, to) =>
        db.from("work_orders")
          .select("id, wo_number, line_at_time, description, status, engineer_name, created_at, line:lines!work_orders_line_id_fkey(name)")
          .in("status", [...PENDING_STATUSES])
          .neq("wo_type", "warehouse_service")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
    })),
  ]);

  return buildMaintenanceShiftReport({
    window,
    generatedAt: now,
    workOrders: wos.map((w: any) => ({ ...w, line_name: w.line?.name ?? null })),
    events,
    exclusions,
    plannedProblems: plannedRows.map((p) => String(p.name ?? "").toLowerCase()),
    generatedBy: opts.generatedBy,
    completedOrders: completedRows.map((w: any) => ({
      id: w.id, wo_number: w.wo_number, line_at_time: w.line_at_time, line_name: w.line?.name ?? null,
      description: w.description, resolution_notes: w.resolution_notes, status: w.status, wo_type: w.wo_type,
      engineer_name: w.engineer_name, machine: w.machine,
      completed_at_effective: w.finished_at ?? w.completed_at ?? w.closed_at ?? null,
    })),
    pending: pendingRows.map((w) => ({
      id: w.id, wo_number: w.wo_number, line_at_time: w.line_at_time, line_name: w.line?.name ?? null,
      description: w.description, status: w.status, engineer_name: w.engineer_name, created_at: w.created_at,
    })),
  });
}
