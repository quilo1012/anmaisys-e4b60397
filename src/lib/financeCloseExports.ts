/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable and xlsx-js-style cells are loosely typed */
/**
 * The close, as a PDF to hand somebody and a workbook to pay from.
 *
 * Two formats for two jobs, and they are not the same document. The PDF is the printed
 * screen: it carries the warning, the dashes and the quietened zeros, because a person
 * reads it. The workbook carries numbers and nothing else, because payroll sums it —
 * an hour figure that arrives as the string "12.00" cannot be added up, and a dash that
 * arrives as text in a numeric column silently breaks the total under it.
 *
 * Both read `CLOSE_COLUMNS`, so neither can drift from the screen or from each other,
 * and both carry only the columns ticked in the print settings.
 *
 * THE WARNING TRAVELS WITH THE PDF. It is not decoration: overtime is the period's own
 * balance and the hour bank beside it is history rather than pay, and Payroll OT and
 * Overtime are two disagreeing sources that must never be added. Printed without that
 * paragraph, the sheet is eighteen columns of numbers with no statement of which of them
 * somebody is owed — which is how two hundred hours went unreconciled in the first
 * place.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type ExcelJS from "exceljs";
import {
  NAVY, INK, SUBTLE, CARD_BORDER, CARD_BG, RED_TX,
  REPORT_MARGIN as M, HEADER_H,
  loadLogoDataUrl,
} from "@/lib/reportTheme";
import {
  CLOSE_COLUMNS, closeBandSpans, closeDisplayValues, closeExportValues, closeTotalValues,
  printOrientation, type CloseColumn,
} from "@/lib/financeCloseColumns";
import type { ClosePerson, CloseTotals } from "@/lib/financeClose";
import { loadFinanceReportFont } from "@/lib/financeReportFont";

export interface CloseExportInput {
  /** The pay period's name, e.g. "August 2026". */
  periodName: string;
  from: string;
  /** The period's own last day, whether or not it has been reached. */
  to: string;
  /**
   * The last day the figures actually cover.
   *
   * The screen opens on the period covering today, so the sheet is printed mid-period
   * more often than at the close. Equal to `to` once the period has run; earlier while
   * it is still running, and the difference is the reason the shift counts look low.
   * Omitted by a caller that has no running period to describe.
   */
  countedTo?: string;
  /** The active filter, e.g. "Production · Weekend". Empty when nothing is filtered. */
  scope: string;
  rows: ClosePerson[];
  totals: CloseTotals;
  /** One line per crew in view, as the on-screen breakdown shows them. */
  byCrew: { crew: string; totals: CloseTotals }[];
  generatedBy?: string | null;
  /** Filename without an extension. */
  fileBase: string;
  /**
   * The columns the print settings ticked. The printed sheet, the PDF and the workbook's
   * People sheet all carry exactly these, so the three documents handed over for one
   * close are the same document. All of them when omitted.
   */
  columns?: CloseColumn[];
  payrollRegister?: { name: string; employeeRef: string | null; department: string; hours: number; note: string; importedAt: string | null; sourceNote: string | null }[];
}

/** The subtitle both formats carry: which period, and which slice of it. */
export function closeSubtitle(
  i: Pick<CloseExportInput, "periodName" | "from" | "to" | "scope" | "countedTo">,
) {
  // The period's dates always, and where the counting stopped only when that is not
  // the period's end. A printed sheet cannot be hovered over to find out why the shift
  // counts are a fifth of the rota, so it says so on the line under the title.
  const running = i.countedTo && i.countedTo !== i.to;
  return [
    `${i.periodName} · ${i.from.split("-").reverse().join("/")} → ${i.to.split("-").reverse().join("/")}${running ? ` · counted to ${i.countedTo?.split("-").reverse().join("/")}` : ""}`,
    i.scope || "Every crew, every department",
  ].join("  ·  ");
}

/**
 * The paragraph that must go out with the numbers, in the words the screen uses.
 *
 * Second sentence only when nothing has been keyed. A gap of 0.00 h reads as "the two
 * sides agree" and means "one side is empty", and on a printed sheet nobody can hover
 * anything to find out which.
 */
