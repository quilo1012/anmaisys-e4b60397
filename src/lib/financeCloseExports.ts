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
 * Both read `CLOSE_COLUMNS`, so neither can drift from the screen or from each other.
 *
 * THE WARNING TRAVELS WITH THE PDF. It is not decoration: the balance runs on between
 * periods, and Payroll OT and Overtime are two disagreeing sources that must never be
 * added. Printed without that paragraph, the sheet is eighteen columns of numbers with
 * no statement of which of them somebody is owed — which is how two hundred hours went
 * unreconciled in the first place.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
import {
  NAVY, INK, SUBTLE, CARD_BORDER, CARD_BG, GREEN_TX, AMBER_TX,
  REPORT_MARGIN as M, HEADER_H,
  loadLogoDataUrl, drawReportHeader, drawReportFooter, drawKpiCard,
  type RGB,
} from "@/lib/reportTheme";
import {
  CLOSE_COLUMNS, closeBandSpans, closeDisplayValues, closeExportValues,
} from "@/lib/financeCloseColumns";
import type { ClosePerson, CloseTotals } from "@/lib/financeClose";

export interface CloseExportInput {
  /** The pay period's name, e.g. "August 2026". */
  periodName: string;
  from: string;
  to: string;
  /** The active filter, e.g. "Production · Weekend". Empty when nothing is filtered. */
  scope: string;
  rows: ClosePerson[];
  totals: CloseTotals;
  /** One line per crew in view, as the on-screen breakdown shows them. */
  byCrew: { crew: string; totals: CloseTotals }[];
  generatedBy?: string | null;
  /** Filename without an extension. */
  fileBase: string;
}

