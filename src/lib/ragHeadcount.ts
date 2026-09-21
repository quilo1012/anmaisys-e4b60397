/**
 * The SharePoint headcount, reduced to the few figures the RAG Weekly board shows
 * beside its volumes.
 *
 * Deliberately local to this block. Nothing here touches the RAG line mapping or the
 * Headcount board's own importer: the area labels are passed through exactly as the
 * workbook writes them ("Line 5 (A&B)", "Pill line", "WH team"), and only a display
 * name is trimmed for the column head.
 *
 * Planned and actual: the workbook says who was put on the sheet for a day and shift
 * (planned), and separately who was away — absence and holidays (so actual is the
 * sheet minus the people who did not come in). Those are the two figures the board
 * puts side by side; no third source is consulted.
 */

export interface HeadcountApiCounts {
  production?: Record<string, number> | null;
  support?: Record<string, number> | null;
  production_assigned?: number | null;
  support_assigned?: number | null;
  total_staff_calculated?: number | null;
  total_staff_in_production?: number | null;
  absence?: number | null;
  holidays?: number | null;
  overtime_staff?: number | null;
  blender_team?: number | null;
}

export interface HeadcountDayShift {
  /** Area label → staff standing on it, exactly as the workbook names the area. */
  production: Record<string, number>;
  support: Record<string, number>;
  productionStaff: number;
  supportStaff: number;
  /** Everybody written onto the sheet for this day and shift. */
  planned: number;
  absence: number;
  holidays: number;
  overtime: number;
  /** Planned, minus the people recorded as away. Never below zero. */
  actual: number;
  sheet: string | null;
  sourceFile: string | null;
  sourceModified: string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const countsOf = (block: Record<string, unknown> | null | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [label, value] of Object.entries(block ?? {})) {
    if (!String(label).trim()) continue;
    out[String(label)] = Array.isArray(value) ? value.length : num(value);
  }
  return out;
};

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

/**
 * One day and shift of the reader's answer, as the block reads it.
 *
 * The `counts` object is preferred where it exists, because it is the workbook's own
 * arithmetic; the name lists are the fallback, so a response without counts still
 * gives a real figure rather than a zero.
 */
export function summariseHeadcountDay(res: {
  counts?: HeadcountApiCounts | null;
  production?: Record<string, unknown> | null;
  support?: Record<string, unknown> | null;
  absence?: unknown[] | number | null;
  holidays?: unknown[] | number | null;
  overtime_staff?: unknown[] | number | null;
  sheet?: string | null;
  source_file?: string | null;
  source_modified?: string | null;
} | null | undefined): HeadcountDayShift {
  const c = res?.counts ?? {};
  const production = Object.keys(c.production ?? {}).length
    ? countsOf(c.production as Record<string, unknown>)
    : countsOf(res?.production);
  const support = Object.keys(c.support ?? {}).length
    ? countsOf(c.support as Record<string, unknown>)
    : countsOf(res?.support);

  const listOrCount = (v: unknown[] | number | null | undefined, fromCounts: number | null | undefined) =>
    fromCounts != null ? num(fromCounts) : Array.isArray(v) ? v.length : num(v);

  const productionStaff = c.production_assigned != null ? num(c.production_assigned) : sum(production);
  const supportStaff = c.support_assigned != null ? num(c.support_assigned) : sum(support);
  const planned =
    c.total_staff_calculated != null ? num(c.total_staff_calculated) : productionStaff + supportStaff;

  const absence = listOrCount(res?.absence, c.absence);
  const holidays = listOrCount(res?.holidays, c.holidays);
  const overtime = listOrCount(res?.overtime_staff, c.overtime_staff);

  return {
    production,
    support,
    productionStaff,
    supportStaff,
    planned,
    absence,
    holidays,
    overtime,
    actual: Math.max(0, planned - absence - holidays),
    sheet: res?.sheet ?? null,
    sourceFile: res?.source_file ?? null,
    sourceModified: res?.source_modified ?? null,
  };
}

/** The column head for an area: the workbook's label, without its bracketed note. */
export function headcountAreaLabel(area: string): string {
  return String(area).replace(/\s*\([^)]*\)\s*$/, "").trim() || String(area);
}

/** Every area seen across the week, production first, each in the order the file gives. */
export function headcountAreas(days: HeadcountDayShift[]): { production: string[]; support: string[] } {
  const production: string[] = [];
  const support: string[] = [];
  for (const d of days) {
    for (const a of Object.keys(d.production)) if (!production.includes(a)) production.push(a);
    for (const a of Object.keys(d.support)) if (!support.includes(a)) support.push(a);
  }
  return { production, support };
}
