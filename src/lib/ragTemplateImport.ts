// Deterministic importer for the RAG Weekly template produced by
// `ragTemplateExport.ts`. Because we own that exact layout (fixed label column,
// per-line blocks, a "Day / Night / Total" sub-header, and metric rows in a
// known order) we can parse it precisely instead of heuristically — the same
// file the user downloaded, edited and re-uploaded round-trips cleanly.

export type Shift = "DAY" | "NIGHT";

export interface ParsedTemplateRow {
  entry_date: string; // yyyy-MM-dd
  line: string;
  shift: Shift;
  plan_qty: number;
  actual_qty: number;
  upm_target: number;
  upm_actual: number;
  downtime_min: number;
}

export interface ParsedTemplateComment {
  line: string;
  comment: string;
}

export interface TemplateParseResult {
  rows: ParsedTemplateRow[];
  comments: ParsedTemplateComment[];
  linesDetected: string[];
  datesDetected: string[];
  sheetsProcessed: string[];
}

const DAYS = 7;
const COLS_PER_DAY = 3;
const FIRST_DATA_COL0 = 1; // 0-indexed column B
const WEEK_DAY_COL0 = FIRST_DATA_COL0 + DAYS * COLS_PER_DAY; // 0-indexed col 22

function num(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/[, %]/g, ""));
  return isNaN(n) ? 0 : n;
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const cleanKey = (v: unknown) => norm(v).replace(/[^a-z0-9]+/g, "");

/** Map a label-column cell to the metric it represents (null = not a metric). */
function metricOf(label: string): "plan" | "actual" | "upmTarget" | "upmActual" | "downtime" | "comment" | null {
  const l = norm(label);
  if (!l) return null;
  if (l === "plan") return "plan";
  if (l === "actual") return "actual";
  if (l.startsWith("upm target")) return "upmTarget";
  if (l.startsWith("upm actual")) return "upmActual";
  if (l.startsWith("downtime")) return "downtime";
  if (l.startsWith("comment")) return "comment";
  return null; // Variance %, blanks, "All Lines — …" rows, etc.
}