/** The subtitle both formats carry: which period, and which slice of it. */
export function closeSubtitle(i: Pick<CloseExportInput, "periodName" | "from" | "to" | "scope">) {
  return [`${i.periodName} · ${i.from} → ${i.to}`, i.scope || "Every crew, every department"]
    .join("  ·  ");
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
    "Hours are not settled week by week and the balance runs on between periods — it is an "
    + "hour bank. A shortfall is worked off against later hours one for one, and only what "
    + "stands above zero at the close is overtime. Payroll OT is what the office keyed in; the "
    + "two are never added together, and Δ is the disagreement to settle before anybody is "
    + "paid. A dash means that side reported nothing, which is not zero.";
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

const hrs = (n: number) => `${n.toFixed(2)} h`;

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
 */
export async function buildClosePdf(input: CloseExportInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");
  const subtitle = closeSubtitle(input);

  const header = () => drawReportHeader(doc, { title: "Finance Close", subtitle, logo });
  const footer = (pageNumber: number) =>
    drawReportFooter(doc, { pageNumber, generatedOn, generatedBy: input.generatedBy });
  header();

  // ── The figures, in the order the screen leads with ────────────────────
  // Overtime paid first: it is the number somebody is about to pay.
  const t = input.totals;
  const cards: { label: string; value: string; color?: RGB; accent?: RGB }[] = [
    { label: "Overtime paid", value: hrs(t.overtimeHours), color: GREEN_TX, accent: GREEN_TX },
    { label: "Hours deducted", value: hrs(t.owedHours), color: t.owedHours > 0 ? AMBER_TX : INK },
    { label: "Part day", value: hrs(t.partDayHours), color: t.partDayHours > 0 ? AMBER_TX : INK },
    { label: "Payroll OT", value: hrs(t.payrollOtHours) },
    // A dash, never "0.00 h" — see closeWarningText.
    { label: "Gap to settle", value: t.payrollEmpty ? "—" : hrs(t.deltaHours), color: !t.payrollEmpty && Math.abs(t.deltaHours) >= 1 ? AMBER_TX : INK },
    { label: "Shifts over rota", value: String(t.overtimeShifts) },
    { label: "Shifts short", value: String(t.deficitShifts), color: t.deficitShifts > 0 ? AMBER_TX : INK },
    { label: "People", value: String(t.people) },
  ];
  const gap = 3.5;
  const cardW = (pageW - M * 2 - gap * (cards.length - 1)) / cards.length;
  const cardY = HEADER_H + 6;
  cards.forEach((c, i) => drawKpiCard(doc, {
    x: M + i * (cardW + gap), y: cardY, w: cardW, h: 20,
    label: c.label, value: c.value, valueColor: c.color, accent: c.accent,
  }));

  // ── The warning, before any table ──────────────────────────────────────
  let y = cardY + 20 + 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...SUBTLE);
  const warn = doc.splitTextToSize(closeWarningText(t), pageW - M * 2 - 4);
  doc.setFillColor(...CARD_BG); doc.setDrawColor(...CARD_BORDER);
  doc.roundedRect(M, y, pageW - M * 2, warn.length * 3.2 + 4, 1.5, 1.5, "FD");
  doc.text(warn, M + 2, y + 4.2);
  y += warn.length * 3.2 + 4 + 6;
  doc.setTextColor(0);

  // ── The split by crew, whatever the filter says ────────────────────────
  if (input.byCrew.length > 1) {
    autoTable(doc, {
      startY: y,
      head: [["Crew", "People", "Overtime paid", "Hours deducted", "Payroll OT", "Gap to settle"]],
      body: input.byCrew.map(({ crew, totals }) => [
        crew, totals.people, hrs(totals.overtimeHours), hrs(totals.owedHours),
        hrs(totals.payrollOtHours),
        totals.payrollEmpty ? "not comparable" : hrs(totals.deltaHours),
      ]),
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 1.6, lineColor: CARD_BORDER, lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
      margin: { left: M, right: M, top: HEADER_H + 4 },
      didDrawPage: () => header(),
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── The people ─────────────────────────────────────────────────────────
  // Two header rows: the bands, then the names. Read off CLOSE_COLUMNS, so the spans
  // cannot go adrift the way the screen's hand-written colSpans did.
  const bandRow = closeBandSpans().map((b) => ({
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
  const scale = usableW / CLOSE_COLUMNS.reduce((a, c) => a + c.mm, 0);
  const columnStyles: Record<number, any> = {};
  CLOSE_COLUMNS.forEach((c, i) => {
    columnStyles[i] = { cellWidth: c.mm * scale, halign: c.align };
  });

  autoTable(doc, {
    startY: y,
    head: [bandRow, CLOSE_COLUMNS.map((c) => c.header)],
    body: input.rows.map((r) => closeDisplayValues(r)),
    theme: "grid",
    styles: { fontSize: 6.4, cellPadding: 1.2, lineColor: CARD_BORDER, lineWidth: 0.1, overflow: "linebreak" },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", fontSize: 6.4 },
    alternateRowStyles: { fillColor: CARD_BG },
    columnStyles,
    margin: { left: M, right: M, top: HEADER_H + 4 },
    didDrawPage: () => header(),
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); footer(i); }

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
const HEAD_FILL = { patternType: "solid", fgColor: { rgb: "1E3A8A" } };
const HEAD_FONT = { bold: true, color: { rgb: "FFFFFF" } };
const TITLE_FONT = { bold: true, sz: 13 };

function styleRow(ws: any, row: number, cols: number, s: any) {
  for (let c = 0; c < cols; c++) {
    const addr = XLSX.utils.encode_cell({ r: row, c });
    if (ws[addr]) ws[addr].s = s;
  }
}

/**
 * Numbers Excel can add up, in three sheets.
 *
 * Summary first, because it is what finance reads before deciding whether to open the
 * rest. The warning goes on it too — a workbook is forwarded far more often than a
 * printout, and the sentence about the hour bank is the one thing a recipient needs
 * that the columns do not say.
 */
export function buildCloseWorkbook(input: CloseExportInput) {
  const wb = XLSX.utils.book_new();
  const t = input.totals;

  // ── Sheet 1: Summary ───────────────────────────────────────────────────
  const s1: any[][] = [
    ["Finance Close"],
    [closeSubtitle(input)],
    [`Generated ${new Date().toLocaleString("en-GB")}${input.generatedBy ? ` by ${input.generatedBy}` : ""}`],
    [],
    ["Figure", "Value", "Unit"],
    ["Overtime paid", t.overtimeHours, "h"],
    ["Hours deducted", t.owedHours, "h"],
    ["Part day", t.partDayHours, "h"],
    ["Payroll OT", t.payrollOtHours, "h"],
    // Null, not 0 — an empty cell is the only honest way to write "nothing to compare"
    // in a column somebody might sum.
    ["Gap to settle", t.payrollEmpty ? null : t.deltaHours, "h"],
    ["Shifts over rota", t.overtimeShifts, "shifts"],
    ["Shifts short", t.deficitShifts, "shifts"],
    ["People", t.people, ""],
    [],
    ["Read this before paying anybody"],
    [closeWarningText(t)],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 8 }];
  ws1["A1"].s = TITLE_FONT;
  styleRow(ws1, 4, 3, { fill: HEAD_FILL, font: HEAD_FONT });
  if (ws1["A15"]) ws1["A15"].s = { font: { bold: true } };
  if (ws1["A16"]) ws1["A16"].s = { alignment: { wrapText: true, vertical: "top" } };
  ws1["!merges"] = [{ s: { r: 15, c: 0 }, e: { r: 15, c: 2 } }];
  ws1["!rows"] = [];
  ws1["!rows"][15] = { hpt: 90 };
  XLSX.utils.book_append_sheet(wb, ws1, "Summary");

  // ── Sheet 2: By crew ───────────────────────────────────────────────────
  const s2: any[][] = [
    ["Crew", "People", "Overtime paid (h)", "Hours deducted (h)", "Payroll OT (h)", "Gap to settle (h)"],
    ...input.byCrew.map(({ crew, totals }) => [
      crew, totals.people, totals.overtimeHours, totals.owedHours, totals.payrollOtHours,
      totals.payrollEmpty ? null : totals.deltaHours,
    ]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(s2);
  ws2["!cols"] = [{ wch: 20 }, { wch: 9 }, { wch: 17 }, { wch: 18 }, { wch: 15 }, { wch: 16 }];
  styleRow(ws2, 0, 6, { fill: HEAD_FILL, font: HEAD_FONT });
  XLSX.utils.book_append_sheet(wb, ws2, "By crew");

  // ── Sheet 3: People ────────────────────────────────────────────────────
  // The band row above the column names, merged, so the workbook says which question
  // each column answers exactly as the screen does.
  const spans = closeBandSpans();
  const bandCells: any[] = [];
  const merges: any[] = [];
  let col = 0;
  for (const b of spans) {
    bandCells.push(b.label ?? "");
    for (let k = 1; k < b.span; k++) bandCells.push("");
    if (b.span > 1) merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + b.span - 1 } });
    col += b.span;
  }

  const s3: any[][] = [
    bandCells,
    CLOSE_COLUMNS.map((c) => c.header),
    ...input.rows.map((r) => closeExportValues(r)),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(s3);
  ws3["!cols"] = CLOSE_COLUMNS.map((c) => ({ wch: c.wch }));
  ws3["!merges"] = merges;
  styleRow(ws3, 0, CLOSE_COLUMNS.length, { fill: HEAD_FILL, font: HEAD_FONT, alignment: { horizontal: "center" } });
  styleRow(ws3, 1, CLOSE_COLUMNS.length, { fill: HEAD_FILL, font: HEAD_FONT });
  // An autofilter on the names row, so the department and crew can be narrowed again
  // inside Excel without coming back to the app for a differently-filtered download.
  // (Frozen panes would be the other half of this and xlsx-js-style cannot write them,
  // so this does not pretend to: `!freeze` is silently ignored by the writer.)
  ws3["!autofilter"] = {
    ref: XLSX.utils.encode_range(
      { r: 1, c: 0 },
      { r: 1 + input.rows.length, c: CLOSE_COLUMNS.length - 1 },
    ),
  };
  XLSX.utils.book_append_sheet(wb, ws3, "People");

  return wb;
}

export function exportCloseExcel(input: CloseExportInput) {
  XLSX.writeFile(buildCloseWorkbook(input), `${input.fileBase}.xlsx`);
}
