// Importer for RAG Weekly spreadsheets.
//
// It reads BOTH layouts without any reformatting:
//
//  a) our own template (`ragTemplateExport.ts`) — labels in column A, the line
//     name on a row of its own, day headers like "Mon 21/07";
//  b) the factory workbook ("August Production RAG Performance v1.xlsx") — one
//     sheet per week ("WC 030826"), labels in column B, data from column C in
//     7 × (Day / Night / Total) blocks, the weekday and the date ("24-Aug-26")
//     in merged cells above, and the line name sitting in the label column of
//     the very same "Day / Night / Total" header row.
//
// Nothing is assumed to be at a fixed position: we locate every "Day"+"Night"
// header row, derive the label column from it, and read the date from the up-to
// three rows above each "Day" column.

export type Shift = "DAY" | "NIGHT";

export interface ParsedTemplateRow {
  entry_date: string; // yyyy-MM-dd
  line: string;
  shift: Shift;
  // Optional on purpose: a blank cell must never write a 0 over a stored value.
  plan_qty?: number;
  actual_qty?: number;
  upm_target?: number;
  upm_actual?: number;
  downtime_min?: number;
}

export interface ParsedTemplateComment {
  line: string;
  comment: string;
  entry_date: string; // the day the comment was written against
  week_start: string; // Monday of that day's week
}

export interface IgnoredLine {
  name: string;
  reason: string;
}

export interface TemplateParseResult {
  rows: ParsedTemplateRow[];
  comments: ParsedTemplateComment[];
  linesDetected: string[];
  linesIgnored: IgnoredLine[];
  datesDetected: string[];
  sheetsProcessed: string[];
}

type Metric = "plan" | "actual" | "upmTarget" | "upmActual" | "downtime" | "comment";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAYS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
]);

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Strip accents and punctuation so "Capsules & Tablets" == "capsules and tablets"-ish. */
export function cleanLineKey(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function iso(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function fullYear(y: number) {
  if (y >= 1000) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

/** Monday (ISO) of the week containing an yyyy-MM-dd date. */
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sunday
  const delta = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** "WC 240826" → 2026 (dd MM yy). Returns null when the name says nothing. */
export function yearFromSheetName(name: string): number | null {
  const m = String(name ?? "").match(/(\d{2})(\d{2})(\d{2})\s*$/);
  if (!m) return null;
  return fullYear(Number(m[3]));
}

/**
 * Accepts "24-Aug-26", "24/08/2026", "Mon 21/07", "2026-08-24", a real Excel
 * date and an Excel serial. `fallbackYear` fills in a missing year.
 */
export function parseDateCell(value: unknown, fallbackYear: number): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && isFinite(value) && value > 20000 && value < 80000) {
    // Excel serial (1900 system, with the well-known 1900 leap-year offset).
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(value ?? "").trim();
  if (!s) return null;

  // yyyy-MM-dd
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  // 24-Aug-26 / 24 Aug 2026 / Aug 24, 2026-ish
  m = s.match(/\b(\d{1,2})[\s\-/.]*([A-Za-z]{3,9})[\s\-/.]*(\d{2,4})?\b/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3] ? fullYear(Number(m[3])) : fallbackYear;
    return iso(y, MONTHS[m[2].toLowerCase()], Number(m[1]));
  }

  // 24/08/2026, 24/08/26, 21/07 (dd/MM — UK order)
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) {
    const y = m[3] ? fullYear(Number(m[3])) : fallbackYear;
    return iso(y, Number(m[2]), Number(m[1]));
  }
  return null;
}

/** True when the text is a header artefact rather than a real comment. */
export function isHeaderText(text: string, fallbackYear: number): boolean {
  const t = norm(text);
  if (!t) return true;
  if (t === "day" || t === "night" || t === "total") return true;
  if (WEEKDAYS.has(t)) return true;
  if (parseDateCell(text, fallbackYear)) return true;
  return false;
}

