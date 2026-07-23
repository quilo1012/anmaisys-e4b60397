/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable + xlsx-js-style cells are loosely typed */
// Professional Quality report exports for the Quality Actions data:
//   - PDF (jsPDF + autoTable): printable report with logo header, KPIs, breakdowns, full list.
//   - Excel (xlsx-js-style): styled workbook with a Summary sheet + an Actions sheet.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
import logoUrl from "@/assets/appliedlogo.jpeg";
import { statusMeta, severityMeta } from "@/lib/qualityConstants";

export interface QualityReportAction {
  recorded_at: string;
  action_no: string | null;
  status: string;
  severity: string | null;
  line: string | null;
  shift: string | null;
  leader_name: string | null;
  department: string | null;
  sku: string | null;
  batch: string | null;
  labels: string[] | null;
  description: string | null;
}

export interface QualityReportInput {
  actions: QualityReportAction[];
  periodLabel: string;
  generatedBy: string;
}

const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return iso?.slice(0, 10) ?? ""; }
};
const sevLabel = (s: string | null) => (s ? severityMeta(s)?.label ?? s : "—");

function tally(actions: QualityReportAction[], pick: (a: QualityReportAction) => string) {
  const m = new Map<string, number>();
  for (const a of actions) { const k = pick(a) || "—"; m.set(k, (m.get(k) ?? 0) + 1); }
  return Array.from(m.entries()).sort((x, y) => y[1] - x[1]);
}

function summarize(actions: QualityReportAction[]) {
  const s = { total: actions.length, todo: 0, in_progress: 0, complete: 0, highCritical: 0 };
  for (const a of actions) {
    if (a.status === "todo") s.todo++;
    else if (a.status === "in_progress") s.in_progress++;
    else if (a.status === "complete") s.complete++;
    if (a.severity === "high" || a.severity === "critical") s.highCritical++;
  }
  return s;
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
  } catch { return null; }
}

