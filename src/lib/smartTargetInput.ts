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
 * - Planned windows. The only times on an item are the Production Control
 *   start/finish an operator types, and those are not reliable enough to place
 *   a job in the shift.
 * - Rates. `sku_products.target_per_hour` is 0 for 208 SKUs and a line-class
 *   default for the rest (`skuStandardRate.ts`). There is no approved rate
 *   source yet.
 * - Filling events. No per-fill endpoint has been confirmed with iTouch.
 * - Break times, the previous SKU and known downtime. Production has not
 *   answered these yet.
 *
 * When one of those arrives, it goes in here, and the gap list shrinks by itself.
 */

import { parseLineNo, type LineNo, type PlannedJob, type ShiftForecastInput, type ShiftType } from "./smartTargetEngine";
import { identifyItemSku, type SkuCatalogue } from "./lineSku";

export const SMART_TARGET_LINES: LineNo[] = [1, 2, 3, 4, 5, 6];

export interface SmartTargetSession {
  id: string;
  line: string;
  session_date: string;
  shift: string;
}

export interface SmartTargetItem {
  id: string;
  session_id: string;
  display_order: number;
  sku_id: string | null;
  sku_code_text: string | null;
  planned_qty: number | null;
}

/** An input the engine needs that the app does not have yet. */
export interface MissingInput {
  key: "rates" | "events" | "windows" | "breaks" | "previous_sku" | "downtime";
  label: string;
  why: string;
  /** Who can supply it. */
  owner: string;
}

export const MISSING_INPUTS: MissingInput[] = [
  {
    key: "rates",
    label: "Rate per line and SKU",
    why: "No approved source. sku_products.target_per_hour is 0 for most SKUs and a line default for the rest, so it is not used.",
    owner: "Built from verified filling events once iTouch confirms them",
  },
  {
    key: "events",
    label: "Filling events (actual containers)",
    why: "It has not been confirmed that iTouch records one event per completed container.",
    owner: "iTouch support",
  },
  {
    key: "windows",
    label: "Planned start and end of each job",
    why: "Production Control start/finish times are typed by operators and not reliable enough to place a job.",
    owner: "iTouch schedule (to confirm)",
  },
  {
    key: "breaks",
    label: "Break times",
    why: "Only the 75-minute allowance is known, so it is spread across the shift.",
    owner: "Production",
  },
  {
    key: "previous_sku",
    label: "SKU running at shift start",
    why: "Unknown, so no changeover is charged before the first job.",
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
  const otherLines = [...new Set(forShift.filter((s) => parseLineNo(s.line) === null).map((s) => s.line.trim()))].sort();

  const lines = SMART_TARGET_LINES.map((line): LineShiftInput => {
    const own = forShift.filter((s) => parseLineNo(s.line) === line).sort((a, b) => a.id.localeCompare(b.id));
    const notes: string[] = [];
    if (own.length > 1) {
      notes.push(`${own.length} production sessions exist for this line and shift; their jobs are read together.`);
    }
    const ids = new Set(own.map((s) => s.id));
    const jobs: PlannedJob[] = items
      .filter((i) => ids.has(i.session_id))
      .sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id))
      .map((i, idx) => {
        const sku = identifyItemSku(
          { sku_id: i.sku_id, sku_code_text: i.sku_code_text, actual: 0, started_at: null, finished_at: null },
          catalogue,
        );
        const qty = Number(i.planned_qty);
        return {
          jobId: i.id,
          sku: sku?.code ?? null,
          sequence: idx + 1,
          orderQty: Number.isFinite(qty) && qty > 0 ? qty : null,
        };
      });

    return {
      line,
      sessionIds: own.map((s) => s.id),
      notes,
      input: {
        date,
        shift,
        line,
        jobs,
        // previousSku left undefined: unknown, not "line was empty".
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