/** "2:00" → 120, "1:20" → 80, an Excel time serial → minutes, plain number → minutes. */
export function parseDowntimeMinutes(value: unknown, text: string): number | undefined {
  if (value instanceof Date) return value.getHours() * 60 + value.getMinutes();
  const s = String(text ?? "").trim();
  const hm = s.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  if (typeof value === "number" && isFinite(value)) {
    // A time-of-day cell stores a fraction of a day; anything ≥ 1 that is not a
    // whole number is still read as a day fraction only when clearly < 1.
    if (value > 0 && value < 1) return Math.round(value * 1440);
    return value;
  }
  const n = Number(s.replace(/[, ]/g, ""));
  if (s && !isNaN(n)) return n;
  return undefined;
}

function parseNumber(value: unknown, text: string): number | undefined {
  if (typeof value === "number" && isFinite(value)) return value;
  const s = String(text ?? "").trim();
  if (!s) return undefined;
  const n = Number(s.replace(/[, %]/g, ""));
  return isNaN(n) ? undefined : n;
}

/** Map a label-column cell to the metric it represents (null = not a metric). */
export function metricOf(label: string): Metric | null {
  const l = norm(label).replace(/[:.]+$/, "");
  if (!l) return null;
  if (l === "plan" || l.startsWith("plan ")) return "plan";
  if (l === "actual" || l.startsWith("actual ")) return "actual";
  if (l.startsWith("upm target") || l.startsWith("upm  target")) return "upmTarget";
  if (l.startsWith("upm actual")) return "upmActual";
  if (l.startsWith("downtime")) return "downtime";
  if (l.startsWith("comment")) return "comment";
  return null; // Variance %, blanks, "All Lines — …" banners, etc.
}

interface Cell {
  value: unknown; // raw value (number, Date, string)
  text: string; // display text ("" for errors / blanks)
  anchor: boolean; // false when the value came from a merge above/left
}

const EMPTY: Cell = { value: null, text: "", anchor: true };

interface DayGroup { day: number; night: number; total?: number; date: string | null }

