// Importer for the "Production Line Performance — RAG status" workbook (the
// factory's own standard: one sheet per week "WC DDMMYY", each line laid out as
// a block with a Day/Night/Total header and Plan / Actual / Variance / UPM
// target / UPM actual / Downtime / Comments rows across Mon–Sun).
//
// This complements ragTemplateImport (which reads the app's own template). The
// RAG import tries the app template first, then falls back to this parser, so
// both the app's export AND the historic performance spreadsheet import cleanly.

import { format } from "date-fns";
import type { ParsedTemplateRow, Shift } from "./ragTemplateImport";

export interface PerfComment {
  line: string;
  comment: string;
  week_start: string; // yyyy-MM-dd (Monday of that sheet's week)
}

export interface PerfParseResult {
  rows: ParsedTemplateRow[];
  comments: PerfComment[];
  linesDetected: string[];
  datesDetected: string[];
  sheetsProcessed: string[];
}

const FIRST0 = 2; // 0-indexed column C (Monday · Day)

// Map the sheet's line label to a DB line name. The standard sheet uses
// "Tablet line" for the app's "Capsules & Tablets", and "Gel" for "GEL Machine".
const LINE_ALIAS: Record<string, string> = {
  "tablet line": "Capsules & Tablets",
  tablet: "Capsules & Tablets",
  tablets: "Capsules & Tablets",
  "tablet machine": "Capsules & Tablets",
  "capsules & tablets": "Capsules & Tablets",
  "caps & tabs": "Capsules & Tablets",
  gel: "GEL Machine",
  "gel machine": "GEL Machine",
  "gel line": "GEL Machine",
};

function mapLine(raw: unknown, known: string[]): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const tl = t.toLowerCase();
  if (LINE_ALIAS[tl]) return LINE_ALIAS[tl];
  const exact = known.find((k) => k.toLowerCase() === tl);
  if (exact) return exact;
  const m = tl.match(/^line\s*0*(\d{1,2})$/);
  if (m) {
    const n = Number(m[1]);
    return known.find((k) => k.toLowerCase() === `line ${n}`) ?? `Line ${n}`;
  }
  return null;
}

function serialToStr(n: number): string | null {
  if (!(n > 20000 && n < 90000)) return null;
  return format(new Date(Math.round((n - 25569) * 86400 * 1000)), "yyyy-MM-dd");
}
function toDateStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return serialToStr(v);
  if (v instanceof Date && !isNaN(v.getTime())) return format(v, "yyyy-MM-dd");
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const yyyy = y.length === 2 ? `20${y}` : y;
    if (Number(yyyy) < 2020) return null;
    return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  return isNaN(n) ? null : serialToStr(n);
}
// Downtime cells are Excel time values (fraction of a day) or "h:mm" strings.
function toMin(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v > 0 && v < 2 ? Math.round(v * 1440) : Math.round(v);
  if (v instanceof Date) return v.getUTCHours() * 60 + v.getUTCMinutes();
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  return isNaN(n) ? 0 : n > 0 && n < 2 ? Math.round(n * 1440) : Math.round(n);
}
function num(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const n = Number(String(v ?? "").trim().replace(/[, %]/g, ""));
  return isNaN(n) ? 0 : n;
}
const lc = (v: unknown) => String(v ?? "").trim().toLowerCase();

type Cell = { plan: number; actual: number; upmT: number; upmA: number; dt: number };
type Field = "plan" | "actual" | "upmT" | "upmA" | "dt";

