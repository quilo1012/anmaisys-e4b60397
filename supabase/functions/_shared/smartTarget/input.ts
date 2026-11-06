/**
 * What the app can give the Smart Target engine today, and what it cannot.
 *
 * The engine (`smartTargetEngine.ts`) refuses to make up any input it does not
 * get. This file builds those inputs from what the database holds now, and says
 * plainly which ones it is leaving empty and why. The diagnostic page shows both
 * halves.
 *
 * Read from the database:
 * - The job sequence: `production_items` of the line's session, in
 *   `display_order`. This is the Work-To-List the planner imported from iTouch.
 *   The SKU comes from `sku_id`, falling back to `sku_code_text` (`lineSku.ts`).
 * - The order quantity: `planned_qty`. The engine uses it only to size a job's
 *   slot, never as what was made.
 *
 * Left empty on purpose:
 * - Planned windows, and on purpose for good (decided 05/11). The only times on
 *   an item are the Production Control start/finish an operator types, which are
 *   not reliable. iTouch's Work To List has "Expected Start/End Time", but those
 *   are iTouch's own estimate, not a plan: every job gets a fixed 90-minute setup
 *   plus order × ideal cycle, with no breaks, mixing or stops (checked against the
 *   25/06 export: BCAA1400BR, CARBBM, ISO850WCH all match to the minute). Using
 *   them would bring a second model in disguised as a schedule. A job's time comes
 *   from its order quantity at the line's rate instead, so windows are not listed
 *   as missing.
 * - Rates. `sku_products.target_per_hour` is 0 for 208 SKUs and a line-class
 *   default for the rest (`skuStandardRate.ts`), so it is not used. iTouch's
 *   ideal cycles are stored in `itouch_cycle_times` (ItouchCyclesCard), but they
 *   become rates only with each line's performance factor from shift history
 *   (`lineFactors()` in `smartTargetRates.ts`), which is not read yet.
 * - Filling events. No per-fill endpoint has been confirmed with iTouch.
 * - Break times, the previous SKU and known downtime. Production has not
 *   answered these yet.
 *
 * When one of those arrives, it goes in here, and the gap list shrinks by itself.
 */

import {
  parseLineNo,
  type LineNo,
  type PlannedJob,
  type ShiftForecast,
  type ShiftForecastInput,
  type ShiftType,
} from "./engine.ts";
import { identifyItemSku, type SkuCatalogue } from "../production/lineSku.ts";

/** Code-point order, so a sort never depends on the browser's locale. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const SMART_TARGET_LINES: LineNo[] = [1, 2, 3, 4, 5, 6];

export interface SmartTargetSession {
  id: string;
  line: string;
  session_date: string;
  shift: string;
  /** Orders two sessions of one line and shift; the earlier one's jobs run first. */
  started_at?: string | null;
}

export interface SmartTargetItem {
  id: string;
  session_id: string;
  display_order: number;
  sku_id: string | null;
  sku_code_text: string | null;
  planned_qty: number | null;
  /**
   * When the row was logged. Operators' rows all have display_order 0, so this is what
   * orders them; without it the "last job" was whichever id sorted last.
   */
  created_at?: string | null;
}

/** An input the engine needs that the app does not have yet. */
export interface MissingInput {
  key: "rates" | "events" | "breaks" | "downtime";
  label: string;
  why: string;
  /** Who can supply it. */
  owner: string;
}

export const MISSING_INPUTS: MissingInput[] = [
  {
    key: "rates",
    label: "Rate per line and SKU",
    why: "No iTouch cycle times are loaded yet, so there is no ideal speed to scale by each line's performance.",
    owner: "iTouch Product Details export, uploaded below",
  },
  {
    key: "events",
    label: "Filling events (actual containers)",
    why: "It has not been confirmed that iTouch records one event per completed container.",
    owner: "iTouch support",
  },
  {
    key: "breaks",
    label: "Break times",
    why: "Only the 75-minute allowance is known, so it is spread across the shift.",
    owner: "Production",
  },
  {
    key: "downtime",
    label: "Known downtime",
    why: "Which stop codes count as planned downtime has not been agreed.",
    owner: "Production",
  },
];

export interface LineShiftInput {
  line: LineNo;
  input: ShiftForecastInput;
  sessionIds: string[];
  notes: string[];
}

export interface ShiftInputs {
  lines: LineShiftInput[];
  /** Session line names that are not Line 1–6 and so are outside v1. */
  otherLines: string[];
}

/** The shift before: a DAY follows the previous date's NIGHT, a NIGHT follows its own date's DAY. */
export function previousShiftOf(date: string, shift: ShiftType): { date: string; shift: ShiftType } {
  if (shift === "NIGHT") return { date, shift: "DAY" };
  const d = new Date(`${date}T00:00:00Z`);
  return { date: new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10), shift: "NIGHT" };
}

