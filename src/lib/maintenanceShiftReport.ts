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
 * Now the stops are read fresh from `downtime_events` for the shift the user picks —
 * the running one or any earlier one — and the report says what it read and where the
 * numbers disagree. "No line stoppage" is only ever written after a read that
 * succeeded and found none.
 */
import { supabase } from "@/integrations/supabase/client";
import { getCurrentFactoryShift, getCurrentShiftEnd, getCurrentShiftStart, londonHM, londonWallToUtc, type ShiftCode } from "@/lib/shifts";
import { toExclusionIntervals, exclusionOverlapMs } from "@/lib/downtimeExclusions";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { isNoPlannedShift } from "@/lib/downtimeBuckets";
import { fetchRowsByIds } from "@/lib/fetchRowsByIds";

/** Stops at or under this many minutes stay off the report. Unchanged from before. */
export const REPORT_MIN_MINUTES = 15;

/**
 * How recent a shift must be for the report to carry a hand-over. The orders' state
 * is read as it is NOW; for a shift that ended long ago that is not the state it was
 * handed over in, and printing it under that shift's name would say otherwise.
 */
export const HANDOVER_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** At most this many pending orders are written out; the rest are counted. */
export const HANDOVER_MAX_PENDING = 20;

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
  paused_at: string | null;
  pause_reason: string | null;
  created_at: string;
  /** When its line went down, if a stop on it is still open. */
  stopped_since: string | null;
}