export function closeWarningText(totals: CloseTotals): string {
  const base =
    "Overtime is what THIS pay period ended above zero and Hours deducted is what it "
    + "ended below — each period settles on its own. Opening and closing are the hour "
    + "bank, printed so the running history is readable; they are not added to what is "
    + "paid. Payroll OT is what the office keyed in; the two are never added together, "
    + "and Δ is the disagreement to settle before anybody is paid. A dash means that "
    + "side reported nothing, which is not zero.";
  if (totals.payrollEmpty) {
    return `${base} No payroll overtime has been keyed for this period at all, so there is `
      + "nothing to compare and the gap cannot be read as agreement.";
  }
  if (totals.unreconciled > 0) {
    const n = totals.unreconciled;
    return `${base} ${n} ${n === 1 ? "person has" : "people have"} a figure on one side only.`;
  }
  return base;
}

// ============================================================
// PDF
// ============================================================

/**
 * Landscape, and not by preference.
 *
 * Eighteen columns across a portrait A4 leaves nine millimetres each — narrower than
 * "Opening bank" and far narrower than a name. The close was already unprintable once,
 * which is what the last sheet-of-hours commit was about; a portrait version of this
 * would be the same failure with more columns.
 *
 * The document starts at the register: no figure cards, no crew summary, no warning
 * box above the table. The totals close the register as its last row, and the warning
 * that must travel with the numbers is in the notes at the end, where a document's
 * notes live.
 */