export async function parseRagPerformanceFile(
  file: File,
  knownLines: string[],
): Promise<PerfParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: false });

  const agg = new Map<string, Cell>();
  const bump = (date: string, line: string, shift: Shift, field: Field, value: number) => {
    if (!value) return;
    const k = `${date}|${line}|${shift}`;
    const cur = agg.get(k) ?? { plan: 0, actual: 0, upmT: 0, upmA: 0, dt: 0 };
    cur[field] = Math.max(cur[field], value);
    agg.set(k, cur);
  };

  const commentMap = new Map<string, PerfComment>();
  const linesDetected = new Set<string>();
  const datesDetected = new Set<string>();
  const sheetsProcessed: string[] = [];

  for (const sheetName of wb.SheetNames) {
    if (/^sheet\d*$/i.test(sheetName.trim()) || /instruction/i.test(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    // Force absolute A1 origin so column indices are stable even when columns A/B
    // are blank in the source (otherwise sheet_to_json shifts every column left).
    if (ws["!ref"]) {
      const range = XLSX.utils.decode_range(ws["!ref"]);
      range.s.c = 0;
      range.s.r = 0;
      ws["!ref"] = XLSX.utils.encode_range(range);
    }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
    sheetsProcessed.push(sheetName);

    for (let r = 0; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      // A line block starts on the Day/Night/Total header row.
      if (lc(row[FIRST0]) !== "day" || lc(row[FIRST0 + 1]) !== "night") continue;
      const line = mapLine(row[1], knownLines);
      if (!line) continue;
      linesDetected.add(line);

      // Dates come from the row directly above (Monday..Sunday, every 3 cols).
      const above = aoa[r - 1] ?? [];
      const dts: (string | null)[] = [];
      for (let i = 0; i < 7; i++) dts.push(toDateStr(above[FIRST0 + i * 3]));
      const weekStart = dts.find((d): d is string => !!d) ?? null;
      dts.forEach((d) => d && datesDetected.add(d));

      // Metric rows follow the header until the next block / end of block.
      for (let rr = r + 1; rr < Math.min(aoa.length, r + 13); rr++) {
        const mrow = aoa[rr] ?? [];
        if (lc(mrow[FIRST0]) === "day" && lc(mrow[FIRST0 + 1]) === "night") break;
        const label = lc(mrow[1]);
        if (label.startsWith("comment")) {
          if (weekStart) {
            let txt = "";
            for (let c = FIRST0; c < 30; c++) {
              const v = mrow[c];
              if (v != null && typeof v !== "number" && String(v).trim()) {
                txt = String(v).trim();
                break;
              }
            }
            if (txt) commentMap.set(`${line}|${weekStart}`, { line, week_start: weekStart, comment: txt });
          }
          break; // Comments is the last row of a block.
        }
        let field: Field | null = null;
        if (label === "plan") field = "plan";
        else if (label === "actual") field = "actual";
        else if (label.startsWith("upm target")) field = "upmT";
        else if (label.startsWith("upm actual")) field = "upmA";
        else if (label.startsWith("downtime")) field = "dt";
        if (!field) continue;

        for (let i = 0; i < 7; i++) {
          const date = dts[i];
          if (!date) continue;
          const b = FIRST0 + i * 3;
          if (field === "dt") {
            bump(date, line, "DAY", "dt", toMin(mrow[b + 2])); // Total col = daily downtime
          } else if (field === "upmT" || field === "upmA") {
            bump(date, line, "DAY", field, num(mrow[b + 2])); // Total col = daily UPM
          } else {
            bump(date, line, "DAY", field, num(mrow[b]));
            bump(date, line, "NIGHT", field, num(mrow[b + 1]));
          }
        }
      }
    }
  }

  const rows: ParsedTemplateRow[] = [];
  for (const [k, v] of agg) {
    if (!v.plan && !v.actual && !v.upmT && !v.upmA && !v.dt) continue;
    const [entry_date, line, shift] = k.split("|");
    rows.push({
      entry_date,
      line,
      shift: shift as Shift,
      plan_qty: v.plan,
      actual_qty: v.actual,
      upm_target: v.upmT,
      upm_actual: v.upmA,
      downtime_min: v.dt,
    });
  }

  return {
    rows,
    comments: [...commentMap.values()],
    linesDetected: [...linesDetected].sort(),
    datesDetected: [...datesDetected].sort(),
    sheetsProcessed,
  };
}
