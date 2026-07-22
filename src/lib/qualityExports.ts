/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable + xlsx-js-style cells are loosely typed */
// Quality report professional exports — PDF (jsPDF) + Excel (xlsx-js-style).
// Mirrors src/lib/ragExports.ts.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
import { format } from "date-fns";
import logoUrl from "@/assets/appliedlogo.jpeg";

export interface QualityLineRow {
  line: string;
  batches: number;
  qas: number;
  ccp: number;
  toolbox: number;
  actions: number;
}

export interface QualityWeekBlock {
  label: string;
  rows: QualityLineRow[];
}

export interface QualityActionRow {
  date: string;
  line: string;
  problem: string;
}

export interface QualityExportInput {
  title: string;
  periodLabel: string;
  generatedBy: string;
  monthly: QualityLineRow[];
  weeks: QualityWeekBlock[];
  actions: QualityActionRow[];
  fileBase: string;
}

const checksOf = (r: QualityLineRow) => r.qas + r.ccp + r.toolbox;
const errPct = (r: QualityLineRow) => {
  const c = checksOf(r);
  return c > 0 ? (r.actions / c) * 100 : 0;
};
const fmtPct = (p: number) => `${p.toFixed(2)}%`;

function totalsOf(rows: QualityLineRow[]): QualityLineRow {
  return rows.reduce(
    (t, r) => ({
      line: "TOTAL",
      batches: t.batches + r.batches,
      qas: t.qas + r.qas,
      ccp: t.ccp + r.ccp,
      toolbox: t.toolbox + r.toolbox,
      actions: t.actions + r.actions,
    }),
    { line: "TOTAL", batches: 0, qas: 0, ccp: 0, toolbox: 0, actions: 0 },
  );
}