export async function buildClosePdf(input: CloseExportInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  await loadFinanceReportFont(doc);
  doc.setProperties({ title: "AN Maintenance | Finance Close", subject: closeSubtitle(input), author: "Applied Nutrition" });
  const pageW = doc.internal.pageSize.getWidth();
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");
  const subtitle = closeSubtitle(input);

  const header = () => {
    doc.setFillColor(...NAVY); doc.rect(0, 0, pageW, HEADER_H, "F");
    if (logo) doc.addImage(logo, "JPEG", M, 5, 25, 15);
    doc.setTextColor(255); doc.setFont("FinanceReport", "bold"); doc.setFontSize(13);
    doc.text("Finance Close", pageW - M, 9, { align: "right" });
    doc.setFont("FinanceReport", "normal"); doc.setFontSize(7);
    doc.text(doc.splitTextToSize(subtitle, pageW - M * 2 - 34), pageW - M, 15, { align: "right" });
    doc.setTextColor(...INK);
  };
  const footer = (pageNumber: number, pages: number) => {
    const h = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...CARD_BORDER); doc.line(M, h - 10, pageW - M, h - 10);
    doc.setFont("FinanceReport", "normal"); doc.setFontSize(6.5); doc.setTextColor(...SUBTLE);
    doc.text(`Applied Nutrition · Confidential · Generated ${generatedOn}`, M, h - 6);
    doc.text(`Page ${pageNumber} of ${pages}`, pageW - M, h - 6, { align: "right" });
  };
  header();
  const t = input.totals;

  // ── The people ─────────────────────────────────────────────────────────
  // Two header rows: the bands, then the names. Read off CLOSE_COLUMNS, so the spans
  // cannot go adrift the way the screen's hand-written colSpans did.
  const cols = input.columns ?? CLOSE_COLUMNS;
  const bandRow = closeBandSpans(cols).map((b) => ({
    content: b.label ?? "",
    colSpan: b.span,
    styles: { halign: "center" as const, fillColor: NAVY, textColor: 255, fontSize: 6.5, fontStyle: "bold" as const },
  }));
  /*
   * The millimetres in CLOSE_COLUMNS are proportions, not measurements, and get scaled
   * to fill the page exactly.
   *
   * Every column has a fixed width, so autoTable has nothing elastic to put the
   * leftover in: at 264 mm of columns on 269 mm of page it printed the table five
   * millimetres narrow and logged "5 units width could not fit page" — which reads like
   * an overflow and is the opposite. Scaling also means the widths survive a change of
   * margin or paper size instead of having to be re-tuned by hand.
   */
  const usableW = pageW - M * 2;
  const scale = usableW / cols.reduce((a, c) => a + c.mm, 0);
  const columnStyles: Record<number, any> = {};
  cols.forEach((c, i) => {
    columnStyles[i] = { cellWidth: c.mm * scale, halign: c.align };
  });

  autoTable(doc, {
    startY: HEADER_H + 6,
    head: [bandRow, cols.map((c) => c.header)],
    // The totals close the register as its last row, under a rule — the sheet adds
    // itself up instead of carrying a separate summary above it.
    body: [...input.rows.map((r) => closeDisplayValues(r, cols)), closeTotalValues(input.rows, cols)],
    theme: "grid",
    styles: { font: "FinanceReport", fontSize: 6.4, cellPadding: 0.65, lineColor: CARD_BORDER, lineWidth: 0.1, overflow: "linebreak" },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", fontSize: 5.5 },
    alternateRowStyles: { fillColor: CARD_BG },
    columnStyles,
    margin: { left: M, right: M, top: HEADER_H + 4, bottom: 14 },
    rowPageBreak: "avoid",
    didParseCell: (d: any) => {
      // Hours deducted print as a negative in red, as on screen.
      if (d.section === "body" && cols[d.column.index]?.showNegative && String(d.cell.raw).startsWith("-")) {
        d.cell.styles.textColor = RED_TX;
      }
      if (d.section === "body" && d.row.index === input.rows.length) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = [255, 255, 255];
        d.cell.styles.lineWidth = { top: 0.4, right: 0.1, bottom: 0.1, left: 0.1 };
        d.cell.styles.lineColor = { top: INK, right: CARD_BORDER, bottom: CARD_BORDER, left: CARD_BORDER };
      }
    },
    didDrawPage: () => header(),
  });

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 5,
    head: [[{ content: "Overtime register · payroll balances", colSpan: 5 }], ["Employee", "Emp. no.", "Department", "Balance (h)", "Note / import source"]],
    body: input.payrollRegister?.length ? input.payrollRegister.map((r) => [
      r.name, r.employeeRef ?? "—", r.department || "to confirm", r.hours.toFixed(2),
      [r.note || (r.hours < 0 ? "Sickness against banked hours" : ""), r.sourceNote,
        r.importedAt ? new Date(r.importedAt).toLocaleString("en-GB") : null].filter(Boolean).join(" · "),
    ]) : [[{ content: "No overtime recorded for this period", colSpan: 5 }]],
    styles: { font: "FinanceReport", fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
    headStyles: { fillColor: NAVY, fontStyle: "bold" },
    columnStyles: { 3: { halign: "right" } },
    margin: { left: M, right: M, top: HEADER_H + 4, bottom: 14 },
    rowPageBreak: "avoid", didDrawPage: header,
  });

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 5,
    // The warning that must travel with the numbers, at the end where a document's
    // notes live — it used to sit above the register as a boxed paragraph, pushing
    // the people off the first page.
    body: [[closeWarningText(t)],
      ["Shifts come from the board; hours come from the clocks. Part day is hours from the board, not days away. Payroll balances are not hours worked and are not added to clock overtime."],
      ...(t.onUnplannedBoard > 0 ? [[`${t.onUnplannedBoard} people have a rota but no board in this period; their shifts cannot be measured.`]] : []),
      ["Prepared by: ____________________    Checked by: ____________________    Date: ____________________"]],
    theme: "plain", styles: { font: "FinanceReport", fontSize: 7, cellPadding: 2 },
    margin: { left: M, right: M, top: HEADER_H + 4, bottom: 14 }, didDrawPage: header,
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); footer(i, pages); }

  return doc;
}

/**
 * Building and saving are separate so the building can be tested.
 *
 * `doc.save` reaches for the DOM and `XLSX.writeFile` reaches for the disk; neither
 * belongs in a test, and a generator that is only ever exercised by a click is one that
 * fails for the first person who clicks it.
 */
