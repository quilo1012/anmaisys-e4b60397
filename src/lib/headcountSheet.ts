import * as XLSX from "xlsx";
import { keepsLeadership } from "@/lib/leaderMark";
import { statusForPlacement, type RotaCover } from "@/lib/rotaStatus";
import { boardShiftFor } from "@/hooks/useHeadcount";
import type { HeadcountArea, HeadcountEmployee, Allocation, AllocStatus } from "@/hooks/useHeadcount";

/** Rows that label a block or a total rather than naming a person. */
const NOT_A_NAME = /^(total|totals|total staff.*|absence[s]?|holiday[s]?|overtime|support|production|off|—|-)$/i;

/**
 * Blocks written under the columns, in the order the factory's sheet has them.
 *
 * `also` is what the company spreadsheet heads the same block with. Its overtime
 * column says "Overtime staff", which did not equal "Overtime" and so was read as a
 * column nobody claimed — everybody working an overtime day was dropped in silence.
 */
const STATUS_BLOCKS: { label: string; status: AllocStatus; also?: string[] }[] = [
  { label: "Sickness", status: "sick", also: ["Sick", "Sickness absence"] },
  { label: "Unpaid", status: "unpaid", also: ["Unpaid leave", "Unpaid Leave"] },
  { label: "Holidays", status: "holiday", also: ["Holiday", "Annual leave"] },
  { label: "Overtime", status: "overtime", also: ["Overtime staff", "OT"] },
];

/**
 * The company sheet's single away column.
 *
 * It has one "Absence" and the board has two answers — Sickness and Unpaid — and
 * which one a name belongs under is a payroll fact, not something to pick quietly.
 * So the column is recognised and reported, and the names under it are written only
 * once the office says what it means (`absenceAs`).
 */
const ABSENCE_LABELS = ["Absence", "Absences", "Absent"];

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

/** A name on the sheet that was not written to the board, and why. */
export interface UnmatchedName {
  name: string;
  column: string;
  date: string;
  /** `ambiguous`: more than one person answers to it. `unknown`: nobody does. */
  reason: "ambiguous" | "unknown";
  /** Who it could be, for the picker. Empty when nobody on the payroll answers to it. */
  candidates: { id: string; full_name: string }[];
}

export interface ImportPreview {
  matched: ImportedAllocation[];
  /** Names the sheet had that no employee answers to. */
  unmatchedNames: UnmatchedName[];
  /** Column headings that are not an area on the board. */
  unknownColumns: string[];
  /** Sheets whose tab name is not a date we can read. */
  skippedSheets: string[];
  days: string[];
  /**
   * Whether the sheet has an Absence column. True with no `absenceAs` given means
   * names were held back waiting for an answer, not that there were none.
   */
  absenceColumnFound: boolean;
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
  // Blocks follow `section`, the same rule the board draws by, so the sheet and the
  // screen cannot disagree about where Hygiene sits. The totals below still count by
  // `kind` — that is the other question, and the answer to it did not change.
  const block = (a: HeadcountArea) => {
    const sec = (a.section ?? "").toLowerCase();
    // Sectors — hygiene, quality, maintenance, the warehouse — print with support on
    // the company's sheet, which has two bands and not three. The screen shows them
    // apart because that is the question a supervisor asks; the sheet keeps its own
    // shape so an export still reads back the way it always did.
    if (sec === "production") return "production";
    if (sec === "sectors" || sec === "support") return "support";
    return a.kind === "production" ? "production" : "support";
  };

  /**
   * The columns the company's own sheet has, built from the data rather than a list
   * in this file.
   *
   * `sheet_label` renames one — the system says "Line 5", the sheet says
   * "Line 5 (A&B)". `sheet_group` merges several into one: Capsules Machine 1 and 2
   * are two areas on the board and a single "Pill line" column on the sheet.
   *
   * Anything with neither keeps its own name and still gets a column. That is the
   * point of doing it this way: a hard-coded column list would have dropped Gel Line
   * for being empty today and silently lost whoever is put there tomorrow.
   */
  const columnsOf = (areas: HeadcountArea[]) => {
    const cols: { label: string; areas: HeadcountArea[] }[] = [];
    for (const a of areas) {
      const label = (a.sheet_group ?? a.sheet_label ?? a.name).trim();
      const existing = cols.find((c) => c.label === label);
      if (existing) existing.areas.push(a);
      else cols.push({ label, areas: [a] });
    }
    return cols;
  };

