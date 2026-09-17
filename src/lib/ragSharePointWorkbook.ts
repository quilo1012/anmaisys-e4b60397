import * as XLSX from "xlsx";

/**
 * Reader for the factory's "Production RAG Performance" workbook as it lives on
 * SharePoint. The template is reused every month, so the layout is read
 * POSITIONALLY — no label searching, which is what kept breaking before:
 *
 *  - one worksheet per week, named "WC DDMMYY" (anything else is ignored);
 *  - eight stacked line blocks per sheet, block N starting at row 2 + 21*(N-1);
 *  - inside a block starting at row `bs` (1-based):
 *      bs+2  the seven dates (real Excel dates)
 *      bs+3  the line name in column B
 *      bs+4  Plan   <- the only row we read
 *      bs+5..bs+10  Actual / Variance / UPM target / UPM actual / Downtime / Comments
 *  - the seven days sit at 4-column strides: day n has its Day cell at
 *    0-based column 2 + 4n and its Night cell at 3 + 4n (Mon C/D, Tue G/H, …).
 *    The Total and Yield columns between them are derived and ignored, as is
 *    the "Progressive week to date" section further right — a column only
 *    counts when the date row actually parses as a date.
 *
 * A blank Plan cell means 0, not "unknown".
 */

export type Shift = "DAY" | "NIGHT";

export interface PlanCell {
  entry_date: string;
  line: string;
  shift: Shift;
  plan_qty: number;
  /** Sheet the value came from — used to explain "last sheet wins". */
  sheet: string;
}

export interface SheetSummary {
  name: string;
  dates: string[];
  lines: string[];
}

export interface WorkbookParseResult {
  sheets: SheetSummary[];
  /** One entry per date|line|shift; when two sheets cover a date, the last wins. */
  plans: PlanCell[];
  /** Line names present in the file that match no line in the database. */
  unrecognisedLines: string[];
  /** date|line|shift keys that appeared on more than one sheet. */
  overlappingKeys: string[];
  dateRange: { from: string; to: string } | null;
}

export const WC_SHEET_RE = /^WC \d{6}$/;

const BLOCK_ROWS = [2, 23, 44, 65, 86, 107, 128, 149];
const BLOCK_SPAN = 21;

/** "Tablet line" and "Tablet Line" are the same line: fold case and punctuation. */
export function lineKey(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Local-calendar ISO day; never goes through UTC, which would shift the date. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Read a date cell: real Date, Excel serial number, or an ISO-ish string. */
export function parseDateCell(cell: XLSX.CellObject | undefined): string | null {
  if (!cell) return null;
  const v = cell.v;
  if (v instanceof Date && !isNaN(v.getTime())) return isoDay(v);
  if (typeof v === "number" && cell.t === "n") {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

/** A plan cell: blank means 0. Formula errors and text are not numbers → 0. */
export function parsePlanCell(cell: XLSX.CellObject | undefined): number {
  if (!cell || cell.t === "e") return 0;
  const v = cell.v;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

function cellAt(ws: XLSX.WorkSheet, row1: number, col0: number): XLSX.CellObject | undefined {
  return ws[XLSX.utils.encode_cell({ r: row1 - 1, c: col0 })] as XLSX.CellObject | undefined;
}

function textAt(ws: XLSX.WorkSheet, row1: number, col0: number): string {
  const c = cellAt(ws, row1, col0);
  if (!c || c.v == null) return "";
  return String(c.v).trim();
}

export class WorkbookShapeError extends Error {}

/**
 * Parse the workbook. `knownLines` are the line names the database already uses;
 * matching is case-insensitive and the database spelling is the one returned.
 */
export function parseSharePointRagWorkbook(
  data: ArrayBuffer | Uint8Array,
  knownLines: string[],
): WorkbookParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), {
      type: "array",
      cellDates: true,
    });
  } catch {
    throw new WorkbookShapeError(
      "This file could not be read as an Excel workbook. Export the RAG file from SharePoint as .xlsx and try again.",
    );
  }

  const wcSheets = wb.SheetNames.filter((n) => WC_SHEET_RE.test(n));
  if (wcSheets.length === 0) {
    throw new WorkbookShapeError(
      "No weekly sheets found. The RAG workbook has one sheet per week named like \"WC 010926\".",
    );
  }

  const known = new Map<string, string>();
  for (const l of knownLines) known.set(lineKey(l), l);

  const byKey = new Map<string, PlanCell>();
  const overlappingKeys: string[] = [];
  const unrecognised = new Map<string, string>();
  const sheets: SheetSummary[] = [];

  for (const name of wcSheets) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const sheetDates = new Set<string>();
    const sheetLines: string[] = [];

    for (let i = 0; i < BLOCK_ROWS.length; i++) {
      const bs = BLOCK_ROWS[i] ?? 2 + BLOCK_SPAN * i;
      const rawLine = textAt(ws, bs + 3, 1); // column B
      if (!rawLine) continue; // empty block

      const dbLine = known.get(lineKey(rawLine));
      if (!dbLine) {
        unrecognised.set(lineKey(rawLine), rawLine);
        continue;
      }
      if (!sheetLines.includes(dbLine)) sheetLines.push(dbLine);

      for (let d = 0; d < 7; d++) {
        const dayCol = 2 + 4 * d;
        const date = parseDateCell(cellAt(ws, bs + 2, dayCol));
        if (!date) continue; // derived / progressive columns
        sheetDates.add(date);

        const shifts: [Shift, number][] = [
          ["DAY", dayCol],
          ["NIGHT", dayCol + 1],
        ];
        for (const [shift, col] of shifts) {
          const key = `${date}|${dbLine}|${shift}`;
          if (byKey.has(key) && byKey.get(key)!.sheet !== name) overlappingKeys.push(key);
          byKey.set(key, {
            entry_date: date,
            line: dbLine,
            shift,
            plan_qty: parsePlanCell(cellAt(ws, bs + 4, col)),
            sheet: name,
          });
        }
      }
    }

    sheets.push({ name, dates: [...sheetDates].sort(), lines: sheetLines });
  }

  const plans = [...byKey.values()].sort(
    (a, b) =>
      a.entry_date.localeCompare(b.entry_date) ||
      a.line.localeCompare(b.line) ||
      a.shift.localeCompare(b.shift),
  );

  if (plans.length === 0 && unrecognised.size === 0) {
    throw new WorkbookShapeError(
      "The weekly sheets in this file are empty — no line names or dates were found where the RAG template keeps them.",
    );
  }

  const allDates = plans.map((p) => p.entry_date).sort();

  return {
    sheets,
    plans,
    unrecognisedLines: [...unrecognised.values()].sort(),
    overlappingKeys: [...new Set(overlappingKeys)].sort(),
    dateRange: allDates.length
      ? { from: allDates[0], to: allDates[allDates.length - 1] }
      : null,
  };
}