export async function exportClosePdf(input: CloseExportInput) {
  const doc = await buildClosePdf(input);
  doc.save(`${input.fileBase}.pdf`);
}

// ============================================================
// Excel
// ============================================================

/*
 * Built with ExcelJS rather than xlsx-js-style.
 *
 * The register is a document somebody scrolls, filters, prints and sums, and the old
 * writer could do only the last of those: it silently dropped frozen panes, the paper
 * orientation, the header rows repeated on every printed page and the page numbers.
 * ExcelJS writes all of them, and is already what the SKU catalogue exports with.
 */

const XL = {
  navy: "FF1E3A8A",
  navySoft: "FFE0E7FF",
  ink: "FF0F172A",
  subtle: "FF64748B",
  border: "FFCBD5E1",
  zebra: "FFF8FAFC",
  total: "FFEEF2FF",
  warnBg: "FFFEF3C7",
  warnBorder: "FFF59E0B",
  white: "FFFFFFFF",
} as const;

const FONT = "Calibri";
const thin = (argb: string = XL.border): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb } });
const gridBorder = (): Partial<ExcelJS.Borders> => ({ top: thin(), left: thin(), bottom: thin(), right: thin() });
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/** The number format each column is read in. Values stay numbers; only the look changes. */
export function closeColumnNumFmt(c: CloseColumn): string | undefined {
  if (c.align === "left") return undefined;
  if (c.key === "shiftBalance") return "+0;-0;0";
  if (c.key === "deltaHours") return "+#,##0.00;-#,##0.00;0.00";
  if (c.band === "clockedHours" || c.band === "boardHours") return "#,##0.00";
  if (c.band === "shifts") return "0";
  // Days away can be half days, so they are not forced to whole numbers.
  return "0.##;-0.##;0";
}

/** The 1-based Excel column letter for a 1-based index. */
function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Title, subtitle and provenance across the top of a sheet. Returns the next free row. */
function titleBlock(ws: ExcelJS.Worksheet, width: number, title: string, lines: string[]): number {
  const span = Math.max(width, 1);
  ws.mergeCells(1, 1, 1, span);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 16, bold: true, color: { argb: XL.navy } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;
  lines.forEach((text, i) => {
    const r = 2 + i;
    ws.mergeCells(r, 1, r, span);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { name: FONT, size: 10, color: { argb: XL.subtle } };
  });
  // A navy rule under the block, the way the PDF's header bar closes.
  const rule = 2 + lines.length;
  for (let c = 1; c <= span; c++) ws.getCell(rule - 1, c).border = { bottom: { style: "medium", color: { argb: XL.navy } } };
  return rule + 1;
}

/** Paper set-up shared by every sheet: A4, fitted to the width, numbered, confidential. */
function pageSetup(
  ws: ExcelJS.Worksheet,
  orientation: "portrait" | "landscape",
  footerTitle: string,
  printTitlesRow?: string,
) {
  ws.pageSetup = {
    paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.55, bottom: 0.6, header: 0.25, footer: 0.3 },
    ...(printTitlesRow ? { printTitlesRow } : {}),
  };
  const safe = footerTitle.replace(/&/g, "&&");
  ws.headerFooter = {
    oddFooter: `&L&8Applied Nutrition · Confidential&C&8${safe}&R&8Page &P of &N`,
  };
}

/**
 * `value` is left out for the trailing cells of a merge: ExcelJS writes a merged cell's
 * value through to its master, so styling them with "" would wipe the band's label.
 */
function headerCell(cell: ExcelJS.Cell, value: string | undefined, align: "left" | "right" | "center") {
  if (value !== undefined) cell.value = value;
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: XL.white } };
  cell.fill = fill(XL.navy);
  cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
  cell.border = { top: thin(XL.navy), left: thin(XL.navy), bottom: thin(XL.navy), right: thin(XL.navy) };
}