  const production = columnsOf(input.areas.filter((a) => block(a) === "production"));
  const support = columnsOf(input.areas.filter((a) => block(a) !== "production"));

  for (const day of input.days) {
    const allocs = input.allocationsFor(day.date, day.shift);
    const nameOf = (id: string) => input.employeeById.get(id)?.full_name ?? "";

    const working = allocs.filter((a) => a.status === "assigned" || a.status === "overtime");
    const inColumn = (col: { areas: HeadcountArea[] }) => {
      const ids = new Set(col.areas.map((a) => a.id));
      return working.filter((a) => a.area_id && ids.has(a.area_id))
        .map((a) => nameOf(a.employee_id)).filter(Boolean).sort();
    };

    const rows: (string | number)[][] = [];
    const band = (cols: { label: string; areas: HeadcountArea[] }[], heading: string, extra: [string, string[]][] = []) => {
      if (cols.length === 0 && extra.length === 0) return 0;
      rows.push([heading]);
      // The away states are columns beside the areas, the way the sheet has them —
      // a name under "Absence" reads the same as a name under "Line 1".
      const labels = [...cols.map((c) => c.label), ...extra.map(([l]) => l)];
      const lists = [...cols.map(inColumn), ...extra.map(([, names]) => names)];
      rows.push(labels);
      const depth = Math.max(0, ...lists.map((c) => c.length));
      for (let i = 0; i < depth; i++) rows.push(lists.map((c) => c[i] ?? ""));
      rows.push(lists.map((c) => c.length));
      rows.push([]);
      // Only the area columns count towards the band subtotal; the states are people
      // who are not there.
      return cols.reduce((n, c) => n + inColumn(c).length, 0);
    };

    rows.push([`${day.shift} shift — ${day.date}`]);
    rows.push([]);
    const states: [string, string[]][] = STATUS_BLOCKS.map((b) => [
      b.label,
      allocs.filter((a) => a.status === b.status).map((a) => nameOf(a.employee_id)).filter(Boolean).sort(),
    ]);
    const inProduction = band(production, "PRODUCTION", states);
    const inSupport = band(support, "SUPPORT");
    rows.push([]);
    // The number the sheet exists to carry: everyone standing on a production area.
    // Three numbers, because two definitions of "in production" are in use and this
    // sheet is not the place to pick a winner quietly.
    //
    // The system counts `kind = production` — the lines and the machines, which for
    // 04/08 is 39. The company sheet's own definition sums both printed bands, which
    // is 60. They differ by Hygiene, Quality and Runner: support people who print in
    // the production band. Both are stated, and the total is spelled out so nobody
    // has to work out which one a figure came from.
    const byKind = input.areas
      .filter((a) => a.kind === "production")
      .reduce((n, a) => n + inColumn({ areas: [a] }).length, 0);
    rows.push(["On production lines (system: kind = production)", byKind]);
    rows.push(["In the production band on this sheet", inProduction]);
    rows.push(["In the support band on this sheet", inSupport]);
    rows.push(["Total staff in Production (both bands)", inProduction + inSupport]);

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
 * Matching is deliberately timid, and stays that way: it never picks between two
 * people who both answer to a name. What changed is how much it can settle without
 * picking. Measured against `Production Headcount August.xlsx`, the company's own
 * sheet for four days in August, the old rule matched 188 names and dropped 61 —
 * a quarter of the factory, every month, placed again by hand.
 *
 * The four things those 61 were:
 *
 * 1. **Written short.** "RICARDO F", "LUIS FERN", "Aleks", "KAROL", "ANDERSON C".
 *    Each is a prefix of exactly one person on the payroll, so each is now taken.
 * 2. **A first name two people share.** "Lucas" under Office is Lucas Duarte and
 *    cannot be Lucas Gloor, because the column has a department and so does he. That
 *    is not a guess; where the column does not settle it, it is still refused.
 * 3. **Spelled the way the line spells it.** "LUCAS GLOR", "Crsitiano", "GYOVANI",
 *    "Gimenez". No rule should guess at a typo. It is written on the person once,
 *    in `sheet_aliases`, and read from there after.
 * 4. **Not on this board at all.** Quality and Maintenance are on the night crew and
 *    on the day sheet both; "Toni" and "Ismael" could never match while the roster
 *    held one board. The caller now hands over everybody, and a name two boards share
 *    goes to the one the sheet is for.
 *
 * `assigned` is the last word — what somebody chose on screen, keyed by the name as
 * the sheet spells it. Same shape, and for the same reason, as `matchNames` in
 * `timeMotoSheet`.
 */
export function parseHeadcountWorkbook(
  wb: XLSX.WorkBook,
  ctx: {
    areas: HeadcountArea[];
    /**
     * Everybody, not only this board's crew. A name that belongs to both boards is
     * resolved to this one; a name only the other board has still lands, which is the
     * point — the factory's day sheet carries night-crew Quality and Maintenance.
     */
    roster: HeadcountEmployee[];
    shift: string;
    fallbackYear: number;
    /** Names settled on screen: the spelling on the sheet, to an employee id. */
    assigned?: Record<string, string>;
    /** What this sheet's single Absence column means. Unset holds those names back. */
    absenceAs?: AllocStatus;
  },
): ImportPreview {
  /**
   * Every name a column can go by, back to the area it means.
   *
   * All three, because the exporter writes whichever of them the area carries and
   * this has to read its own output back. `sheet_group` was the one missing: the
   * exporter merges Capsules Machine 1 and 2 into a single "Pill line" column, and
   * with only `name` in this map that column came back as unknown and everybody
   * standing in it was dropped — 47 people over the month this was found.
   *
   * A grouped column resolves to the first of its areas. The sheet does not say which
   * machine somebody was on, so this is the honest half of the answer: the right
   * column, and a placement inside it that takes one drag to correct.
   *
   * `sheet_label` takes a comma-separated list, because one area can be written
   * several ways across the same workbook. The Blender Room is "Assembly" on most
   * days, "Blender Team" on others and "Blender Room" on the rest — three columns for
   * one place. Without the list, two of the three come back as unknown columns and
   * everybody in them has to be placed again by hand.
   */
  const areaByName = new Map<string, HeadcountArea>();
  for (const a of ctx.areas) {
    for (const key of [a.name, a.sheet_label, a.sheet_group]) {
      if (!key) continue;
      for (const part of String(key).split(",")) {
        const k = normalise(part);
        if (k && !areaByName.has(k)) areaByName.set(k, a);
      }
    }
  }

  const push = (m: Map<string, HeadcountEmployee[]>, k: string, e: HeadcountEmployee) => {
    if (!k) return;
    const list = m.get(k) ?? [];
    if (!list.includes(e)) list.push(e);
    m.set(k, list);
  };

  const byAlias = new Map<string, HeadcountEmployee[]>();
  const byFull = new Map<string, HeadcountEmployee[]>();
  const byFirst = new Map<string, HeadcountEmployee[]>();
  const tokensOf = new Map<string, string[]>();
  for (const e of ctx.roster) {
    const full = normalise(e.full_name);
    const parts = full.split(" ").filter(Boolean);
    tokensOf.set(e.id, parts);
    push(byFull, full, e);
    push(byFirst, parts[0] ?? "", e);
    for (const a of String(e.sheet_aliases ?? "").split(",")) push(byAlias, normalise(a), e);
  }

  /**
   * "RICARDO F" is Ricardo Fernandes and cannot be Ricardo Marques.
   *
   * Either way round, because the sheet abbreviates and so does the payroll: the sheet
   * writes "LUIS FERN" for a man the payroll has as "Luis F".
   */
  const startsEitherWay = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
  const byPrefix = (parts: string[]) => ctx.roster.filter((e) => {
    const rt = tokensOf.get(e.id) ?? [];
    return rt.length >= parts.length && parts.every((x, i) => startsEitherWay(rt[i], x));
  });

  /**
   * Two people answer to the name; the column may already know which.
   *
   * The board first — the sheet is one shift, and a Day name is a Day person when
   * both boards have one. Then the department: an Office column and an Office job is
   * the same fact written twice, not a coin toss. Either filter is skipped when it
   * would leave nobody, because narrowing to nothing is how a real person disappears.
   */
  const narrow = (list: HeadcountEmployee[], area: HeadcountArea | null) => {
    let c = list;
    const onBoard = c.filter((e) => boardShiftFor(e.shift_group) === ctx.shift);
    if (onBoard.length) c = onBoard;
    if (c.length > 1 && area?.department) {
      const sameJob = c.filter((e) => e.department === area.department);
      if (sameJob.length) c = sameJob;
    }
    return c;
  };

  type Resolved =
    | { emp: HeadcountEmployee }
    | { reason: "ambiguous" | "unknown"; candidates: HeadcountEmployee[] };

  const resolve = (raw: string, area: HeadcountArea | null): Resolved => {
    const n = normalise(raw);
    if (!n) return { reason: "unknown", candidates: [] };
    const settled = ctx.assigned?.[raw.trim()] ?? ctx.assigned?.[n];
    if (settled) {
      const chosen = ctx.roster.find((e) => e.id === settled);
      if (chosen) return { emp: chosen };
    }
    // Exact before short: "Andre" is the two Andres, and must not also drag in
    // Andreia for starting with the same five letters.
    for (const step of [byAlias.get(n), byFull.get(n), byFirst.get(n), byPrefix(n.split(" "))]) {
      if (!step?.length) continue;
      const c = narrow(step, area);
      return c.length === 1 ? { emp: c[0] } : { reason: "ambiguous", candidates: c };
    }
    return { reason: "unknown", candidates: [] };
  };

  const out: ImportPreview = {
    matched: [], unmatchedNames: [], unknownColumns: [], skippedSheets: [], days: [],
    absenceColumnFound: false,
  };
  const seen = new Set<string>();
  const unknown = new Set<string>();

  /** A heading, as this sheet writes it, to what it means. */
  const headingOf = (cell: string) => {
    const k = normalise(cell);
    const area = areaByName.get(k);
    if (area) return { area } as const;
    const st = STATUS_BLOCKS.find((b) =>
      [b.label, ...(b.also ?? [])].some((l) => normalise(l) === k));
    if (st) return { status: st.status } as const;
    if (ABSENCE_LABELS.some((l) => normalise(l) === k)) return { absence: true } as const;
    return null;
  };

  for (const tab of wb.SheetNames) {
    const date = parseSheetDate(tab, ctx.fallbackYear);
    if (!date) { out.skippedSheets.push(tab); continue; }
    if (!out.days.includes(date)) out.days.push(date);

    const grid = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[tab], { header: 1, blankrows: true });

    // Columns are claimed by the nearest heading row above them, so the same sheet
    // can carry a production block and a support block without them bleeding together.
    //
    // A column can be an area or one of the away states: the export prints Absence,
    // Holidays and Overtime as columns beside the lines, the way the company sheet
    // has them. Reading them only as row labels is what broke the round trip the
    // moment the export changed shape.
    type Col = ReturnType<typeof headingOf>;
    let columns: Col[] = [];

    /** One cell under one column, onto the board — or onto the list of what did not land. */
    const place = (cell: string, col: Col) => {
      if (!col || !cell || NOT_A_NAME.test(cell)) return;
      // A count row under a column is a number, not somebody called "7".
      if (/^\d+$/.test(cell)) return;
      const area = "area" in col ? col.area : null;
      const label = area ? area.name
        : "absence" in col ? ABSENCE_LABELS[0]
        : STATUS_BLOCKS.find((b) => b.status === col.status)!.label;
      // The sheet's one Absence column against the board's two answers. Until the
      // office says which, these names are held rather than filed under a guess.
      if ("absence" in col) {
        out.absenceColumnFound = true;
        if (!ctx.absenceAs) return;
      }
      const r = resolve(cell, area);
      if (!("emp" in r)) {
        out.unmatchedNames.push({
          name: cell, column: label, date, reason: r.reason,
          candidates: r.candidates.map((e) => ({ id: e.id, full_name: e.full_name })),
        });
        return;
      }
      const key = `${date}|${r.emp.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.matched.push({
        date, shift: ctx.shift, employeeId: r.emp.id,
        areaId: area ? area.id : null,
        status: area ? "assigned" : "absence" in col ? ctx.absenceAs! : col.status,
      });
    };

    for (const rawRow of grid) {
      const row = (rawRow ?? []).map((c) => String(c ?? "").trim());
      if (row.every((c) => !c)) { columns = []; continue; }

      const asCols: Col[] = row.map((c) => (c ? headingOf(c) : null));
      const hits = asCols.filter(Boolean).length;
      // A heading row is one where most of the filled cells name a column.
      const filled = row.filter(Boolean).length;
      if (filled > 0 && hits >= Math.max(1, Math.ceil(filled / 2))) {
        columns = asCols;
        row.forEach((c, i) => { if (c && !asCols[i]) unknown.add(c); });
        continue;
      }

      const first = row[0] ?? "";
      const asBlock = first ? headingOf(first) : null;
      if (asBlock && !("area" in asBlock)) {
        for (const cell of row.slice(1)) place(cell, asBlock);
        continue;
      }

      if (columns.length === 0) continue;
      row.forEach((cell, i) => place(cell, columns[i]));
    }
  }

  out.unknownColumns = [...unknown];
  return out;
}

/** One row the import is about to write. */
export interface ImportRow {
  on_date: string;
  shift: string;
  employee_id: string;
  area_id: string | null;
  status: AllocStatus;
  is_leader: boolean;
}

/** Who holds a column on a day, as the board already has it. */
export interface StandingLeader {
  on_date: string;
  shift: string;
  employee_id: string;
  area_id: string | null;
}

/**
 * What a matched sheet becomes on the board.
 *
 * Two things are decided here rather than in the dialog, because both are rules about
 * the table and neither is about the file.
 *
 * **The rota is asked for every row.** The sheet says who was in, not whether they
 * were due in, and a range import is a month of different weekdays: a Friday night
 * imported from a company sheet is nobody's rota and has to be saved as overtime, or
 * it is paid as an ordinary night.
 *
 * **The leader's mark stays with the column.** The import used to write `area_id` and
 * say nothing about `is_leader`, so a sheet that moved the leader of Line 1 onto
 * Line 5 carried the mark into a column that already had one — see `keepsLeadership`.
 * Postgres refuses the whole statement, so a month of board failed on one square.
 */
export function rowsToImport(input: {
  matched: ImportedAllocation[];
  /** The rota, asked per person per date — the board's `useRotaCover`. */
  cover: (employeeId: string, date: string, shift: string) => RotaCover;
  /** The leaders already standing on the days being written. */
  leaders: StandingLeader[];
}): ImportRow[] {
  const key = (on_date: string, shift: string, employee_id: string) =>
    `${on_date}|${shift}|${employee_id}`;
  // Per day and per board: leading Line 1 on Friday says nothing about Saturday, and
  // nothing about the night board of the same date.
  const led = new Map(
    input.leaders.map((l) => [key(l.on_date, l.shift, l.employee_id), l.area_id ?? null]),
  );

  return input.matched.map((m) => {
    const status = statusForPlacement(
      m.status,
      m.status,
      input.cover(m.employeeId, m.date, m.shift),
    );
    // Absence loses the column, exactly as a placement on the board does: they are not
    // at a place that day.
    const area_id = status === "assigned" || status === "overtime" ? m.areaId : null;
    const k = key(m.date, m.shift, m.employeeId);
    return {
      on_date: m.date,
      shift: m.shift,
      employee_id: m.employeeId,
      area_id,
      status,
      is_leader: keepsLeadership(
        led.has(k) ? { area_id: led.get(k) ?? null, is_leader: true } : null,
        { areaId: area_id, status },
      ),
    };
  });
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