export async function parseRagTemplateFile(
  file: File,
  knownLines: string[],
): Promise<TemplateParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  const knownByClean = new Map<string, string>();
  for (const l of knownLines) knownByClean.set(cleanLineKey(l), l);
  const matchLine = (text: string): string | null => {
    const t = String(text ?? "").trim();
    if (!t) return null;
    const exact = knownLines.find((l) => l.toLowerCase() === t.toLowerCase());
    if (exact) return exact;
    return knownByClean.get(cleanLineKey(t)) ?? null;
  };

  type Agg = { plan?: number; actual?: number; upmTarget?: number; upmActual?: number; downtime?: number };
  const agg = new Map<string, Agg>();
  // date|line -> daily UPM values that must be spread over both shifts.
  const dailyUpm = new Map<string, { target?: number; actual?: number }>();
  const commentsByKey = new Map<string, { line: string; entry_date: string; texts: string[] }>();
  const linesDetected = new Set<string>();
  const ignored = new Map<string, string>();
  const datesDetected = new Set<string>();
  const sheetsProcessed: string[] = [];

  const put = (dateStr: string, line: string, shift: Shift, field: keyof Agg, value: number | undefined) => {
    if (value === undefined) return;
    const k = `${dateStr}|${line}|${shift}`;
    const cur = agg.get(k) ?? {};
    const prev = cur[field];
    // Largest-wins guards against Total/summary rows overwriting a real value.
    cur[field] = prev === undefined ? value : Math.max(prev, value);
    agg.set(k, cur);
  };

  for (const sheetName of wb.SheetNames) {
    if (/instruction/i.test(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const nRows = range.e.r + 1;
    const nCols = range.e.c + 1;
    if (nRows < 2 || nCols < 2) continue;

    // ---- Build a grid, propagating merged values (anchor flag kept) --------
    const grid: Cell[][] = [];
    for (let r = 0; r < nRows; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < nCols; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as
          | { t?: string; v?: unknown; w?: string }
          | undefined;
        if (!cell || cell.t === "e" || cell.v === undefined || cell.v === null) {
          row.push(EMPTY);
        } else {
          const text = cell.v instanceof Date ? (cell.w ?? "") : (cell.w ?? String(cell.v));
          row.push({ value: cell.v, text: String(text).trim(), anchor: true });
        }
      }
      grid.push(row);
    }
    for (const m of (ws["!merges"] ?? []) as { s: { r: number; c: number }; e: { r: number; c: number } }[]) {
      const src = grid[m.s.r]?.[m.s.c];
      if (!src || !src.text) continue;
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          if (!grid[r] || c >= nCols) continue;
          grid[r][c] = { value: src.value, text: src.text, anchor: false };
        }
      }
    }

    const at = (r: number, c: number): Cell => grid[r]?.[c] ?? EMPTY;

    sheetsProcessed.push(sheetName);

    // Year: sheet name first ("WC 240826"), then any 20xx in the first rows.
    let year = yearFromSheetName(sheetName);
    if (!year) {
      for (let r = 0; r < Math.min(6, nRows) && !year; r++) {
        const joined = grid[r].map((c) => c.text).join(" ");
        const m = joined.match(/\b(20\d{2})\b/);
        if (m) year = Number(m[1]);
      }
    }
    const fallbackYear = year ?? new Date().getFullYear();

    const isHeaderRow = (r: number) => {
      for (let c = 0; c < nCols - 1; c++) {
        if (norm(at(r, c).text) === "day" && norm(at(r, c + 1).text) === "night") return c;
      }
      return -1;
    };

    let block: { line: string | null; groups: DayGroup[]; labelCol: number } | null = null;
    let pendingLabel = "";

    for (let r = 0; r < nRows; r++) {
      const firstDay = isHeaderRow(r);

      if (firstDay >= 0) {
        // Label column: the last non-empty cell before the first "Day".
        let labelCol = Math.max(0, firstDay - 1);
        for (let c = firstDay - 1; c >= 0; c--) {
          if (at(r, c).text) { labelCol = c; break; }
        }

        // Day groups across the row.
        const groups: DayGroup[] = [];
        for (let c = firstDay; c < nCols - 1; ) {
          if (norm(at(r, c).text) === "day" && norm(at(r, c + 1).text) === "night") {
            const total = norm(at(r, c + 2).text) === "total" ? c + 2 : undefined;
            let date: string | null = null;
            for (let up = 1; up <= 3 && !date; up++) {
              if (r - up < 0) break;
              date = parseDateCell(at(r - up, c).value, fallbackYear)
                ?? parseDateCell(at(r - up, c).text, fallbackYear);
            }
            if (date) datesDetected.add(date);
            groups.push({ day: c, night: c + 1, total, date });
            c += total !== undefined ? 3 : 2;
          } else c++;
        }

        // Line name: in the header row's label column (factory layout), else the
        // standalone label seen just above (our template layout).
        const inRow = at(r, labelCol).text;
        const rawName = inRow || pendingLabel;
        const matched = rawName ? matchLine(rawName) : null;
        if (matched) linesDetected.add(matched);
        else if (rawName && !/all lines/i.test(rawName) && !isHeaderText(rawName, fallbackYear)) {
          ignored.set(rawName, "Line name not found in the Lines table");
        }
        block = { line: matched, groups, labelCol };
        pendingLabel = "";
        continue;
      }

      // Standalone label row (our template's line banner).
      //
      // Only anchors count. Our exporter merges the banner across the full width of
      // the sheet, so after the merge is propagated every column on that row carries
      // "Line 1" — counting them all made the row look like a data row, the line name
      // was never picked up, and the whole export re-imported as zero rows.
      const nonEmpty: number[] = [];
      for (let c = 0; c < nCols; c++) if (at(r, c).anchor && at(r, c).text) nonEmpty.push(c);
      if (nonEmpty.length === 1) {
        const label = at(r, nonEmpty[0]).text;
        if (!metricOf(label)) {
          pendingLabel = label;
          if (/all lines/i.test(label)) block = null;
          continue;
        }
      }

      if (!block || !block.line || !block.groups.length) continue;
      const line = block.line;

      const label = at(r, block.labelCol).text;
      const metric = metricOf(label);
      if (!metric) continue;

      if (metric === "comment") {
        const addComment = (dateStr: string, text: string) => {
          const key = `${line}|${dateStr}`;
          const cur = commentsByKey.get(key) ?? { line, entry_date: dateStr, texts: [] };
          if (!cur.texts.includes(text)) cur.texts.push(text);
          commentsByKey.set(key, cur);
        };
        let found = false;
        for (const g of block.groups) {
          if (!g.date) continue;
          const cell = at(r, g.day);
          // Merged comments live only on their anchor — otherwise the same text
          // would be attributed to every day it visually spans.
          if (!cell.anchor || !cell.text) continue;
          if (isHeaderText(cell.text, fallbackYear)) continue;
          addComment(g.date, cell.text);
          found = true;
        }
        if (!found) {
          // Our own template parks the week's comment in the Week Total slot,
          // just past the last day block: it belongs to the Monday.
          //
          // "Past the last day block", not past the last group: the template's own
          // Week Total columns are themselves a Day/Night/Total trio and get picked
          // up as a group with no date, which would send this one column too far.
          const dated = block.groups.filter((g) => g.date);
          const last = dated[dated.length - 1] ?? block.groups[block.groups.length - 1];
          const weekCol = (last.total ?? last.night) + 1;
          const cell = at(r, weekCol);
          const firstDate = block.groups.find((g) => g.date)?.date;
          if (cell.text && firstDate && !isHeaderText(cell.text, fallbackYear)) {
            addComment(firstDate, cell.text);
          }
        }
        continue;
      }


      for (const g of block.groups) {
        if (!g.date) continue;
        const dayCell = at(r, g.day);
        const nightCell = at(r, g.night);
        const totalCell = g.total !== undefined ? at(r, g.total) : EMPTY;

        if (metric === "downtime") {
          put(g.date, line, "DAY", "downtime", parseDowntimeMinutes(dayCell.value, dayCell.text));
          put(g.date, line, "NIGHT", "downtime", parseDowntimeMinutes(nightCell.value, nightCell.text));
          continue;
        }

        const dayV = parseNumber(dayCell.value, dayCell.text);
        const nightV = parseNumber(nightCell.value, nightCell.text);

        if (metric === "upmTarget" || metric === "upmActual") {
          const field = metric === "upmTarget" ? "target" : "actual";
          if (dayV === undefined && nightV === undefined) {
            // The factory sheet fills UPM only in the day's Total column: it is
            // a daily figure, applied later to the shifts that actually ran.
            const totalV = parseNumber(totalCell.value, totalCell.text);
            if (totalV !== undefined) {
              const k = `${g.date}|${line}`;
              const cur = dailyUpm.get(k) ?? {};
              cur[field] = Math.max(cur[field] ?? 0, totalV);
              dailyUpm.set(k, cur);
            }
          } else {
            put(g.date, line, "DAY", metric === "upmTarget" ? "upmTarget" : "upmActual", dayV);
            put(g.date, line, "NIGHT", metric === "upmTarget" ? "upmTarget" : "upmActual", nightV);
          }
          continue;
        }

        const field = metric === "plan" ? "plan" : "actual";
        put(g.date, line, "DAY", field, dayV);
        put(g.date, line, "NIGHT", field, nightV);
      }
    }
  }

  // Daily UPM → both shifts, but only where the shift really ran.
  for (const [k, v] of dailyUpm) {
    const [dateStr, line] = k.split("|");
    for (const shift of ["DAY", "NIGHT"] as Shift[]) {
      const cur = agg.get(`${dateStr}|${line}|${shift}`);
      if (!cur) continue;
      if (cur.plan === undefined && cur.actual === undefined) continue;
      if (v.target !== undefined && cur.upmTarget === undefined) cur.upmTarget = v.target;
      if (v.actual !== undefined && cur.upmActual === undefined) cur.upmActual = v.actual;
    }
  }

  const rows: ParsedTemplateRow[] = [];
  for (const [k, v] of agg) {
    const hasValue = [v.plan, v.actual, v.upmTarget, v.upmActual, v.downtime].some(
      (x) => x !== undefined,
    );
    if (!hasValue) continue;
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
  rows.sort((a, b) =>
    a.entry_date.localeCompare(b.entry_date) || a.line.localeCompare(b.line) || a.shift.localeCompare(b.shift),
  );

  const comments: ParsedTemplateComment[] = [...commentsByKey.values()]
    .map((c) => ({
      line: c.line,
      entry_date: c.entry_date,
      week_start: mondayOf(c.entry_date),
      comment: c.texts.join("\n"),
    }))
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.line.localeCompare(b.line));

  return {
    rows,
    comments,
    linesDetected: [...linesDetected].sort(),
    linesIgnored: [...ignored.entries()].map(([name, reason]) => ({ name, reason })),
    datesDetected: [...datesDetected].sort(),
    sheetsProcessed,
  };
}