function bodyCell(cell: ExcelJS.Cell, zebra: boolean, align: "left" | "right", numFmt?: string) {
  cell.font = { name: FONT, size: 10, color: { argb: XL.ink } };
  cell.alignment = { horizontal: align, vertical: "middle" };
  cell.border = gridBorder();
  if (zebra) cell.fill = fill(XL.zebra);
  if (numFmt) cell.numFmt = numFmt;
}

function totalCell(cell: ExcelJS.Cell, align: "left" | "right", numFmt?: string) {
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: XL.ink } };
  cell.alignment = { horizontal: align, vertical: "middle" };
  cell.fill = fill(XL.total);
  cell.border = { top: { style: "medium", color: { argb: XL.navy } }, bottom: { style: "double", color: { argb: XL.navy } }, left: thin(), right: thin() };
  if (numFmt) cell.numFmt = numFmt;
}

/**
 * A SUBTOTAL over a column, carrying its value as the cached result.
 *
 * SUBTOTAL(109) rather than SUM so the total follows the autofilter: narrow the sheet
 * to one department inside Excel and the foot of the column is that department's.
 * `null` when nobody in the column reported anything, so the total is a blank and not
 * a nought — the same rule as the cells above it.
 */
function subtotal(col: number, firstRow: number, lastRow: number, values: (number | null)[]) {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length === 0 || lastRow < firstRow) return null;
  const result = Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
  const L = colLetter(col);
  return { formula: `SUBTOTAL(109,${L}${firstRow}:${L}${lastRow})`, result };
}

/** Width in characters: the column's own, widened for a long header or long text. */
function widthFor(header: string, base: number, texts: (string | number | null)[] = []) {
  const longest = texts.reduce<number>((m, v) => Math.max(m, typeof v === "string" ? v.length : 0), 0);
  return Math.min(Math.max(base, header.length + 3, longest + 2), 42);
}

/**
 * The workbook payroll sums, in the columns the print settings ticked.
 *
 * The register carries exactly the columns of the printed sheet and the PDF — what was
 * chosen for paper is what the file holds, so the three documents handed over for one
 * close are the same document. Everything else is the same rule as before: numbers are
 * numbers, an unreported figure is an empty cell, never a zero and never a dash.
 *
 * Sheets: Summary (the figures and the warning that must travel with them), People
 * (the register), By crew, and the Overtime register keyed by the office.
 */
