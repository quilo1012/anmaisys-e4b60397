/**
 * The one definition of the close's columns, and of the bands above them.
 *
 * The screen, the PDF and the Excel workbook all read this. They used not to: the
 * screen carried its own header markup and the exports would have carried theirs, and
 * three hand-written copies of an eighteen-column layout drift on the first change.
 *
 * THE BANDS ARE THE POINT, and the screen's were wrong. `colSpan` read 3 + 3 + 5 + 5,
 * which is sixteen columns over a table of eighteen. Everything after the tenth column
 * sat one band too far left, so PAYROLL OT AND Δ APPEARED UNDER "DAYS AWAY" — hours
 * labelled as days of absence, on the document somebody is paid from — and the last
 * two columns had no band at all.
 *
 * `partDayHours` gets a band of its own rather than being folded in with the clocked
 * hours. It is hours, so it does not belong over "Days away"; it comes from the BOARD
 * and not the clocks, so putting it under "Hours · from the clocks" would say the
 * factory has a clocked record of it, which is the whole reason it is reported
 * separately. Adding a board figure to a clocked one double-counts the same missing
 * hours the moment TimeMoto is imported.
 */

import type { ClosePerson } from "@/lib/financeClose";

export type CloseBand = "who" | "shifts" | "clockedHours" | "daysAway" | "boardHours";

/** What each band is called above the column names. `null` for the naming columns. */
export const BAND_LABELS: Record<CloseBand, string | null> = {
  who: null,
  shifts: "Shifts · from the board",
  clockedHours: "Hours · from the clocks",
  daysAway: "Days away",
  boardHours: "Hours · from the board",
};

export interface CloseColumn {
  key: string;
  header: string;
  band: CloseBand;
  align: "left" | "right";
  /**
   * The value, as data rather than as text.
   *
   * `null` means that side reported NOTHING, which is not zero — the distinction the
   * whole screen exists to preserve. A spreadsheet gets an empty cell for it and a
   * real number everywhere else, so a payroll clerk can sum the column and cannot
   * accidentally sum a dash.
   */
  value: (r: ClosePerson) => number | string | null;
  /** Column width in millimetres, for the landscape PDF. */
  mm: number;
  /** Column width in characters, for Excel. */
  wch: number;
  /**
   * Shown as a dash on screen when it is zero, purely to quieten the table.
   *
   * Only ever applied to the PDF, which is the printed screen. The spreadsheet keeps
   * the zero, because a zero owed and an unreported figure are different facts and
   * only one of them belongs in a SUM.
   */
  dashWhenZero?: boolean;
  /**
   * Printed whatever the print settings say. Only the name: a row of figures with no
   * name on it cannot be paid from, and "Clear all" must not be able to produce one.
   */
  alwaysPrinted?: boolean;
  /** Left out of the printed sheet until somebody ticks it. Still on screen and in Excel. */
  printOff?: boolean;
}

export const CLOSE_COLUMNS: CloseColumn[] = [
  { key: "name", header: "Employee", band: "who", align: "left", value: (r) => r.name, mm: 34, wch: 26, alwaysPrinted: true },
  // The badge number, beside the name: it is what tells two Ana Silvas apart on paper.
  { key: "employeeRef", header: "Emp. no.", band: "who", align: "left", value: (r) => r.employeeRef ?? null, mm: 13, wch: 10 },
  { key: "shift", header: "Shift", band: "who", align: "left", value: (r) => r.shift, mm: 17, wch: 16 },
  { key: "department", header: "Department", band: "who", align: "left", value: (r) => r.department, mm: 21, wch: 16 },
  // Where the board places them. Read from `headcount_areas`, so a line added on the
  // board appears here without a code change.
  { key: "line", header: "Line", band: "who", align: "left", value: (r) => r.lineName ?? null, mm: 19, wch: 16 },
  // The CSV always carried the rota and the screen never did. Off the paper by default
  // because it is wide and the shift beside it usually says the same.
  { key: "rota", header: "Rota", band: "who", align: "left", value: (r) => r.patternName, mm: 18, wch: 16, printOff: true },

  { key: "shiftsDue", header: "Due", band: "shifts", align: "right", value: (r) => r.shiftsDue, mm: 10, wch: 8 },
  { key: "shiftsWorked", header: "Worked", band: "shifts", align: "right", value: (r) => r.shiftsWorked, mm: 13, wch: 9 },
  { key: "shiftBalance", header: "+/−", band: "shifts", align: "right", value: (r) => r.shiftBalance, mm: 11, wch: 8 },

  { key: "openingHours", header: "Opening bank", band: "clockedHours", align: "right", value: (r) => r.openingHours, mm: 15, wch: 13 },
  { key: "clockedOtHours", header: "Period", band: "clockedHours", align: "right", value: (r) => r.clockedOtHours, mm: 13, wch: 10 },
  { key: "closingHours", header: "Closing bank", band: "clockedHours", align: "right", value: (r) => r.closingHours, mm: 15, wch: 13 },
  { key: "overtimeHours", header: "Overtime", band: "clockedHours", align: "right", value: (r) => r.overtimeHours, mm: 14, wch: 11 },
  { key: "owedHours", header: "Deducted", band: "clockedHours", align: "right", value: (r) => r.owedHours, mm: 14, wch: 11, dashWhenZero: true },
  { key: "payrollOtHours", header: "Payroll OT", band: "clockedHours", align: "right", value: (r) => r.payrollOtHours, mm: 14, wch: 11 },
  { key: "deltaHours", header: "Δ", band: "clockedHours", align: "right", value: (r) => r.deltaHours, mm: 11, wch: 9 },

  { key: "daysPresent", header: "Present", band: "daysAway", align: "right", value: (r) => r.daysPresent, mm: 13, wch: 9 },
  { key: "sick", header: "Sick", band: "daysAway", align: "right", value: (r) => r.sick, mm: 10, wch: 8, dashWhenZero: true },
  { key: "holiday", header: "Holiday", band: "daysAway", align: "right", value: (r) => r.holiday, mm: 13, wch: 9, dashWhenZero: true },
  { key: "unpaid", header: "Unpaid", band: "daysAway", align: "right", value: (r) => r.unpaid, mm: 12, wch: 9, dashWhenZero: true },
  // Every absence that is not sick, holiday or unpaid — training, compassionate, a
  // code the clocks invented. The CSV carried it; the screen and the paper dropped it,
  // so a day away of that kind was on no printed page at all.
  { key: "otherAbsence", header: "Other", band: "daysAway", align: "right", value: (r) => r.otherAbsence, mm: 11, wch: 8, dashWhenZero: true },

  { key: "partDayHours", header: "Part day (h)", band: "boardHours", align: "right", value: (r) => r.partDayHours, mm: 14, wch: 12, dashWhenZero: true },
];

