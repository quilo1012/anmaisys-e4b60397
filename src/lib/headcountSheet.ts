import * as XLSX from "xlsx";
import type { HeadcountArea, HeadcountEmployee, Allocation, AllocStatus } from "@/hooks/useHeadcount";

/** Rows that label a block or a total rather than naming a person. */
const NOT_A_NAME = /^(total|totals|total staff.*|absence[s]?|holiday[s]?|overtime|support|production|off|—|-)$/i;

/** Blocks written under the columns, in the order the factory's sheet has them. */
const STATUS_BLOCKS: { label: string; status: AllocStatus }[] = [
  { label: "Absence", status: "absence" },
  { label: "Holidays", status: "holiday" },
  { label: "Overtime", status: "overtime" },
];

export interface SheetDay {
  /** yyyy-mm-dd */
  date: string;
  shift: string;
}

export interface ImportedAllocation {
  date: string;
  shift: string;
  employeeId: string;
  areaId: string | null;
  status: AllocStatus;
}

export interface ImportPreview {
  matched: ImportedAllocation[];
  /** Names the sheet had that no employee answers to. */
  unmatchedNames: { name: string; column: string; date: string }[];
  /** Column headings that are not an area on the board. */
  unknownColumns: string[];
  /** Sheets whose tab name is not a date we can read. */
  skippedSheets: string[];
  days: string[];
}

/** `Line 5 (A&B)` and `line 5` both mean Line 5. */
function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A tab name back into a date.
 *
 * The factory names tabs after the day — "04.08", "Mon 04/08", "4 Aug". A tab we
 * cannot read is reported rather than guessed at, because writing a day's allocation
 * onto the wrong date is worse than not writing it.
 */