export function buildShiftInputs(
  date: string,
  shift: ShiftType,
  sessions: SmartTargetSession[],
  items: SmartTargetItem[],
  catalogue: SkuCatalogue,
): ShiftInputs {
  const forShift = sessions.filter(
    (s) => s.session_date === date && String(s.shift).trim().toUpperCase() === shift,
  );
  const otherLines = [...new Set(forShift.filter((s) => parseLineNo(s.line) === null).map((s) => s.line.trim()))].sort(cmp);

  const prev = previousShiftOf(date, shift);
  const forPrevious = sessions.filter(
    (s) => s.session_date === prev.date && String(s.shift).trim().toUpperCase() === prev.shift,
  );
  const bySessionOrder = (a: SmartTargetSession, b: SmartTargetSession) =>
    cmp(a.started_at ?? "", b.started_at ?? "") || cmp(a.id, b.id);

  const lines = SMART_TARGET_LINES.map((line): LineShiftInput => {
    // What ran last on the shift before (decided 05/11, Q17): the last job logged there,
    // in session order then display order. It is the last job LOGGED, which is usually
    // but not certainly the product on the line at handover, so it is provisional and
    // said so on the card. No previous session: unknown, as before.
    const before = forPrevious.filter((s) => parseLineNo(s.line) === line).sort(bySessionOrder);
    const beforeRank = new Map(before.map((s, i) => [s.id, i]));
    const lastBefore = items
      .filter((i) => beforeRank.has(i.session_id))
      .sort((a, b) =>
        beforeRank.get(a.session_id)! - beforeRank.get(b.session_id)! || a.display_order - b.display_order || cmp(a.created_at ?? "", b.created_at ?? "") || cmp(a.id, b.id))
      .map((i) => identifyItemSku({ sku_id: i.sku_id, sku_code_text: i.sku_code_text, actual: 0, started_at: null, finished_at: null }, catalogue)?.code ?? null)
      .filter((c): c is string => c !== null)
      .pop();

    const own = forShift
      .filter((s) => parseLineNo(s.line) === line)
      .sort((a, b) => cmp(a.started_at ?? "", b.started_at ?? "") || cmp(a.id, b.id));
    const notes: string[] = [];
    if (own.length > 1) {
      notes.push(`${own.length} production sessions exist for this line and shift; their jobs are read together.`);
    }
    if (lastBefore) {
      notes.push(`SKU at shift start: ${lastBefore}, the last job logged on the previous shift (provisional).`);
    }
    // Session first, then the order inside it: two sessions' jobs must not interleave.
    const rank = new Map(own.map((s, i) => [s.id, i]));
    const rows = items
      .filter((i) => rank.has(i.session_id))
      .sort((a, b) =>
        rank.get(a.session_id)! - rank.get(b.session_id)! || a.display_order - b.display_order || cmp(a.created_at ?? "", b.created_at ?? "") || cmp(a.id, b.id))
      .map((i) => {
        const sku = identifyItemSku(
          { sku_id: i.sku_id, sku_code_text: i.sku_code_text, actual: 0, started_at: null, finished_at: null },
          catalogue,
        );
        const qty = Number(i.planned_qty);
        return { id: i.id, sku: sku?.code ?? null, qty: Number.isFinite(qty) && qty > 0 ? qty : null };
      });
    // Rows of the same SKU one after another are one run on the line: the same product
    // keeps filling with no changeover. They become one job, and its order is their sum
    // only if every row has one. A run with any row unquantified is unquantified as a
    // whole, because adding the known part would understate it. A row with no SKU is
    // never merged: nobody can say it is the same product.
    const jobs: PlannedJob[] = [];
    for (const r of rows) {
      const last = jobs[jobs.length - 1];
      if (last && r.sku !== null && last.sku === r.sku) {
        last.orderQty = last.orderQty !== null && last.orderQty !== undefined && r.qty !== null ? last.orderQty + r.qty : null;
        continue;
      }
      jobs.push({ jobId: r.id, sku: r.sku, sequence: jobs.length + 1, orderQty: r.qty });
    }

    return {
      line,
      sessionIds: own.map((s) => s.id),
      notes,
      input: {
        date,
        shift,
        line,
        jobs,
        // Undefined when the previous shift has nothing logged: unknown, not "line was empty".
        previousSku: lastBefore,
        breaks: null,
        downtime: [],
        rates: [],
        events: [],
        eventSemantics: null,
      },
    };
  });

  return { lines, otherLines };
}

/**
 * Why a line has no number, said once per cause instead of once per job.
 *
 * The engine gives each job its own reason, so three jobs without a rate give
 * the same sentence three times. A person reading the card needs each cause once,
 * with the SKUs it applies to.
 */
export function lineGaps(result: ShiftForecast): string[] {
  const out: string[] = [];
  const skusWith = (status: string) =>
    [...new Set(result.jobs.filter((j) => j.sku && j.rateStatus === status).map((j) => j.sku as string))];
  const missing = skusWith("missing");
  const thin = skusWith("insufficient_history");
  const conflict = skusWith("conflict");
  if (missing.length) out.push(`No rate for ${missing.join(", ")}.`);
  if (thin.length) out.push(`Too little history for ${thin.join(", ")}.`);
  if (conflict.length) out.push(`Rate records disagree for ${conflict.join(", ")}.`);
  const noSku = result.jobs.filter((j) => !j.sku).length;
  if (noSku) out.push(`${noSku} job${noSku === 1 ? " has" : "s have"} no SKU.`);
  if (result.jobs.some((j) => !j.allocation)) {
    out.push("Job times cannot be worked out without a rate.");
  }
  return out;
}

/**
 * Minutes the plan spends on changeovers and mixing, from the sequence and the
 * provisional durations. It needs no rate, so it is known even when the forecast
 * is not. It is still an estimate until Production confirms the durations.
 */
export function setupMinutes(result: ShiftForecast): number {
  return result.jobs.reduce((sum, j) => sum + j.changeoverMinutes + j.mixingMinutes, 0);
}
