// `xlsx-js-style` for the same reason the rest of this feature uses it: one library.
import XLSX from "xlsx-js-style";

/**
 * The SharePoint headcount reader's answer, turned into the sheet layout the board
 * already knows how to read.
 *
 * Deliberately local to Headcount. RAG reads a different workbook through a different
 * function and maps its own line names; nothing here is shared with it, so the
 * Headcount "Tablet line" cannot move RAG's.
 *
 * The API's own column names ("Line 5 (A&B)", "Pill line", "Tablet line", "WH team",
 * "GELL ROOM") are not translated in code: they are the spellings `headcount_areas`
 * already carries in `sheet_label`, so the existing importer resolves them and a new
 * spelling is a data change rather than a release. Names are passed through exactly as
 * the file has them — "Gabriel 14:00", "WEBISTER ( training )" — and never deduplicated.
 */

export interface HeadcountApiResponse {
  date: string;
  shift: string;
  sheet?: string | null;
  source_file?: string | null;
  source_modified?: string | null;
  source_web_url?: string | null;
  source_path?: string | null;
  /** Area label → the names standing in it. */
  production?: Record<string, string[]> | null;
  support?: Record<string, string[]> | null;
  absence?: string[] | null;
  holidays?: string[] | null;
  overtime_staff?: string[] | null;
  blender_team?: string[] | null;
  counts?: Record<string, unknown> | null;
}

/** Columns written under their own heading, in the layout the importer reads. */
const AWAY_COLUMNS: { label: string; pick: (r: HeadcountApiResponse) => string[] }[] = [
  { label: "Absence", pick: (r) => r.absence ?? [] },
  { label: "Holidays", pick: (r) => r.holidays ?? [] },
  { label: "Overtime staff", pick: (r) => r.overtime_staff ?? [] },
];

/** One block of columns: a heading row, then the names under each. */
function block(columns: { label: string; names: string[] }[]): (string | number)[][] {
  const kept = columns.filter((c) => c.label.trim());
  if (!kept.length) return [];
  const depth = Math.max(...kept.map((c) => c.names.length), 0);
  const rows: (string | number)[][] = [kept.map((c) => c.label)];
  for (let i = 0; i < depth; i++) rows.push(kept.map((c) => c.names[i] ?? ""));
  return rows;
}

/**
 * The API response as a one-tab workbook: the tab is named with the date and the shift,
 * which is exactly what `parseHeadcountWorkbook` reads to decide the day and refuse the
 * other board. Nothing about the response is altered on the way through.
 */
export function headcountApiToWorkbook(res: HeadcountApiResponse): XLSX.WorkBook {
  const shift = String(res.shift ?? "").toLowerCase() === "night" ? "Night" : "Day";
  const grid: (string | number)[][] = [];

  const named = (src: Record<string, string[]> | null | undefined) =>
    Object.entries(src ?? {}).map(([label, names]) => ({
      label,
      names: (names ?? []).map((n) => String(n ?? "")).filter((n) => n.trim()),
    }));

  for (const rows of [
    block(named(res.production)),
    block(named(res.support)),
    block([
      ...AWAY_COLUMNS.map((c) => ({ label: c.label, names: c.pick(res).map(String) })),
      ...(res.blender_team?.length ? [{ label: "Blender Team", names: res.blender_team.map(String) }] : []),
    ]),
  ]) {
    if (!rows.length) continue;
    // A blank row between blocks: it is what tells the importer a heading row below
    // starts a new set of columns rather than continuing the one above.
    if (grid.length) grid.push([]);
    grid.push(...rows);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), `${res.date} ${shift}`);
  return wb;
}

/** The subtle provenance line the dialog shows under a loaded sheet. */
export function headcountApiSource(res: HeadcountApiResponse): string {
  const bits = [
    "Source: SharePoint",
    `${String(res.shift ?? "").toLowerCase() === "night" ? "Night" : "Day"} shift`,
    res.source_file ?? null,
    res.sheet ? `sheet ${res.sheet}` : null,
    res.source_modified ? `modified ${new Date(res.source_modified).toLocaleString()}` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}