export function parseSheetDate(name: string, fallbackYear: number): string | null {
  const cleaned = name.trim();
  // ISO first, and not by preference: `2026-08-04` contains `26-08-04`, which the
  // day-first pattern below reads as the 26th of August 2004.
  const iso = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  const dmy = cleaned.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    let y = dmy[3] ? Number(dmy[3]) : fallbackYear;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

/**
 * The board for a range of days, one sheet per day, in the factory's own layout.
 *
 * Production areas are the columns with names stacked underneath, then a Total row,
 * then the support areas, then Absence / Holidays / Overtime, then the headcount the
 * sheet is actually for. It is written to be recognised, not to be elegant: this is
 * the shape people already read every morning.
 */
export function buildHeadcountWorkbook(input: {
  days: SheetDay[];
  areas: HeadcountArea[];
  employeeById: Map<string, HeadcountEmployee>;
  allocationsFor: (date: string, shift: string) => Allocation[];
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const production = input.areas.filter((a) => a.kind === "production");
  const support = input.areas.filter((a) => a.kind !== "production");

  for (const day of input.days) {
    const allocs = input.allocationsFor(day.date, day.shift);
    const nameOf = (id: string) => input.employeeById.get(id)?.full_name ?? "";

    const working = allocs.filter((a) => a.status === "assigned" || a.status === "overtime");
    const inArea = (areaId: string) =>
      working.filter((a) => a.area_id === areaId).map((a) => nameOf(a.employee_id)).filter(Boolean).sort();

    const rows: (string | number)[][] = [];
    const block = (areas: HeadcountArea[], heading: string) => {
      if (areas.length === 0) return;
      rows.push([heading]);
      rows.push(areas.map((a) => a.name));
      const cols = areas.map((a) => inArea(a.id));
      const depth = Math.max(0, ...cols.map((c) => c.length));
      for (let i = 0; i < depth; i++) rows.push(cols.map((c) => c[i] ?? ""));
      rows.push(cols.map((c) => c.length));
      rows.push([]);
    };

    rows.push([`${day.shift} shift — ${day.date}`]);
    rows.push([]);
    block(production, "PRODUCTION");
    block(support, "SUPPORT");

    for (const b of STATUS_BLOCKS) {
      const names = allocs.filter((a) => a.status === b.status).map((a) => nameOf(a.employee_id)).filter(Boolean).sort();
      rows.push([b.label, ...names]);
    }
    rows.push([]);
    // The number the sheet exists to carry: everyone standing on a production area.
    rows.push(["Total staff in Production", production.reduce((n, a) => n + inArea(a.id).length, 0)]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // A tab name Excel accepts: 31 characters, none of : \ / ? * [ ]
    const tab = `${day.date} ${day.shift}`.slice(0, 31).replace(/[:\\/?*[\]]/g, "-");
    XLSX.utils.book_append_sheet(wb, ws, tab);
  }

  return wb;
}

/**
 * The same layout, read back.
 *
 * Matching is deliberately timid. A full name that appears once wins; a first name
 * wins only when exactly one person on that shift answers to it. Anything ambiguous
 * or misspelled is handed back in `unmatchedNames` for a human to settle — guessing
 * would put somebody on a line they were never on, and the board would look correct
 * while being wrong, which is the failure that costs the most to find later.
 */
export function parseHeadcountWorkbook(
  wb: XLSX.WorkBook,
  ctx: { areas: HeadcountArea[]; roster: HeadcountEmployee[]; shift: string; fallbackYear: number },
): ImportPreview {
  const areaByName = new Map(ctx.areas.map((a) => [normalise(a.name), a]));

  const byFull = new Map<string, HeadcountEmployee[]>();
  const byFirst = new Map<string, HeadcountEmployee[]>();
  for (const e of ctx.roster) {
    const full = normalise(e.full_name);
    const first = full.split(" ")[0];
    if (!byFull.has(full)) byFull.set(full, []);
    byFull.get(full)!.push(e);
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first)!.push(e);
  }
  const resolve = (raw: string): HeadcountEmployee | null => {
    const n = normalise(raw);
    if (!n) return null;
    const full = byFull.get(n);
    if (full?.length === 1) return full[0];
    if (full && full.length > 1) return null;
    const first = byFirst.get(n);
    if (first?.length === 1) return first[0];
    return null;
  };

  const out: ImportPreview = {
    matched: [], unmatchedNames: [], unknownColumns: [], skippedSheets: [], days: [],
  };
  const seen = new Set<string>();
  const unknown = new Set<string>();

  for (const tab of wb.SheetNames) {
    const date = parseSheetDate(tab, ctx.fallbackYear);
    if (!date) { out.skippedSheets.push(tab); continue; }
    if (!out.days.includes(date)) out.days.push(date);

    const grid = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[tab], { header: 1, blankrows: true });

    // Columns are claimed by the nearest heading row above them, so the same sheet
    // can carry a production block and a support block without them bleeding together.
    let columns: (HeadcountArea | null)[] = [];
    for (const rawRow of grid) {
      const row = (rawRow ?? []).map((c) => String(c ?? "").trim());
      if (row.every((c) => !c)) { columns = []; continue; }

      const asAreas = row.map((c) => (c ? areaByName.get(normalise(c)) ?? null : null));
      const hits = asAreas.filter(Boolean).length;
      // A heading row is one where most of the filled cells name an area.
      const filled = row.filter(Boolean).length;
      if (filled > 0 && hits >= Math.max(1, Math.ceil(filled / 2))) {
        columns = asAreas;
        row.forEach((c, i) => { if (c && !asAreas[i]) unknown.add(c); });
        continue;
      }

      const first = row[0] ?? "";
      const statusBlock = STATUS_BLOCKS.find((b) => normalise(b.label) === normalise(first));
      if (statusBlock) {
        for (const cell of row.slice(1)) {
          if (!cell || NOT_A_NAME.test(cell)) continue;
          const emp = resolve(cell);
          if (!emp) { out.unmatchedNames.push({ name: cell, column: statusBlock.label, date }); continue; }
          const key = `${date}|${emp.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.matched.push({ date, shift: ctx.shift, employeeId: emp.id, areaId: null, status: statusBlock.status });
        }
        continue;
      }

      if (columns.length === 0) continue;
      row.forEach((cell, i) => {
        const area = columns[i];
        if (!area || !cell || NOT_A_NAME.test(cell)) return;
        // A count row under a column is a number, not somebody called "7".
        if (/^\d+$/.test(cell)) return;
        const emp = resolve(cell);
        if (!emp) { out.unmatchedNames.push({ name: cell, column: area.name, date }); return; }
        const key = `${date}|${emp.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.matched.push({ date, shift: ctx.shift, employeeId: emp.id, areaId: area.id, status: "assigned" });
      });
    }
  }

  out.unknownColumns = [...unknown];
  return out;
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
