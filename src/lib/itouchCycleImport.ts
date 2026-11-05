/**
 * Reads iTouch's "Product Details" export into cycle records.
 *
 * The export has one row per part and machine, with the header on its first row and
 * trailing spaces in some column names ("Cavities ", "Standard Cycle Time "). This file
 * finds the four columns it needs by name and keeps every row that has a machine and a
 * part code, exactly as iTouch wrote it. It does not judge the values: tablet and
 * capsule machines, empty cycles, implausible seconds and repeats all go through, because
 * cleanCycles() (smartTargetRates.ts) decides what is usable and lists the rest for
 * Production. Dropping a row here would hide it from that list.
 */

import { parseLineNo, type LineNo } from "./smartTargetEngine";
import type { CleanCycle, CycleRecord, RejectedCycle } from "./smartTargetRates";

/** The columns the import needs, as iTouch names them. */
export const PRODUCT_DETAILS_COLUMNS = {
  sku: "SKU",
  machine: "Machine",
  cycleSeconds: "Standard Cycle Time",
  cavities: "Cavities",
} as const;

/**
 * Every name iTouch has been seen to give each column. The part code is "SKU" in one
 * export and "Part Number" in another (the 02/11 Product Details export the factory
 * uses), and refusing the second one stopped the first real import.
 */
const COLUMN_NAMES: Record<keyof typeof PRODUCT_DETAILS_COLUMNS, readonly string[]> = {
  sku: ["SKU", "Part Number"],
  machine: ["Machine"],
  cycleSeconds: ["Standard Cycle Time"],
  cavities: ["Cavities"],
};

/** How far down the sheet the header row is looked for. */
const HEADER_SEARCH_ROWS = 10;

export interface ProductDetailsImport {
  records: CycleRecord[];
  /** Why nothing could be read. Empty when the sheet was read. */
  problems: string[];
  /** Rows kept, per machine name, in first-seen order. */
  perMachine: { machine: string; rows: number; withCycle: number }[];
  /** Rows left out because they had no machine or no part code. */
  skippedRows: number;
  /**
   * Cells that hold something that is not a number. They are stored as no value, which
   * the page would show as "no cycle in iTouch", so the preview lists them separately.
   */
  unreadable: { machine: string; sku: string; column: string; value: string }[];
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const headerKey = (v: unknown) => text(v).replace(/\s+/g, " ").toLowerCase();

/** "3.5", 3.5 and "3,5" are all 3.5. Empty is null; anything else is NaN, which cleanCycles rejects. */
export function parseItouchNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : Number.NaN;
  const s = text(v);
  if (!s) return null;
  const normalised = /^-?\d+,\d+$/.test(s) ? s.replace(",", ".") : s;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(normalised) ? Number(normalised) : Number.NaN;
}

export function parseProductDetails(rows: unknown[][], source: string): ProductDetailsImport {
  const wanted = Object.entries(COLUMN_NAMES) as [keyof typeof PRODUCT_DETAILS_COLUMNS, readonly string[]][];
  const indexIn = (keys: string[], names: readonly string[]) =>
    names.map((n) => keys.indexOf(n.toLowerCase())).find((i) => i >= 0) ?? -1;
  let headerRow = -1;
  let col: Record<keyof typeof PRODUCT_DETAILS_COLUMNS, number> | null = null;
  for (let r = 0; r < Math.min(rows.length, HEADER_SEARCH_ROWS); r++) {
    const keys = (rows[r] ?? []).map(headerKey);
    const found = Object.fromEntries(wanted.map(([k, names]) => [k, indexIn(keys, names)]));
    if (Object.values(found).every((i) => i >= 0)) {
      headerRow = r;
      col = found as typeof col;
      break;
    }
  }
  if (!col) {
    const first = (rows[0] ?? []).map(headerKey);
    const missing = wanted
      .filter(([, names]) => indexIn(first, names) < 0)
      .map(([, names]) => names.map((n) => `"${n}"`).join(" or "));
    return {
      records: [],
      problems: [
        `This is not iTouch's Product Details export: the columns ${missing.join(", ")} were not found in the first rows.`,
      ],
      perMachine: [],
      skippedRows: 0,
      unreadable: [],
    };
  }

  const records: CycleRecord[] = [];
  const machines = new Map<string, { rows: number; withCycle: number }>();
  let skippedRows = 0;
  const unreadable: ProductDetailsImport["unreadable"] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const machine = text(row?.[col.machine]);
    const sku = text(row?.[col.sku]);
    if (!machine || !sku) {
      if (row?.some((c) => text(c) !== "")) skippedRows++;
      continue;
    }
    const cycleSeconds = parseItouchNumber(row[col.cycleSeconds]);
    const cavities = parseItouchNumber(row[col.cavities]);
    if (Number.isNaN(cycleSeconds)) {
      unreadable.push({ machine, sku, column: PRODUCT_DETAILS_COLUMNS.cycleSeconds, value: text(row[col.cycleSeconds]) });
    }
    if (Number.isNaN(cavities)) {
      unreadable.push({ machine, sku, column: PRODUCT_DETAILS_COLUMNS.cavities, value: text(row[col.cavities]) });
    }
    records.push({ line: machine, sku, cycleSeconds, cavities, source });
    const m = machines.get(machine) ?? { rows: 0, withCycle: 0 };
    m.rows++;
    if (cycleSeconds !== null && !Number.isNaN(cycleSeconds)) m.withCycle++;
    machines.set(machine, m);
  }

  return {
    records,
    problems: records.length ? [] : ["The sheet has the right columns but no row with both a machine and a part code."],
    perMachine: [...machines].map(([machine, m]) => ({ machine, ...m })),
    skippedRows,
    unreadable,
  };
}

/**
 * The shape import_itouch_cycles() takes. A value that is not a number is sent as null,
 * so the cast in the function never fails; the preview has already listed it.
 */
export interface CycleImportRow {
  machine: string;
  sku: string;
  cycle_seconds: number | null;
  cavities: number | null;
}

export function toImportRows(records: CycleRecord[]): CycleImportRow[] {
  const num = (v: number | null) => (v === null || !Number.isFinite(v) ? null : v);
  return records.map((r) => ({
    machine: String(r.line),
    sku: r.sku,
    cycle_seconds: num(r.cycleSeconds),
    cavities: num(r.cavities),
  }));
}

/** Per Filler Line: how many cycles Smart Target can use and how many wait on Production. */
export interface LineCycleSummary {
  line: LineNo;
  usable: number;
  forProduction: number;
}

export function summariseCycles(cycles: CleanCycle[], rejected: RejectedCycle[]): LineCycleSummary[] {
  return SMART_TARGET_CYCLE_LINES.map((line) => ({
    line,
    usable: cycles.filter((c) => c.line === line).length,
    forProduction: rejected.filter((r) => parseLineNo(r.line) === line).length,
  }));
}

const SMART_TARGET_CYCLE_LINES: LineNo[] = [1, 2, 3, 4, 5, 6];

/** The list for Production, as a CSV a spreadsheet opens without asking. */
export function rejectedCyclesCsv(rejected: RejectedCycle[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Line", "SKU", "Standard cycle (s)", "Why it is not used"].join(",")];
  for (const r of rejected) lines.push([r.line, r.sku, r.cycleSeconds, r.reason].map(cell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