function mostActionsLine(rows: QualityLineRow[]): string {
  let best = "—";
  let max = -1;
  for (const r of rows) {
    if (r.actions > max) {
      max = r.actions;
      best = r.line;
    }
  }
  return max > 0 ? best : "—";
}

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ============================================================
// PDF
// ============================================================
export async function exportQualityPdf(input: QualityExportInput) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  const logo = await loadLogoDataUrl();
  if (logo) {
    try { doc.addImage(logo, "JPEG", margin, 8, 24, 13); } catch { /* ignore */ }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(input.title, margin + 28, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(input.periodLabel, margin + 28, 20);

  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, pageW - margin, 12, { align: "right" });
  doc.text(`By: ${input.generatedBy}`, pageW - margin, 17, { align: "right" });
  doc.setTextColor(0);

  // KPI strip
  const mTotals = totalsOf(input.monthly);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(
    `Actions Opened: ${mTotals.actions}     Batches: ${mTotals.batches}     Checks: ${checksOf(mTotals)}     % Error: ${fmtPct(errPct(mTotals))}     Most Actions: ${mostActionsLine(input.monthly)}`,
    margin,
    28,
  );
  doc.setFont("helvetica", "normal");

  // Monthly summary by line
  autoTable(doc, {
    startY: 32,
    head: [["Line", "Batches", "Checks", "Actions", "% Error"]],
    body: input.monthly.map((r) => [r.line, r.batches, checksOf(r), r.actions, fmtPct(errPct(r))]),
    foot: [["TOTAL", mTotals.batches, checksOf(mTotals), mTotals.actions, fmtPct(errPct(mTotals))]],
    theme: "grid",
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8 },
    footStyles: { fillColor: [226, 232, 240], textColor: 0, fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    margin: { left: margin, right: margin },
  });

  // Weekly breakdown
  for (const w of input.weeks) {
    const wt = totalsOf(w.rows);
    const y = (doc as any).lastAutoTable.finalY + 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(w.label, margin, y);
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: y + 2,
      head: [["Line", "Batches", "QAS21.0a", "CCP", "Toolbox", "Actions", "% Error"]],
      body: w.rows.map((r) => [r.line, r.batches, r.qas, r.ccp, r.toolbox, r.actions, fmtPct(errPct(r))]),
      foot: [["TOTAL", wt.batches, wt.qas, wt.ccp, wt.toolbox, wt.actions, fmtPct(errPct(wt))]],
      theme: "grid",
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 7.5 },
      footStyles: { fillColor: [226, 232, 240], textColor: 0, fontStyle: "bold", fontSize: 7.5 },
      bodyStyles: { fontSize: 7.5 },
      margin: { left: margin, right: margin },
    });
  }

  // Actions opened
  if (input.actions.length) {
    const y = (doc as any).lastAutoTable.finalY + 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Actions opened (${input.actions.length})`, margin, y);
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: y + 2,
      head: [["Date", "Line", "Problem"]],
      body: input.actions.map((a) => [a.date, a.line, a.problem]),
      theme: "striped",
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 28 } },
      margin: { left: margin, right: margin },
    });
  }

  // Footer page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(`Page ${i} / ${pages}`, pageW - margin, doc.internal.pageSize.getHeight() - 8, { align: "right" });
  }
  doc.setTextColor(0);

  doc.save(`${input.fileBase}.pdf`);
}

// ============================================================
// Excel
// ============================================================
const HEAD_FILL = { patternType: "solid", fgColor: { rgb: "1E3A5F" } };
const HEAD_FONT = { bold: true, color: { rgb: "FFFFFF" } };
const TOTAL_FILL = { patternType: "solid", fgColor: { rgb: "E2E8F0" } };

function styleHeaderRow(ws: any, row: number, cols: number) {
  for (let c = 0; c < cols; c++) {
    const addr = XLSX.utils.encode_cell({ r: row, c });
    if (ws[addr]) ws[addr].s = { fill: HEAD_FILL, font: HEAD_FONT };
  }
}
function styleTotalRow(ws: any, row: number, cols: number) {
  for (let c = 0; c < cols; c++) {
    const addr = XLSX.utils.encode_cell({ r: row, c });
    if (ws[addr]) ws[addr].s = { fill: TOTAL_FILL, font: { bold: true } };
  }
}

export function exportQualityExcel(input: QualityExportInput) {
  const wb = XLSX.utils.book_new();
  const mTotals = totalsOf(input.monthly);

  // Sheet 1: Monthly summary
  const s1: any[][] = [
    [input.title],
    [input.periodLabel],
    [`Actions Opened: ${mTotals.actions}`, `Batches: ${mTotals.batches}`, `Checks: ${checksOf(mTotals)}`, `% Error: ${fmtPct(errPct(mTotals))}`, `Most Actions: ${mostActionsLine(input.monthly)}`],
    [],
    ["Line", "Batches", "Checks", "Actions", "% Error"],
    ...input.monthly.map((r) => [r.line, r.batches, checksOf(r), r.actions, fmtPct(errPct(r))]),
    ["TOTAL", mTotals.batches, checksOf(mTotals), mTotals.actions, fmtPct(errPct(mTotals))],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  styleHeaderRow(ws1, 4, 5);
  styleTotalRow(ws1, 5 + input.monthly.length, 5);
  XLSX.utils.book_append_sheet(wb, ws1, "Monthly Summary");

  // Sheet 2: Weekly breakdown (stacked)
  const s2: any[][] = [];
  const weekHeaderRows: number[] = [];
  const weekTotalRows: number[] = [];
  for (const w of input.weeks) {
    const wt = totalsOf(w.rows);
    s2.push([w.label]);
    weekHeaderRows.push(s2.length); // header will be next row (0-indexed = s2.length after push below)
    s2.push(["Line", "Batches", "QAS21.0a", "CCP", "Toolbox", "Actions", "% Error"]);
    for (const r of w.rows) s2.push([r.line, r.batches, r.qas, r.ccp, r.toolbox, r.actions, fmtPct(errPct(r))]);
    weekTotalRows.push(s2.length);
    s2.push(["TOTAL", wt.batches, wt.qas, wt.ccp, wt.toolbox, wt.actions, fmtPct(errPct(wt))]);
    s2.push([]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(s2.length ? s2 : [["No weekly data"]]);
  ws2["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 9 }, { wch: 10 }];
  weekHeaderRows.forEach((r) => styleHeaderRow(ws2, r, 7));
  weekTotalRows.forEach((r) => styleTotalRow(ws2, r, 7));
  XLSX.utils.book_append_sheet(wb, ws2, "Weekly");

  // Sheet 3: Actions
  const s3: any[][] = [["Date", "Line", "Problem"], ...input.actions.map((a) => [a.date, a.line, a.problem])];
  const ws3 = XLSX.utils.aoa_to_sheet(s3);
  ws3["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 80 }];
  styleHeaderRow(ws3, 0, 3);
  XLSX.utils.book_append_sheet(wb, ws3, "Actions");

  XLSX.writeFile(wb, `${input.fileBase}.xlsx`);
}