export interface CloseBandSpan {
  band: CloseBand;
  label: string | null;
  /** How many columns the band covers — the number the screen used to get wrong. */
  span: number;
}

/**
 * The bands, in order, with the span each one actually covers.
 *
 * Counted off the columns rather than written down, so a column added to the middle of
 * a band cannot leave the header one short. That is exactly how the screen's `colSpan`
 * came to be two columns adrift.
 */
export function closeBandSpans(columns: CloseColumn[] = CLOSE_COLUMNS): CloseBandSpan[] {
  const spans: CloseBandSpan[] = [];
  for (const c of columns) {
    const last = spans[spans.length - 1];
    if (last && last.band === c.band) last.span += 1;
    else spans.push({ band: c.band, label: BAND_LABELS[c.band], span: 1 });
  }
  return spans;
}

/**
 * A row as a spreadsheet should hold it: numbers stay numbers, null stays null.
 *
 * No formatting, no dashes, no thousands separators. The moment an hour figure becomes
 * the string "12.00" it stops being summable, and this file's only job on the Excel
 * side is to hand payroll a column they can add up.
 */
export function closeExportValues(
  r: ClosePerson,
  columns: CloseColumn[] = CLOSE_COLUMNS,
): (number | string | null)[] {
  return columns.map((c) => c.value(r));
}

/**
 * The same row as the printed page shows it.
 *
 * A dash for anything unreported, and a dash for the zeros the screen quietens. Hours
 * carry two decimals because they are money; shifts and days are whole, because a half
 * shift is not something the board can record.
 */
export function closeDisplayValues(
  r: ClosePerson,
  columns: CloseColumn[] = CLOSE_COLUMNS,
): string[] {
  return columns.map((c) => {
    const v = c.value(r);
    if (v == null) return "—";
    if (typeof v === "string") return v || "—";
    if (v === 0 && c.dashWhenZero) return "—";
    // The shift balance is the one figure whose sign is the answer: "+2" and "2" read
    // differently to somebody deciding whether to pay.
    if (c.key === "shiftBalance") return v > 0 ? `+${v}` : String(v);
    return Number.isInteger(v) && c.band !== "clockedHours" && c.band !== "boardHours"
      ? String(v)
      : v.toFixed(2);
  });
}

/* ─── What goes on paper ──────────────────────────────────────────────────── */

/** The columns printed when nobody has chosen. */
export const DEFAULT_PRINT_KEYS: string[] = CLOSE_COLUMNS.filter((c) => !c.printOff).map((c) => c.key);

/** Every column that can be printed, i.e. all of them. "Select all". */
export const ALL_PRINT_KEYS: string[] = CLOSE_COLUMNS.map((c) => c.key);

/** "Clear all": everything but the name, which cannot be cleared. */
export const MIN_PRINT_KEYS: string[] = CLOSE_COLUMNS.filter((c) => c.alwaysPrinted).map((c) => c.key);

/**
 * The columns a selection prints, in the close's own order.
 *
 * The order is the definition's and not the order things were ticked in: the bands
 * are drawn over runs of neighbouring columns, and a column ticked out of order would
 * split "Hours · from the clocks" in two. Unknown keys (a column renamed since the
 * choice was saved) are ignored, and the name is always there.
 */
export function pickPrintColumns(keys: readonly string[]): CloseColumn[] {
  const want = new Set(keys);
  return CLOSE_COLUMNS.filter((c) => c.alwaysPrinted || want.has(c.key));
}

/** A4 portrait, less the close's 10 mm margins: what fits standing up. */
export const PORTRAIT_MM = 190;

/**
 * Which way up the paper goes for these columns.
 *
 * The widths are proportions, so anything fits on landscape; portrait is chosen only
 * when the columns' natural widths fit across it, so a narrow selection — name and the
 * hours — is printed as an ordinary page rather than a strip down a sideways one.
 */
export function printOrientation(columns: readonly CloseColumn[]): "portrait" | "landscape" {
  return columns.reduce((s, c) => s + c.mm, 0) <= PORTRAIT_MM ? "portrait" : "landscape";
}