export async function buildCloseWorkbook(input: CloseExportInput): Promise<ExcelJS.Workbook> {
  const cols = input.columns?.length ? input.columns : CLOSE_COLUMNS;
  const t = input.totals;
  const generated = `Generated ${new Date().toLocaleString("en-GB")}${input.generatedBy ? ` by ${input.generatedBy}` : ""}`;
  const subtitle = closeSubtitle(input);
  const footerTitle = `Finance Close · ${input.periodName}`;

  // Loaded on the click, not with the page: ExcelJS is a large library and the close
  // is opened far more often than it is exported.
  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  wb.creator = "Applied Nutrition";
  wb.company = "Applied Nutrition";
  wb.title = `Finance Close · ${input.periodName}`;
  wb.subject = subtitle;
  wb.created = new Date();

  // ── Summary ────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Summary", { properties: { tabColor: { argb: XL.navy } }, views: [{ showGridLines: false }] });
    ws.columns = [{ width: 30 }, { width: 16 }, { width: 10 }, { width: 40 }];
    let r = titleBlock(ws, 4, "Finance Close", [subtitle, generated]);
    const heads = ["Figure", "Value", "Unit"];
    heads.forEach((h, i) => headerCell(ws.getCell(r, i + 1), h, i === 0 ? "left" : i === 1 ? "right" : "left"));
    ws.getRow(r).height = 20;
    r += 1;
    const figures: [string, number | null, string, string][] = [
      ["Overtime paid", t.overtimeHours, "h", "#,##0.00"],
      ["Hours deducted", t.owedHours, "h", "#,##0.00"],
      ["Part day", t.partDayHours, "h", "#,##0.00"],
      // Null, not 0 — an empty cell is the only honest way to write "nothing keyed" in
      // a column somebody might sum.
      ["Payroll OT", t.payrollEmpty ? null : t.payrollOtHours, "h", "#,##0.00"],
      ["Gap to settle", t.payrollEmpty ? null : t.deltaHours, "h", "+#,##0.00;-#,##0.00;0.00"],
      ["Shifts over rota", t.overtimeShifts, "shifts", "0"],
      ["Shifts short", t.deficitShifts, "shifts", "0"],
      ["People", t.people, "", "0"],
    ];
    figures.forEach(([label, value, unit, fmt], i) => {
      const zebra = i % 2 === 1;
      const a = ws.getCell(r, 1); a.value = label; bodyCell(a, zebra, "left");
      const b = ws.getCell(r, 2); b.value = value; bodyCell(b, zebra, "right", fmt);
      if (i === 0) b.font = { name: FONT, size: 10, bold: true, color: { argb: XL.navy } };
      const c = ws.getCell(r, 3); c.value = unit; bodyCell(c, zebra, "left");
      c.font = { name: FONT, size: 10, color: { argb: XL.subtle } };
      r += 1;
    });

    r += 1;
    ws.mergeCells(r, 1, r, 4);
    const head = ws.getCell(r, 1);
    head.value = "Read this before paying anybody";
    head.font = { name: FONT, size: 11, bold: true, color: { argb: XL.ink } };
    r += 1;
    ws.mergeCells(r, 1, r, 4);
    const warn = ws.getCell(r, 1);
    warn.value = closeWarningText(t);
    warn.font = { name: FONT, size: 10, color: { argb: XL.ink } };
    warn.alignment = { wrapText: true, vertical: "top" };
    warn.fill = fill(XL.warnBg);
    warn.border = { top: thin(XL.warnBorder), left: thin(XL.warnBorder), bottom: thin(XL.warnBorder), right: thin(XL.warnBorder) };
    // Merged cells do not grow to fit wrapped text, so the height is set from the length.
    ws.getRow(r).height = Math.max(60, Math.ceil(closeWarningText(t).length / 110) * 14 + 10);
    r += 1;
    const notes = [
      "Shifts come from the board; hours come from the clocks. Part day is hours from the board, not days away.",
      "Payroll balances are not hours worked and are not added to clock overtime.",
      ...(t.onUnplannedBoard > 0 ? [`${t.onUnplannedBoard} people have a rota but no board in this period; their shifts cannot be measured.`] : []),
      `The People sheet carries the ${cols.length} of ${CLOSE_COLUMNS.length} columns chosen in the print settings.`,
    ];
    for (const n of notes) {
      ws.mergeCells(r, 1, r, 4);
      const c = ws.getCell(r, 1);
      c.value = n;
      c.font = { name: FONT, size: 9, italic: true, color: { argb: XL.subtle } };
      c.alignment = { wrapText: true, vertical: "top" };
      ws.getRow(r).height = 26;
      r += 1;
    }

    r += 1;
    for (const label of ["Prepared by", "Checked by", "Date"]) {
      const a = ws.getCell(r, 1); a.value = label;
      a.font = { name: FONT, size: 10, bold: true, color: { argb: XL.ink } };
      ws.mergeCells(r, 2, r, 4);
      for (let c = 2; c <= 4; c++) ws.getCell(r, c).border = { bottom: thin(XL.ink) };
      ws.getRow(r).height = 22;
      r += 1;
    }
    pageSetup(ws, "portrait", footerTitle);
  }

  // ── People: the register, in the chosen columns ────────────────────────
  {
    const ws = wb.addWorksheet("People", { properties: { tabColor: { argb: XL.navy } } });
    const n = cols.length;
    const top = titleBlock(ws, n, "Finance Close · Register", [subtitle, `${generated} · ${input.rows.length} ${input.rows.length === 1 ? "person" : "people"}`]);
    const bandRow = top;
    const headRow = top + 1;
    const first = headRow + 1;
    const last = headRow + input.rows.length;

    // The band row above the column names, merged, so the workbook says which question
    // each column answers exactly as the screen does.
    let c = 1;
    for (const b of closeBandSpans(cols)) {
      if (b.span > 1) ws.mergeCells(bandRow, c, bandRow, c + b.span - 1);
      for (let k = 0; k < b.span; k++) headerCell(ws.getCell(bandRow, c + k), k === 0 ? b.label ?? "" : undefined, "center");
      c += b.span;
    }
    ws.getRow(bandRow).height = 18;
    cols.forEach((col, i) => {
      const cell = ws.getCell(headRow, i + 1);
      headerCell(cell, col.header, col.align);
      cell.fill = fill(XL.navySoft);
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: XL.navy } };
      cell.border = { top: thin(), left: thin(), right: thin(), bottom: { style: "medium", color: { argb: XL.navy } } };
    });
    ws.getRow(headRow).height = 30;

    const values = input.rows.map((r) => closeExportValues(r, cols));
    values.forEach((row, ri) => {
      const r = first + ri;
      row.forEach((v, ci) => {
        const col = cols[ci];
        const cell = ws.getCell(r, ci + 1);
        // An unreported figure stays an EMPTY cell — styled, but with no value.
        if (v !== null && v !== "") cell.value = v;
        bodyCell(cell, ri % 2 === 1, col.align, closeColumnNumFmt(col));
      });
    });

    // The totals close the register, as on paper — but as live SUBTOTALs that follow
    // the autofilter.
    const totalRow = last + 1;
    cols.forEach((col, ci) => {
      const cell = ws.getCell(totalRow, ci + 1);
      if (ci === 0) {
        cell.value = input.rows.length
          ? { formula: `"Total · "&SUBTOTAL(103,A${first}:A${last})&" people"`, result: `Total · ${input.rows.length} people` }
          : "Total · 0 people";
      } else if (col.align === "right") {
        const st = subtotal(ci + 1, first, last, values.map((row) => {
          const v = row[ci];
          return typeof v === "number" ? v : null;
        }));
        if (st) cell.value = st;
      }
      totalCell(cell, col.align, closeColumnNumFmt(col));
    });
    ws.getRow(totalRow).height = 20;

    ws.columns = cols.map((col, i) => ({
      key: col.key,
      width: widthFor(col.header, col.wch, values.map((row) => row[i])),
    }));
    // Name and header stay on screen while scrolling either way.
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: headRow, topLeftCell: colLetter(2) + first, activeCell: colLetter(2) + first, showGridLines: false }];
    ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: Math.max(last, headRow), column: n } };
    pageSetup(ws, printOrientation(cols), footerTitle, `${bandRow}:${headRow}`);
  }

  // ── By crew ────────────────────────────────────────────────────────────
  {
    const ws = wb.addWorksheet("By crew");
    const heads: { h: string; w: number; fmt?: string }[] = [
      { h: "Crew", w: 22 },
      { h: "People", w: 10, fmt: "0" },
      { h: "Overtime paid (h)", w: 18, fmt: "#,##0.00" },
      { h: "Hours deducted (h)", w: 19, fmt: "#,##0.00" },
      { h: "Payroll OT (h)", w: 16, fmt: "#,##0.00" },
      { h: "Gap to settle (h)", w: 18, fmt: "+#,##0.00;-#,##0.00;0.00" },
    ];
    const headRow = titleBlock(ws, heads.length, "Finance Close · By crew", [subtitle, generated]);
    heads.forEach((h, i) => headerCell(ws.getCell(headRow, i + 1), h.h, i === 0 ? "left" : "right"));
    ws.getRow(headRow).height = 22;
    const rows: (string | number | null)[][] = input.byCrew.map(({ crew, totals }) => [
      crew, totals.people, totals.overtimeHours, totals.owedHours,
      totals.payrollEmpty ? null : totals.payrollOtHours,
      totals.payrollEmpty ? null : totals.deltaHours,
    ]);
    const first = headRow + 1;
    const last = headRow + rows.length;
    rows.forEach((row, ri) => row.forEach((v, ci) => {
      const cell = ws.getCell(first + ri, ci + 1);
      if (v !== null) cell.value = v;
      bodyCell(cell, ri % 2 === 1, ci === 0 ? "left" : "right", heads[ci].fmt);
    }));
    const totalRow = last + 1;
    heads.forEach((h, ci) => {
      const cell = ws.getCell(totalRow, ci + 1);
      if (ci === 0) cell.value = "Total";
      else {
        const st = subtotal(ci + 1, first, last, rows.map((row) => (typeof row[ci] === "number" ? (row[ci] as number) : null)));
        if (st) cell.value = st;
      }
      totalCell(cell, ci === 0 ? "left" : "right", h.fmt);
    });
    ws.columns = heads.map((h) => ({ width: h.w }));
    ws.views = [{ state: "frozen", ySplit: headRow, showGridLines: false }];
    pageSetup(ws, "portrait", footerTitle, `${headRow}:${headRow}`);
  }

  // ── Overtime register: what the office keyed ───────────────────────────
  {
    const ws = wb.addWorksheet("Overtime register");
    const heads: { h: string; w: number; align: "left" | "right"; fmt?: string }[] = [
      { h: "Employee", w: 28, align: "left" },
      { h: "Emp. no.", w: 11, align: "left" },
      { h: "Department", w: 18, align: "left" },
      { h: "Balance (h)", w: 13, align: "right", fmt: "+#,##0.00;-#,##0.00;0.00" },
      { h: "Note", w: 34, align: "left" },
      { h: "Import source", w: 26, align: "left" },
      { h: "Imported", w: 18, align: "left" },
    ];
    const headRow = titleBlock(ws, heads.length, "Finance Close · Overtime register", [
      "Payroll balances keyed by the office. Not hours worked, and never added to clock overtime.",
      subtitle,
    ]);
    heads.forEach((h, i) => headerCell(ws.getCell(headRow, i + 1), h.h, h.align));
    ws.getRow(headRow).height = 22;
    const reg = input.payrollRegister ?? [];
    const first = headRow + 1;
    if (reg.length === 0) {
      ws.mergeCells(first, 1, first, heads.length);
      const c = ws.getCell(first, 1);
      c.value = "No overtime recorded for this period";
      c.font = { name: FONT, size: 10, italic: true, color: { argb: XL.subtle } };
      c.alignment = { horizontal: "center" };
    } else {
      reg.forEach((e, ri) => {
        const row: (string | number | Date | null)[] = [
          e.name, e.employeeRef, e.department || "to confirm", e.hours,
          e.note || (e.hours < 0 ? "Sickness against banked hours" : ""),
          e.sourceNote, e.importedAt ? new Date(e.importedAt) : null,
        ];
        row.forEach((v, ci) => {
          const cell = ws.getCell(first + ri, ci + 1);
          if (v !== null && v !== "") cell.value = v;
          bodyCell(cell, ri % 2 === 1, heads[ci].align, ci === 6 ? "dd/mm/yyyy hh:mm" : heads[ci].fmt);
        });
      });
      const last = first + reg.length - 1;
      const totalRow = last + 1;
      heads.forEach((h, ci) => {
        const cell = ws.getCell(totalRow, ci + 1);
        if (ci === 0) cell.value = "Total";
        if (ci === 3) cell.value = subtotal(4, first, last, reg.map((e) => e.hours));
        totalCell(cell, h.align, h.fmt);
      });
      ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: last, column: heads.length } };
    }
    ws.columns = heads.map((h) => ({ width: h.w }));
    ws.views = [{ state: "frozen", ySplit: headRow, showGridLines: false }];
    pageSetup(ws, "landscape", footerTitle, `${headRow}:${headRow}`);
  }

  // The register is what this file is for; open on it.
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: "visible" }];
  return wb;
}

export async function exportCloseExcel(input: CloseExportInput) {
  const wb = await buildCloseWorkbook(input);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${input.fileBase}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked a moment later: Safari aborts a download whose URL is revoked in the same tick.
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
