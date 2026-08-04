import * as XLSX from "xlsx";

/**
 * The TimeMoto timesheet export, read into days.
 *
 * Written without the file in hand, so it is deliberately forgiving about what the
 * columns are called and deliberately loud about what it could not find. A parser
 * that guesses a column wrong imports a thousand rows of confident nonsense; this one
 * reports the headings it recognised and the ones it did not, and the screen shows
 * that before anything is written.
 */

export interface TimeMotoRow {
  name: string;
  /** yyyy-mm-dd */
  date: string;
  start: string | null;
  end: string | null;
  /** Minutes actually worked. Zero on an absence day. */
  workedMinutes: number;
  /** Signed minutes against the contracted day: negative is short, positive is over. */
  balanceMinutes: number | null;
  /** Vacation, Sickness, Unpaid Leave — verbatim, so an unfamiliar one is visible. */
  absence: string | null;
  /** What the contract said the day should be. TimeMoto calls it WorkSchedule. */
  scheduledMinutes: number | null;
  /** A manual correction the office made to overtime, kept apart from the clocked time. */
  overtimeAdjMinutes: number | null;
  remarks: string | null;
}

export interface TimeMotoParse {
  rows: TimeMotoRow[];
  /** Heading → the field it was read as, for the preview. */
  columns: Record<string, string>;
  /** Headings present in the file that mean nothing to this parser. */
  ignoredColumns: string[];
  /** Rows skipped, with why — a total line, a blank, an unreadable date. */
  skipped: { row: number; reason: string }[];
  names: string[];
  from: string | null;
  to: string | null;
}

/** Every spelling of a column this parser answers to. */
const FIELDS: { field: keyof TimeMotoRow | "firstname" | "lastname" | "ignore"; aliases: string[] }[] = [
  { field: "name", aliases: ["name", "employee", "employee name", "full name", "user", "person"] },
  // TimeMoto splits the person across two columns. Without these the header hunt
  // finds no name at all and the whole file is rejected as unreadable.
  { field: "firstname", aliases: ["firstname", "first name", "given name"] },
  { field: "lastname", aliases: ["lastname", "last name", "surname", "family name"] },
  { field: "date", aliases: ["date", "day", "work date"] },
  { field: "start", aliases: ["in", "start", "start time", "clock in", "first in"] },
  { field: "end", aliases: ["out", "end", "end time", "clock out", "last out"] },
  { field: "workedMinutes", aliases: ["duration", "worked", "worked hours", "hours", "total", "actual"] },
  { field: "balanceMinutes", aliases: ["balance", "saldo", "overtime", "difference", "diff"] },
  { field: "absence", aliases: ["absence", "absence name", "absencename", "leave", "leave type", "type", "reason"] },
  { field: "scheduledMinutes", aliases: ["workschedule", "work schedule", "scheduled", "planned", "contract"] },
  { field: "overtimeAdjMinutes", aliases: ["overtimeadjustment", "overtime adjustment", "adjustment", "ot adjustment"] },
  { field: "remarks", aliases: ["remarks", "remark", "note", "notes", "comment"] },
];

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** A row that totals or separates rather than reporting a day. */
const NOT_A_PERSON = /^(total|totals|subtotal|grand total|sum|—|-)$/i;

/**
 * `8:30`, `-1:15`, `07:45`, or a fraction of a day from a real Excel time cell.
 *
 * Negative matters: TimeMoto reports a short day as `-1:15`, and reading that as
 * seventy-five minutes owed rather than owing inverts somebody's balance.
 */
export function parseHm(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    // Excel stores a time as a fraction of a day. Anything under 2 is a duration,
    // not a count of minutes somebody typed.
    if (Math.abs(value) < 2) return Math.round(value * 24 * 60);
    return Math.round(value);
  }
  const raw = String(value).trim();
  const m = raw.match(/^(-)?(\d{1,3}):([0-5]?\d)$/);
  if (m) {
    const mins = Number(m[2]) * 60 + Number(m[3]);
    return m[1] ? -mins : mins;
  }
  const plain = Number(raw.replace(",", "."));
  if (!Number.isNaN(plain)) return Math.round(plain * 60);
  return null;
}

