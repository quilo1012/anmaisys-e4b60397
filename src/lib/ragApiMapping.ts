/**
 * Turns the SharePoint RAG reader API payload into the rows the RAG Weekly board
 * stores. The same promises the Excel importer makes are kept here:
 *
 *  - a blank value in the source never writes a 0 over a stored number
 *    (values come back as `undefined`, and the caller keeps what it had);
 *  - downtime arrives as "02:45:00" and is stored in minutes;
 *  - UPM only exists on the day total in the workbook, so it is written to both
 *    shifts — but only to a shift that actually has Plan or Actual;
 *  - Variance is derived, never imported;
 *  - a line the factory sheet names but the board does not know is reported,
 *    not silently dropped.
 */

import { cleanLineKey, mondayOf, type ParsedTemplateRow, type Shift } from "./ragTemplateImport";

export interface RagApiMetricBlock {
  day?: number | string | null;
  night?: number | string | null;
  total?: number | string | null;
  yield_percent?: number | null;
}

export interface RagApiRecord {
  date?: string | null;
  line?: string | null;
  week_commencing?: string | null;
  sheet?: string | null;
  source_file?: string | null;
  metrics?: {
    plan?: RagApiMetricBlock | null;
    actual?: RagApiMetricBlock | null;
    upm_target?: RagApiMetricBlock | null;
    upm_actual?: RagApiMetricBlock | null;
    downtime?: RagApiMetricBlock | null;
    comments?: unknown;
  } | null;
}

export interface RagApiComment {
  line: string;
  comment: string;
  entry_date: string;
  week_start: string;
}

export interface RagApiMapResult {
  rows: ParsedTemplateRow[];
  comments: RagApiComment[];
  linesDetected: string[];
  linesIgnored: { name: string; reason: string }[];
  datesDetected: string[];
  sheets: string[];
  files: string[];
}

/** A number, or `undefined` when the source had nothing to say. */
export function numberOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const n = Number(String(v).trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** "02:45:00" / "2:45" / 150 → minutes. Empty or "00:00:00" with no data → undefined. */
export function downtimeToMinutes(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  const m = s.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (m) {
    const h = Number(m[1]), mi = Number(m[2]), se = Number(m[3] ?? 0);
    return Math.round(h * 60 + mi + se / 60);
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/**
 * Map the API records for a set of days into board rows.
 * `knownLines` are the board's line names — matching ignores case, accents and
 * punctuation, so "Capsules & Tablets" finds "Capsules and Tablets".
 */
export function mapRagApiRecords(
  records: RagApiRecord[],
  knownLines: string[],
): RagApiMapResult {
  const byKey = new Map<string, string>();
  for (const l of knownLines) byKey.set(cleanLineKey(l), l);

  const rows: ParsedTemplateRow[] = [];
  const comments: RagApiComment[] = [];
  const detected = new Set<string>();
  const ignored = new Map<string, string>();
  const dates = new Set<string>();
  const sheets = new Set<string>();
  const files = new Set<string>();

  for (const rec of records ?? []) {
    const date = typeof rec?.date === "string" ? rec.date.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const rawLine = String(rec?.line ?? "").trim();
    if (!rawLine) continue;
    const line = byKey.get(cleanLineKey(rawLine));
    if (!line) {
      if (!ignored.has(rawLine)) {
        ignored.set(rawLine, "no line with this name on the board");
      }
      continue;
    }

    const m = rec?.metrics ?? {};
    const perShift = (block: RagApiMetricBlock | null | undefined, shift: Shift) =>
      numberOrUndefined(shift === "DAY" ? block?.day : block?.night);

    const dayTotalUpmTarget = numberOrUndefined(m.upm_target?.total);
    const dayTotalUpmActual = numberOrUndefined(m.upm_actual?.total);

    let wroteAnything = false;

    for (const shift of ["DAY", "NIGHT"] as Shift[]) {
      const plan = perShift(m.plan, shift);
      const actual = perShift(m.actual, shift);
      const downtime = downtimeToMinutes(shift === "DAY" ? m.downtime?.day : m.downtime?.night);

      // UPM lives only on the day total in the workbook; spread it, but only to a
      // shift that really ran.
      const hasVolume = plan !== undefined || actual !== undefined;
      const upmTargetShift = perShift(m.upm_target, shift);
      const upmActualShift = perShift(m.upm_actual, shift);
      const upm_target = upmTargetShift ?? (hasVolume ? dayTotalUpmTarget : undefined);
      const upm_actual = upmActualShift ?? (hasVolume ? dayTotalUpmActual : undefined);

      if (
        plan === undefined && actual === undefined && downtime === undefined &&
        upm_target === undefined && upm_actual === undefined
      ) continue;

      rows.push({
        entry_date: date,
        line,
        shift,
        ...(plan !== undefined ? { plan_qty: plan } : {}),
        ...(actual !== undefined ? { actual_qty: actual } : {}),
        ...(downtime !== undefined ? { downtime_min: downtime } : {}),
        ...(upm_target !== undefined ? { upm_target } : {}),
        ...(upm_actual !== undefined ? { upm_actual } : {}),
      });
      wroteAnything = true;
    }

    const commentText = typeof m.comments === "string" ? m.comments.trim() : "";
    if (commentText) {
      comments.push({ line, comment: commentText, entry_date: date, week_start: mondayOf(date) });
      wroteAnything = true;
    }

    if (wroteAnything) {
      detected.add(line);
      dates.add(date);
      if (rec.sheet) sheets.add(String(rec.sheet));
      if (rec.source_file) files.add(String(rec.source_file));
    }
  }

  return {
    rows,
    comments,
    linesDetected: [...detected].sort(),
    linesIgnored: [...ignored].map(([name, reason]) => ({ name, reason })),
    datesDetected: [...dates].sort(),
    sheets: [...sheets].sort(),
    files: [...files].sort(),
  };
}