export interface ExistingRow {
  id: string;
  entry_date: string;
  line: string;
  shift: Shift;
  plan_qty: number;
  actual_qty: number;
  upm_target: number;
  upm_actual: number;
  downtime_min: number;
  notes: string | null;
  actual_source: string;
}

export interface PlanChange {
  id: string;
  entry_date: string;
  line: string;
  shift: Shift;
  currentPlan: number;
  filePlan: number;
  actual: number;
  existing: ExistingRow;
}

export interface NewPlanRow {
  entry_date: string;
  line: string;
  shift: Shift;
  filePlan: number;
}

export interface ImportDiff {
  changes: PlanChange[];
  newRows: NewPlanRow[];
  unchanged: number;
  /** File cells with plan 0 and no row in the database — nothing to create. */
  skippedEmpty: number;
}

/** Compare the file against what is stored. Nothing here writes. */
export function diffPlans(plans: PlanCell[], existing: ExistingRow[]): ImportDiff {
  const map = new Map<string, ExistingRow>();
  for (const r of existing) map.set(`${r.entry_date}|${r.line}|${r.shift}`, r);

  const changes: PlanChange[] = [];
  const newRows: NewPlanRow[] = [];
  let unchanged = 0;
  let skippedEmpty = 0;

  for (const p of plans) {
    const row = map.get(`${p.entry_date}|${p.line}|${p.shift}`);
    if (row) {
      if (Number(row.plan_qty) !== p.plan_qty) {
        changes.push({
          id: row.id,
          entry_date: p.entry_date,
          line: p.line,
          shift: p.shift,
          currentPlan: Number(row.plan_qty),
          filePlan: p.plan_qty,
          actual: Number(row.actual_qty),
          existing: row,
        });
      } else unchanged++;
    } else if (p.plan_qty > 0) {
      newRows.push({ entry_date: p.entry_date, line: p.line, shift: p.shift, filePlan: p.plan_qty });
    } else skippedEmpty++;
  }

  return { changes, newRows, unchanged, skippedEmpty };
}

/**
 * Existing rows: the payload carries the primary key and plan_qty and NOTHING
 * else. Carrying the other columns over would send back the snapshot taken when
 * the file was parsed — and because `rag_actual_is_derived()` accepts a passed
 * actual_qty verbatim for 'sharepoint' rows, that would quietly overwrite an
 * actual the floor or the sync recorded while the preview was open.
 * updated_at is left to `trg_rag_weekly_updated_at`.
 */
export function buildPlanUpdates(changes: PlanChange[]): { id: string; plan_qty: number }[] {
  return changes.map((c) => ({ id: c.id, plan_qty: c.filePlan }));
}

/**
 * Rows that do not exist yet: only the four columns that identify the row and
 * carry the plan. `import_rag_plan_workbook` lets the column defaults handle
 * actual_qty, upm_target, upm_actual, downtime_min, notes and actual_source —
 * sending them from the client is how stale values creep back in.
 */
export function buildNewRowInserts(
  newRows: NewPlanRow[],
): { entry_date: string; line: string; shift: Shift; plan_qty: number }[] {
  return newRows.map((n) => ({
    entry_date: n.entry_date,
    line: n.line,
    shift: n.shift,
    plan_qty: n.filePlan,
  }));
}