/** `04/08/26`, `4/8/2026`, `2026-08-04`, or an Excel date cell. */
export function parseDmy(value: unknown, fallbackYear: number): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (dmy) {
    const d = Number(dmy[1]);
    const mo = Number(dmy[2]);
    let y = dmy[3] ? Number(dmy[3]) : fallbackYear;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

export function parseTimeMotoWorkbook(wb: XLSX.WorkBook, fallbackYear: number): TimeMotoParse {
  const out: TimeMotoParse = {
    rows: [], columns: {}, ignoredColumns: [], skipped: [], names: [], from: null, to: null,
  };
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return out;

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: false, dateNF: "yyyy-mm-dd" });

  // The header is the first row that names both somebody and a date — TimeMoto puts
  // a title and a date range above it, and taking row 1 blindly read those as data.
  let headerAt = -1;
  let map: Record<number, string> = {};
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const cells = (grid[i] ?? []).map(norm);
    const found: Record<number, string> = {};
    cells.forEach((c, idx) => {
      if (!c) return;
      const hit = FIELDS.find((f) => f.aliases.includes(c));
      if (hit) found[idx] = hit.field as string;
    });
    const fields = Object.values(found);
    const hasName = fields.includes("name") || fields.includes("firstname");
    if (hasName && fields.includes("date")) {
      headerAt = i;
      map = found;
      (grid[i] ?? []).forEach((c, idx) => {
        const label = String(c ?? "").trim();
        if (!label) return;
        if (found[idx]) out.columns[label] = found[idx];
        else out.ignoredColumns.push(label);
      });
      break;
    }
  }
  if (headerAt === -1) {
    out.skipped.push({ row: 0, reason: "No header row with both a name and a date column" });
    return out;
  }

  const names = new Set<string>();
  // TimeMoto repeats the person only on their first line and leaves it blank after,
  // so the last name seen carries down the block.
  let carriedName = "";

  for (let i = headerAt + 1; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    const get = (field: string) => {
      const idx = Object.keys(map).find((k) => map[Number(k)] === field);
      return idx === undefined ? undefined : cells[Number(idx)];
    };

    // One column or two, joined here so everything downstream sees a single name.
    const rawName = (String(get("name") ?? "").trim()
      || [get("firstname"), get("lastname")].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ")).trim();
    if (rawName && NOT_A_PERSON.test(rawName)) { out.skipped.push({ row: i + 1, reason: `"${rawName}" is a total, not a person` }); continue; }
    if (rawName) carriedName = rawName;
    if (!carriedName) continue;

    const date = parseDmy(get("date"), fallbackYear);
    if (!date) {
      if (cells.some((c) => String(c ?? "").trim())) out.skipped.push({ row: i + 1, reason: "no readable date" });
      continue;
    }

    const absence = String(get("absence") ?? "").trim() || null;
    const worked = parseHm(get("workedMinutes"));
    out.rows.push({
      name: carriedName,
      date,
      start: String(get("start") ?? "").trim() || null,
      end: String(get("end") ?? "").trim() || null,
      // An absence day is zero worked, whatever the duration column happens to hold.
      workedMinutes: absence ? 0 : Math.max(0, worked ?? 0),
      balanceMinutes: parseHm(get("balanceMinutes")),
      absence,
      scheduledMinutes: parseHm(get("scheduledMinutes")),
      overtimeAdjMinutes: parseHm(get("overtimeAdjMinutes")),
      remarks: String(get("remarks") ?? "").trim() || null,
    });
    names.add(carriedName);
    if (!out.from || date < out.from) out.from = date;
    if (!out.to || date > out.to) out.to = date;
  }

  out.names = [...names].sort();
  return out;
}

export interface NameMatch {
  matched: { name: string; employeeId: string }[];
  unmatched: string[];
}

/**
 * Timesheet names against the payroll.
 *
 * The same rule the headcount import uses, and for the same reason: a full name that
 * appears once wins, a first name wins only when one person answers to it, and
 * anything else is handed back rather than guessed. "Marcio Carvalho 1" is a real
 * example — a duplicate account with a suffix, which no amount of cleverness should
 * silently attach to Marcio Carvalho.
 */
export function matchNames(names: string[], roster: { id: string; full_name: string }[]): NameMatch {
  const clean = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byFull = new Map<string, string[]>();
  const byFirst = new Map<string, string[]>();
  for (const e of roster) {
    const full = clean(e.full_name);
    const first = full.split(" ")[0];
    if (!byFull.has(full)) byFull.set(full, []);
    byFull.get(full)!.push(e.id);
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first)!.push(e.id);
  }
  const matched: { name: string; employeeId: string }[] = [];
  const unmatched: string[] = [];
  for (const n of names) {
    const c = clean(n);
    const full = byFull.get(c);
    if (full?.length === 1) { matched.push({ name: n, employeeId: full[0] }); continue; }
    if (full && full.length > 1) { unmatched.push(n); continue; }
    const first = byFirst.get(c);
    if (first?.length === 1) { matched.push({ name: n, employeeId: first[0] }); continue; }
    unmatched.push(n);
  }
  return { matched, unmatched };
}