export async function parseRagTemplateFile(
  file: File,
  knownLines: string[],
): Promise<TemplateParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  // line-name matcher: exact first, then normalized (strip punctuation/spaces).
  const knownByClean = new Map<string, string>();
  for (const l of knownLines) knownByClean.set(cleanKey(l), l);
  const matchLine = (text: string): string | null => {
    const t = String(text ?? "").trim();
    if (!t) return null;
    const exact = knownLines.find((l) => l.toLowerCase() === t.toLowerCase());
    if (exact) return exact;
    return knownByClean.get(cleanKey(t)) ?? null;
  };

  // Parse the year once from the title row ("… – dd MMM yyyy"); fall back to now.
  const yearFrom = (rows: unknown[][]): number => {
    for (let r = 0; r < Math.min(3, rows.length); r++) {
      const joined = (rows[r] ?? []).map((c) => String(c ?? "")).join(" ");
      const m = joined.match(/\b(20\d{2})\b/);
      if (m) return Number(m[1]);
    }
    return new Date().getFullYear();
  };

  const agg = new Map<string, { plan: number; actual: number; upmTarget: number; upmActual: number; downtime: number }>();
  const commentByLine = new Map<string, string>();
  const linesDetected = new Set<string>();
  const datesDetected = new Set<string>();
  const sheetsProcessed: string[] = [];

  const bump = (
    dateStr: string,
    line: string,
    shift: Shift,
    field: "plan" | "actual" | "upmTarget" | "upmActual" | "downtime",
    value: number,
  ) => {
    if (!value) return;
    const k = `${dateStr}|${line}|${shift}`;
    const cur = agg.get(k) ?? { plan: 0, actual: 0, upmTarget: 0, upmActual: 0, downtime: 0 };
    // Largest-wins guards against Total/summary rows accidentally overwriting.
    cur[field] = Math.max(cur[field], value);
    agg.set(k, cur);
  };

  for (const sheetName of wb.SheetNames) {
    if (/instruction/i.test(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
    if (!aoa.length) continue;
    sheetsProcessed.push(sheetName);
    const year = yearFrom(aoa);

    let currentLine: string | null = null;
    let dayDates: (string | null)[] = new Array(DAYS).fill(null);
    let haveHeader = false;

    const parseDateCell = (v: unknown): string | null => {
      // Header cells look like "Mon 21/07"; also tolerate a raw dd/MM.
      const s = String(v ?? "").trim();
      const m = s.match(/(\d{1,2})[/.-](\d{1,2})/);
      if (!m) return null;
      const dd = m[1].padStart(2, "0");
      const mm = m[2].padStart(2, "0");
      return `${year}-${mm}-${dd}`;
    };

    for (let r = 0; r < aoa.length; r++) {
      const row = aoa[r] ?? [];
      const labelCell = row[0];

      // (1) Sub-header row "Day/Night/Total …" establishes the column→date map
      // using the date labels one row above.
      if (norm(row[FIRST_DATA_COL0]) === "day" && norm(row[FIRST_DATA_COL0 + 1]) === "night") {
        const above = aoa[r - 1] ?? [];
        const dates: (string | null)[] = [];
        for (let i = 0; i < DAYS; i++) {
          dates.push(parseDateCell(above[FIRST_DATA_COL0 + i * COLS_PER_DAY]));
        }
        if (dates.some((d) => d)) {
          dayDates = dates;
          haveHeader = true;
          dates.forEach((d) => d && datesDetected.add(d));
        }
        continue;
      }

      // (2) Line header — a lone label matching a known line, everything else empty.
      const restEmpty = row.slice(1).every((c) => String(c ?? "").trim() === "");
      if (restEmpty && labelCell) {
        const matched = matchLine(String(labelCell));
        if (matched) {
          currentLine = matched;
          linesDetected.add(matched);
          continue;
        }
        // "All Lines" and any other non-line banner ends the current block.
        if (/all lines/i.test(String(labelCell))) currentLine = null;
        continue;
      }

      if (!currentLine || !haveHeader) continue;

      const metric = metricOf(String(labelCell ?? ""));
      if (!metric) continue;

      if (metric === "comment") {
        // One comment per line/week: prefer the Week-Total slot, else the first
        // non-empty day cell.
        let text = String(row[WEEK_DAY_COL0] ?? "").trim();
        if (!text) {
          for (let i = 0; i < DAYS; i++) {
            const v = String(row[FIRST_DATA_COL0 + i * COLS_PER_DAY] ?? "").trim();
            if (v) { text = v; break; }
          }
        }
        if (text) commentByLine.set(currentLine, text);
        continue;
      }

      for (let i = 0; i < DAYS; i++) {
        const dateStr = dayDates[i];
        if (!dateStr) continue;
        const base = FIRST_DATA_COL0 + i * COLS_PER_DAY;
        bump(dateStr, currentLine, "DAY", metric, num(row[base]));
        bump(dateStr, currentLine, "NIGHT", metric, num(row[base + 1]));
      }
    }
  }

  const rows: ParsedTemplateRow[] = [];
  for (const [k, v] of agg) {
    if (!v.plan && !v.actual && !v.upmTarget && !v.upmActual && !v.downtime) continue;
    const [entry_date, line, shift] = k.split("|");
    rows.push({
      entry_date,
      line,
      shift: shift as Shift,
      plan_qty: v.plan,
      actual_qty: v.actual,
      upm_target: v.upmTarget,
      upm_actual: v.upmActual,
      downtime_min: v.downtime,
    });
  }

  const comments: ParsedTemplateComment[] = [...commentByLine.entries()].map(([line, comment]) => ({ line, comment }));

  return {
    rows,
    comments,
    linesDetected: [...linesDetected].sort(),
    datesDetected: [...datesDetected].sort(),
    sheetsProcessed,
  };
}