export interface ShiftReportData {
  window: ShiftWindow;
  generatedAt: Date;
  workOrders: ReportWorkOrder[];
  events: ReportEvent[];
  exclusions: ReportExclusion[];
  /** Lower-cased names of `problem_descriptions` marked planned. */
  plannedProblems: string[];
  /** Who generated it, printed in the header. */
  generatedBy?: string | null;
  /** Orders still open now. Only used when the shift is recent enough for a hand-over. */
  pending?: PendingOrder[];
  /** Free text typed by the engineer; printed as written, under their name. */
  handoverNotes?: string | null;
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

export type StopVerdict = "listed" | "under 15 min" | "planned" | "inverted" | "order not read";

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
  items: ReportItem[];
  rows: StopRow[];
  /** Distinct stops that touched the window. */
  stopsRead: number;
  ordersRead: number;
  plannedStops: number;
  /** Minutes of team activity taken off the stops that were counted. */
  excludedMinutes: number;
  /** Listed orders not finished, or with a stop still open. */
  openItems: number;
  resolvedItems: number;
  /** Null when the shift is too old for one; see HANDOVER_MAX_AGE_MS. */
  handover: { pending: PendingOrder[]; stillStopped: PendingOrder[]; notes: string | null } | null;
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
    // An end before its start (two such rows in production, WO 498 and WO 918) is
    // not a short stop, it is a broken one. The view floors it at zero; here it is
    // named, because a report that skips it says less than the order does.
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
    if (minutes <= REPORT_MIN_MINUTES) {
      row(e, wo, "under 15 min", minutes, excludedMin);
      continue;
    }
    row(e, wo, "listed", minutes, excludedMin);
    if (!stopsByWo.has(wo.id)) stopsByWo.set(wo.id, []);
    stopsByWo.get(wo.id)!.push({ minutes, ongoing: !e.resumed_at, carriedOver: s < winStart });
  }

  const items: ReportItem[] = [...stopsByWo.entries()].map(([id, stops]) => ({
    wo: woById.get(id)!,
    stops,
    totalMinutes: stops.reduce((sum, x) => sum + x.minutes, 0),
  }));
  // Self-check: what is printed is what was added up, and the audit trail agrees.
  for (const it of items) {
    if (it.totalMinutes !== it.stops.reduce((sum, x) => sum + x.minutes, 0)) {
      problems.push(`WO-${it.wo.wo_number ?? "?"}: total does not match its stops.`);
    }
  }
  const listedRows = rows.filter((r) => r.verdict === "listed");
  if (listedRows.length !== items.reduce((n, it) => n + it.stops.length, 0)) {
    problems.push("The stops listed do not match the stops counted.");
  }

  const isOpen = (it: ReportItem) => !FINISHED.has(it.wo.status) || it.stops.some((x) => x.ongoing);
  const openItems = items.filter(isOpen).length;
  const resolvedItems = items.length - openItems;
  const ordersRead = touched.size;
  const listedMinutes = items.reduce((n, it) => n + it.totalMinutes, 0);

  const handover = winEnd > nowMs - HANDOVER_MAX_AGE_MS && input.pending
    ? (() => {
      const pending = input.pending.filter((p) => (PENDING_STATUSES as readonly string[]).includes(p.status));
      return {
        pending,
        stillStopped: pending.filter((p) => p.stopped_since),
        notes: clean(input.handoverNotes) || null,
      };
    })()
    : null;

  // ── Text ───────────────────────────────────────────────────────────────
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const by = clean(input.generatedBy);
  const lines: string[] = [
    "**Maintenance Report**",
    `Shift: ${shiftLabel(window.shift)}`,
    `Date: ${ddmmyyyy(window.sessionDate)}`,
    `Period: ${londonStamp(window.start)} → ${londonStamp(window.end)} (Europe/London)` +
      (winEnd > nowMs ? " — shift still running, figures up to now" : ""),
    `Generated: ${londonStamp(generatedAt)}${by ? ` by ${by}` : ""}`,
    "Source: downtime_events, work_orders, wo_downtime_exclusions — read when the report was generated",
    "",
    "**Summary**",
    `- Stops recorded: ${plural(stopsRead, "stop")} on ${plural(ordersRead, "work order")}`,
    `- Stops over ${REPORT_MIN_MINUTES} min: ${listedRows.length} (${listedMinutes} min)`,
    `- Planned stops not counted: ${plannedStops}`,
    `- Team-activity time excluded: ${excludedMinutes} min`,
    `- Still open: ${openItems} · Resolved: ${resolvedItems}`,
    `- Records not validated: ${problems.length}`,
    "",
    `**Stops over ${REPORT_MIN_MINUTES} minutes**`,
  ];
  for (const { wo, stops } of items) {
    const what = clean(wo.resolution_notes) || clean(wo.description) || "No description recorded";
    const open = FINISHED.has(wo.status) ? "" : " (in progress)";
    const ref = wo.wo_number ? ` (WO-${wo.wo_number})` : "";
    lines.push(`**${lineLabelOf(wo.line_at_time, wo.line_name)}:** ${what}${open}${ref}`);
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

  lines.push("");
  if (handover) {
    lines.push(`**Handover** (order status at ${londonStamp(generatedAt)})`);
    lines.push(`Lines still stopped: ${handover.stillStopped.length}`);
    for (const p of handover.stillStopped) {
      const mins = Math.max(0, Math.round((nowMs - new Date(p.stopped_since!).getTime()) / 60_000));
      lines.push(
        `- ${lineLabelOf(p.line_at_time, p.line_name)} · WO-${p.wo_number ?? "?"} ${clean(p.description) || "—"}` +
          ` · stopped since ${londonHM(new Date(p.stopped_since!))} (${mins}m) · engineer: ${clean(p.engineer_name) || "not assigned"}`,
      );
    }
    lines.push(`Pending work orders: ${handover.pending.length}`);
    for (const p of handover.pending.slice(0, HANDOVER_MAX_PENDING)) {
      // The pause reason is what the engineer typed. "Waiting for parts" is only ever
      // printed because somebody wrote it, never inferred.
      const paused = p.paused_at ? ` · paused: ${clean(p.pause_reason) || "no reason recorded"}` : "";
      lines.push(
        `- WO-${p.wo_number ?? "?"} · ${lineLabelOf(p.line_at_time, p.line_name)} · ${clean(p.description) || "—"}` +
          ` · ${p.status}${paused} · engineer: ${clean(p.engineer_name) || "not assigned"}`,
      );
    }
    if (handover.pending.length > HANDOVER_MAX_PENDING) {
      lines.push(`- …and ${handover.pending.length - HANDOVER_MAX_PENDING} more (see Work Orders).`);
    }
    if (handover.notes) lines.push(`Handover notes${by ? ` (${by})` : ""}: ${handover.notes}`);
  } else {
    lines.push(
      `**Handover:** not included — this shift ended more than ${HANDOVER_MAX_AGE_MS / 3_600_000} hours before the report ` +
        "was generated, and today's order statuses are not the ones it was handed over with.",
    );
  }
  lines.push("- Have a good day.");

  return {
    window, generatedAt, generatedBy: by || null,
    text: lines.join("\n"), items, rows, stopsRead, ordersRead, plannedStops,
    excludedMinutes, openItems, resolvedItems, handover, problems,
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
  opts: { window?: ShiftWindow; generatedBy?: string | null; handoverNotes?: string | null } = {},
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
  const wantsHandover = window.end.getTime() > now.getTime() - HANDOVER_MAX_AGE_MS;
  const [wos, exclusions, plannedRows, pendingRows, openStops] = await Promise.all([
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
    wantsHandover
      ? read("the pending work orders", fetchAllRows<Omit<PendingOrder, "line_name" | "stopped_since"> & { line: { name: string } | null }>({
        range: (from, to) =>
          db.from("work_orders")
            .select("id, wo_number, line_at_time, description, status, engineer_name, paused_at, pause_reason, created_at, line:lines!work_orders_line_id_fkey(name)")
            .in("status", [...PENDING_STATUSES])
            .neq("wo_type", "warehouse_service")
            .order("created_at", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to),
      }))
      : Promise.resolve(null),
    wantsHandover
      ? read("the open stoppages", fetchAllRows<{ work_order_id: string; stopped_at: string }>({
        range: (from, to) =>
          db.from("downtime_events").select("id, work_order_id, stopped_at")
            .is("resumed_at", null).order("stopped_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
      }))
      : Promise.resolve(null),
  ]);

  let pending: PendingOrder[] | undefined;
  if (pendingRows && openStops) {
    const since = new Map<string, string>();
    for (const s of openStops) if (!since.has(s.work_order_id)) since.set(s.work_order_id, s.stopped_at);
    pending = pendingRows.map((w) => ({
      id: w.id, wo_number: w.wo_number, line_at_time: w.line_at_time, line_name: w.line?.name ?? null,
      description: w.description, status: w.status, engineer_name: w.engineer_name,
      paused_at: w.paused_at, pause_reason: w.pause_reason, created_at: w.created_at,
      stopped_since: since.get(w.id) ?? null,
    }));
  }

  return buildMaintenanceShiftReport({
    window,
    generatedAt: now,
    workOrders: wos.map((w: any) => ({ ...w, line_name: w.line?.name ?? null })),
    events,
    exclusions,
    plannedProblems: plannedRows.map((p) => String(p.name ?? "").toLowerCase()),
    generatedBy: opts.generatedBy,
    pending,
    handoverNotes: opts.handoverNotes,
  });
}
