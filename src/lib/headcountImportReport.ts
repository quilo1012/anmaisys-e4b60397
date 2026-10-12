import { parseSheetDate, type ImportPreview } from "@/lib/headcountSheet";

export type BoardShift = "Day" | "Night";

/**
 * One board on one date, as an import is about to leave it.
 *
 * The import writes one board per run — the factory keeps the day and the night in two
 * different workbooks, and the tabs of both are just dates. On 12/10/2026 the Day sheet
 * for 13, 14 and 15/10 went in and the Night board for those dates stayed empty, and
 * nothing on the screen said the night had not been part of it. So every date the file
 * touches is reported for *both* boards: what is written, what is held back and why,
 * and — for the board this run does not write — that it is not written.
 */
export interface ImportReportLine {
  /** yyyy-mm-dd, or null for a tab whose date could not be read. */
  date: string | null;
  shift: BoardShift;
  /** Rows this run writes onto that board and date. */
  written: number;
  /** Names on that date that are not written. */
  skipped: number;
  /** Why, in words — empty when everything on that date goes in. */
  reasons: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function importReport(
  preview: ImportPreview,
  target: BoardShift,
  fallbackYear: number,
): ImportReportLine[] {
  const other: BoardShift = target === "Day" ? "Night" : "Day";
  const lines: ImportReportLine[] = [];

  // Tabs that say they are the other board, by the date they carry.
  const otherTabs = new Map<string, string[]>();
  for (const tab of preview.otherShiftSheets) {
    const d = parseSheetDate(tab, fallbackYear);
    if (!d) continue;
    otherTabs.set(d, [...(otherTabs.get(d) ?? []), tab]);
  }

  const dates = [...new Set([...preview.days, ...otherTabs.keys()])].sort();
  for (const date of dates) {
    if (preview.days.includes(date)) {
      const written = preview.matched.filter((m) => m.date === date).length;
      const unmatched = preview.unmatchedNames.filter((u) => u.date === date);
      const otherCrew = unmatched.filter((u) => u.reason === "otherShift").length;
      const unnamed = unmatched.length - otherCrew;
      const conflicts = preview.conflicts.filter((c) => c.date === date).length;
      const reasons: string[] = [];
      if (unnamed) reasons.push(`${plural(unnamed, "name", "names")} nobody on the payroll answers to`);
      if (otherCrew) reasons.push(`${plural(otherCrew, "name", "names")} only matching someone on the ${other} crew`);
      if (conflicts) reasons.push(`${plural(conflicts, "person", "people")} written two ways — choose a spelling`);
      if (written === 0 && unmatched.length === 0 && conflicts === 0) {
        reasons.push("the tab has no names under a row of area headings");
      }
      lines.push({ date, shift: target, written, skipped: unnamed + otherCrew + conflicts, reasons });
    }

    const tabs = otherTabs.get(date);
    lines.push({
      date,
      shift: other,
      written: 0,
      skipped: 0,
      reasons: [
        tabs
          ? `tab ${tabs.map((t) => `“${t}”`).join(", ")} is for the ${other} board — switch the target to ${other} to import it`
          : `not in this file — the ${other} board is imported from its own sheet`,
      ],
    });
  }

  for (const tab of preview.skippedSheets) {
    lines.push({
      date: null,
      shift: target,
      written: 0,
      skipped: 0,
      reasons: [`tab “${tab}” has no date that can be read, so it is not imported`],
    });
  }

  return lines;
}

/** "13.10" — how the factory writes a date on a tab. */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/** The dates in a report that this run leaves the other board without. */
export function otherBoardLeftOut(lines: ImportReportLine[], target: BoardShift): string[] {
  const other: BoardShift = target === "Day" ? "Night" : "Day";
  return lines.filter((l) => l.shift === other && l.date).map((l) => l.date!);
}

/**
 * Whether a board should say out loud that it was never filled.
 *
 * An empty board on a date the rota has people due reads exactly like a night when
 * nobody came in, and "0 / 64 on the rota" in small grey type is how three nights went
 * unnoticed. Only when the rota expects somebody, and only once both reads are in, so a
 * board that is still loading does not flash the warning.
 */
export function boardNotImported(input: {
  loading: boolean;
  allocations: number;
  dueOnRota: number;
}): boolean {
  return !input.loading && input.allocations === 0 && input.dueOnRota > 0;
}
