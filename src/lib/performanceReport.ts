/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable cells are loosely typed */
// Printable Production Performance report: logo header, overall KPI, per-line
// table (target / actual / gap / %), and the open quality actions for the period.
// jsPDF + autoTable are loaded on demand inside the export function to keep them
// out of any route bundle that statically imports this module.
import logoUrl from "@/assets/appliedlogo.jpeg";

export interface PerfReportLine {
  line: string;
  leader: string | null;
  target: number;
  actual: number;
  eff: number;
}
export interface PerfReportOpenAction {
  recorded_at: string;
  action_no: string | null;
  line: string | null;
  shift: string | null;
  severity: string | null;
  description: string | null;
}
export interface PerfReportInput {
  periodLabel: string;
  filtersLabel: string;
  lines: PerfReportLine[];
  totalTarget: number;
  totalActual: number;
  openActions: PerfReportOpenAction[];
  generatedBy: string;
}

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }); }
  catch { return iso?.slice(0, 10) ?? ""; }
};

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

export async function generatePerformanceReportPDF(input: PerfReportInput) {
  const { periodLabel, filtersLabel, lines, totalTarget, totalActual, openActions, generatedBy } = input;
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");
  const overall = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;

  const drawHeader = () => {
    if (logo) { try { doc.addImage(logo, "JPEG", margin, 8, 22, 12); } catch { /* ignore */ } }
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(20, 30, 60);
    doc.text("Production Performance", pageW - margin, 14, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(periodLabel, pageW - margin, 20, { align: "right" });
    doc.setDrawColor(200); doc.line(margin, 24, pageW - margin, 24);
  };
  drawHeader();

  // Overall KPI
  let y = 32;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20, 30, 60);
  doc.text("Overall", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(0);
  doc.text(`${overall.toFixed(0)}%   ·   ${n(totalActual)} / ${n(totalTarget)}   ·   ${lines.length} ${lines.length === 1 ? "line" : "lines"} scored`, margin, y);
  y += 4;
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(filtersLabel, margin, y);
  y += 6;
  doc.setTextColor(0);

  // Per-line table
  autoTable(doc, {
    startY: y,
    head: [["Line", "Leader", "Target", "Actual", "Gap", "%"]],
    body: lines.map((l) => [
      l.line, l.leader ?? "—", n(l.target), n(l.actual), n(l.actual - l.target), `${l.eff.toFixed(0)}%`,
    ]),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Open quality actions for the period
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20, 30, 60);
  doc.text(`Open Quality Actions (${openActions.length})`, margin, y);
  y += 3;
  doc.setTextColor(0);
  autoTable(doc, {
    startY: y,
    head: [["Date", "Action #", "Line", "Shift", "Severity", "Description"]],
    body: openActions.length
      ? openActions.map((a) => [fmtDate(a.recorded_at), a.action_no ?? "", a.line ?? "", a.shift ?? "", a.severity ?? "", (a.description ?? "").slice(0, 70)])
      : [["—", "", "", "", "", "No open actions in this period"]],
    styles: { fontSize: 8, cellPadding: 1.5, overflow: "linebreak" },
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

  doc.save(`production-performance-${Date.now()}.pdf`);
}
