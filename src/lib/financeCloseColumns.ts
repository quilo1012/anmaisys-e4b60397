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
 * `earlyLeaveHours` gets a band of its own rather than being folded in with the clocked
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
}

export const CLOSE_COLUMNS: CloseColumn[] = [
  { key: "name", header: "Employee", band: "who", align: "left", value: (r) => r.name, mm: 34, wch: 26 },
  { key: "shift", header: "Shift", band: "who", align: "left", value: (r) => r.shift, mm: 17, wch: 16 },
  { key: "department", header: "Department", band: "who", align: "left", value: (r) => r.department, mm: 21, wch: 16 },

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

  { key: "earlyLeaveHours", header: "Left early (h)", band: "boardHours", align: "right", value: (r) => r.earlyLeaveHours, mm: 14, wch: 12, dashWhenZero: true },
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