// ── PDF ──────────────────────────────────────────────────────────────────────
export async function generateQualityReportPDF(input: QualityReportInput) {
  const { actions, periodLabel, generatedBy } = input;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");

  const drawHeader = () => {
    if (logo) { try { doc.addImage(logo, "JPEG", margin, 8, 22, 12); } catch { /* ignore */ } }
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(20, 30, 60);
    doc.text("Quality Report", pageW - margin, 14, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(periodLabel, pageW - margin, 20, { align: "right" });
    doc.setDrawColor(200); doc.line(margin, 24, pageW - margin, 24);
  };

  const s = summarize(actions);
  drawHeader();

  // KPIs
  let y = 32;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20, 30, 60);
  doc.text("Summary", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(0);
  const kpis = [
    `Total actions: ${s.total}`, `To do: ${s.todo}`, `In progress: ${s.in_progress}`,
    `Complete: ${s.complete}`, `High / Critical: ${s.highCritical}`,
  ];
  doc.text(kpis.join("      "), margin, y);
  y += 6;

  // Breakdown tables (two per row via startY chaining)
  const breakdown = (title: string, rows: [string, number][]) => {
    autoTable(doc, {
      startY: y,
      head: [[title, "Count"]],
      body: rows.length ? rows.map(([k, v]) => [k, String(v)]) : [["—", "0"]],
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: margin, right: margin },
      tableWidth: (pageW - margin * 2),
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  };
  breakdown("By Status", tally(actions, (a) => statusMeta(a.status).label));
  breakdown("By Severity", tally(actions, (a) => sevLabel(a.severity)));
  breakdown("By Line", tally(actions, (a) => a.line || "—"));
  breakdown("By Department", tally(actions, (a) => a.department || "—"));
  breakdown("By Leader", tally(actions, (a) => a.leader_name || "—"));

  // Full actions table
  autoTable(doc, {
    startY: y + 2,
    head: [["Date", "Action #", "Status", "Severity", "Line", "Shift", "Leader", "Dept", "SKU", "Batch", "Notes"]],
    body: actions.map((a) => [
      fmtDate(a.recorded_at), a.action_no ?? "", statusMeta(a.status).label, sevLabel(a.severity),
      a.line ?? "", a.shift ?? "", a.leader_name ?? "", a.department ?? "", a.sku ?? "", a.batch ?? "",
      (a.description ?? "").slice(0, 60),
    ]),
    styles: { fontSize: 7, cellPadding: 1.2, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: margin, right: margin, top: 26 },
    didDrawPage: (data: any) => {
      if (data.pageNumber > 1) drawHeader();
      const page = doc.internal.pageSize;
      doc.setFontSize(7); doc.setTextColor(130);
      doc.text(`Generated ${generatedOn} by ${generatedBy}`, margin, page.getHeight() - 6);
      doc.text(`Page ${data.pageNumber}`, page.getWidth() - margin, page.getHeight() - 6, { align: "right" });
    },
  });

  doc.save(`quality-report-${Date.now()}.pdf`);
}

// ── Excel ────────────────────────────────────────────────────────────────────
const HEAD_STYLE = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E293B" } } };
const TITLE_STYLE = { font: { bold: true, sz: 14, color: { rgb: "141E3C" } } };

export function generateQualityReportExcel(input: QualityReportInput) {
  const { actions, periodLabel, generatedBy } = input;
  const s = summarize(actions);
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const sum: any[][] = [];
  sum.push([{ v: "Quality Report", s: TITLE_STYLE }]);
  sum.push([periodLabel]);
  sum.push([`Generated ${new Date().toLocaleString("en-GB")} by ${generatedBy}`]);
  sum.push([]);
  sum.push([{ v: "KPIs", s: { font: { bold: true } } }]);
  sum.push(["Total actions", s.total]);
  sum.push(["To do", s.todo]);
  sum.push(["In progress", s.in_progress]);
  sum.push(["Complete", s.complete]);
  sum.push(["High / Critical", s.highCritical]);
  const block = (title: string, rows: [string, number][]) => {
    sum.push([]);
    sum.push([{ v: title, s: HEAD_STYLE }, { v: "Count", s: HEAD_STYLE }]);
    for (const [k, v] of (rows.length ? rows : [["—", 0] as [string, number]])) sum.push([k, v]);
  };
  block("By Status", tally(actions, (a) => statusMeta(a.status).label));
  block("By Severity", tally(actions, (a) => sevLabel(a.severity)));
  block("By Line", tally(actions, (a) => a.line || "—"));
  block("By Department", tally(actions, (a) => a.department || "—"));
  block("By Leader", tally(actions, (a) => a.leader_name || "—"));
  const wsSum = XLSX.utils.aoa_to_sheet(sum);
  wsSum["!cols"] = [{ wch: 22 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  // Actions sheet
  const header = ["Date", "Action #", "Status", "Severity", "Line", "Shift", "Leader", "Department", "SKU", "Batch", "Labels", "Notes"];
  const rows: any[][] = [header.map((h) => ({ v: h, s: HEAD_STYLE }))];
  for (const a of actions) {
    rows.push([
      fmtDate(a.recorded_at), a.action_no ?? "", statusMeta(a.status).label, sevLabel(a.severity),
      a.line ?? "", a.shift ?? "", a.leader_name ?? "", a.department ?? "", a.sku ?? "", a.batch ?? "",
      (a.labels ?? []).join("; "), a.description ?? "",
    ]);
  }
  const wsAct = XLSX.utils.aoa_to_sheet(rows);
  wsAct["!cols"] = header.map((h) => ({ wch: h === "Notes" ? 45 : h === "Department" ? 18 : 14 }));
  XLSX.utils.book_append_sheet(wb, wsAct, "Actions");

  XLSX.writeFile(wb, `quality-report-${Date.now()}.xlsx`);
}
