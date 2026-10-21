/**
 * Sorting, filtering and consistency checks for employee lists, as pure functions.
 *
 * Two screens list employees — User Management → Employees (the logins) and
 * Workforce → Employee (the records) — and both have to answer the same questions the
 * same way: A–Z by default, Z–A on request, department and shift as filters, and a
 * missing value shown as missing rather than hidden. Doing it here once keeps them from
 * drifting apart.
 *
 * The SHIFT shown anywhere is `employees.shift_group`. `profiles.shift` only knows Day and
 * Night; the record knows Weekend, Warehouse Day and Warehouse Weekend as well, and the
 * overtime rules read the record. A login's own `shift` is never shown as if it were the
 * person's shift.
 */

/** The filter value that means "nothing recorded". Never a real department or shift. */
export const NOT_SET = "__not_set__";
export const ALL = "__all__";

export type SortDirection = "asc" | "desc";

export interface DirectoryFilters {
  /** Free text: name, login, badge, department, shift. */
  q?: string;
  /** A department, `NOT_SET`, or `ALL`/undefined for no filter. */
  department?: string;
  shift?: string;
  /** A production line / board area id, `NOT_SET`, or no filter. */
  line?: string;
}

export interface DirectoryRow {
  name: string;
  department: string | null;
  shift: string | null;
  lineId?: string | null;
  /** Extra words the search should also look at (email, badge, position…). */
  extra?: readonly (string | null | undefined)[];
}

/** Lower-case, accent-free, single-spaced: "João  SILVA" and "joao silva" compare equal. */
export function normaliseName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/** A–Z order that ignores case and accents; ties fall back to the exact text so it is stable. */
export function compareNames(a: string | null | undefined, b: string | null | undefined): number {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (x < y) return -1;
  if (x > y) return 1;
  return (a ?? "").localeCompare(b ?? "");
}

/** A new array, sorted by name in the direction asked. The input is never touched. */
export function sortByName<T extends { name: string }>(rows: readonly T[], direction: SortDirection = "asc"): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * compareNames(a.name, b.name));
}

const isBlank = (value: string | null | undefined) => (value ?? "").trim() === "";

/**
 * Every filter at once. Each one narrows; none resets another. A value filter matches the
 * exact text; `NOT_SET` matches exactly the rows with nothing recorded.
 */
export function filterDirectory<T extends DirectoryRow>(rows: readonly T[], f: DirectoryFilters): T[] {
  const term = normaliseName(f.q);
  const matchValue = (filter: string | undefined, value: string | null | undefined) => {
    if (!filter || filter === ALL) return true;
    if (filter === NOT_SET) return isBlank(value);
    return (value ?? "").trim() === filter;
  };
  return rows.filter((row) => {
    if (!matchValue(f.department, row.department)) return false;
    if (!matchValue(f.shift, row.shift)) return false;
    if (!matchValue(f.line, row.lineId)) return false;
    if (!term) return true;
    return [row.name, row.department, row.shift, ...(row.extra ?? [])]
      .some((v) => normaliseName(v).includes(term));
  });
}

export interface FilterOption { value: string; label: string; count: number }

/**
 * The choices for a filter: the values that exist, A–Z, then "Not set" last and only when
 * somebody really is missing one — so the person can find the gaps in one click.
 */
export function filterOptions(values: readonly (string | null | undefined)[], notSetLabel = "Not set"): FilterOption[] {
  const counts = new Map<string, number>();
  let missing = 0;
  for (const raw of values) {
    if (isBlank(raw)) { missing += 1; continue; }
    const v = raw!.trim();
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const options = [...counts.entries()]
    .sort(([a], [b]) => compareNames(a, b))
    .map(([value, count]) => ({ value, label: value, count }));
  if (missing > 0) options.push({ value: NOT_SET, label: notSetLabel, count: missing });
  return options;
}

/** One page of a list, with a page number that can never point past the end. */
export function paginate<T>(rows: readonly T[], page: number, size: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / Math.max(1, size)));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { rows: rows.slice(current * size, current * size + size), page: current, pages };
}

/* ─────────────────── does the shift agree with the rota? ─────────────────── */

export interface PatternHours { starts_at?: string | null; ends_at?: string | null }

const minutes = (t: string | null | undefined): number | null => {
  const m = /^(\d{2}):(\d{2})/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Whether a rota's hours can belong to a shift group. Only the clear contradictions are
 * reported — a Night person on a rota that starts at 06:00 and ends at 18:00, or a Day
 * person on one that crosses midnight. Weekend and Warehouse crews keep their own hours,
 * so they are never second-guessed, and a rota with no hours says nothing.
 *
 * Returns a sentence for a person to read, or null when there is nothing to flag. It is
 * a flag for review: nothing is changed because of it.
 */
export function shiftPatternConflict(shiftGroup: string | null | undefined, pattern: PatternHours | null | undefined): string | null {
  const start = minutes(pattern?.starts_at);
  const end = minutes(pattern?.ends_at);
  if (!shiftGroup || start === null || end === null) return null;
  const overnight = end <= start;
  if (shiftGroup === "Night" && !overnight) {
    return "Night shift, but this rota starts and ends in the same day. Check the shift or the rota.";
  }
  if (shiftGroup === "Day" && overnight) {
    return "Day shift, but this rota runs past midnight. Check the shift or the rota.";
  }
  return null;
}
