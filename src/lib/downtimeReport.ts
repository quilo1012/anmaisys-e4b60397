/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable cells are loosely typed */
// Printable Downtime & Reliability report: branded header band, KPI cards, and
// clean tables for records, machine risk and top problem machines. Consistent
// styling, repeated header, page footers — no overlaps.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoUrl from "@/assets/appliedlogo.jpeg";
import { DAYS } from "@/lib/downtimeHeatmap";

type RGB = [number, number, number];
const NAVY: RGB = [30, 58, 138];
const INK: RGB = [15, 23, 42];
const SUBTLE: RGB = [100, 116, 139];
const CARD_BG: RGB = [248, 250, 252];
const CARD_BORDER: RGB = [226, 232, 240];
const GREEN_BG: RGB = [209, 250, 229], GREEN_TX: RGB = [4, 120, 87];
const AMBER_BG: RGB = [254, 243, 199], AMBER_TX: RGB = [180, 83, 9];
const RED_BG: RGB = [254, 226, 226], RED_TX: RGB = [185, 28, 28];

const riskChip = (s: string): { fillColor: RGB; textColor: RGB } => {
  const t = (s || "").toUpperCase();
  if (t === "HIGH") return { fillColor: RED_BG, textColor: RED_TX };
  if (t === "MEDIUM") return { fillColor: AMBER_BG, textColor: AMBER_TX };
  return { fillColor: GREEN_BG, textColor: GREEN_TX };
};
const statusChip = (s: string): { fillColor: RGB; textColor: RGB } => {
  const t = (s || "").toLowerCase();
  if (t.includes("active") || t.includes("ongoing")) return { fillColor: AMBER_BG, textColor: AMBER_TX };
  return { fillColor: GREEN_BG, textColor: GREEN_TX };
};

export interface DowntimeReportInput {
  rangeLabel: string;
  filtersLabel: string;
  kpis: { totalDowntime: string; active: number; avgMTTR: string; avgMTBF: string; wos: number; highRisk: number };
  records: { line: string; machine: string; category: string; reason: string; started: string; duration: string; status: string }[];
  risks: { machine: string; failures: number; mtbf: string; risk: string; lastFailure: string }[];
  topProblems: { rank: number; machine: string; failures: number; topProblem: string }[];
  insights?: string[];
  matrix?: {
    rows: { line: string; cells: string[]; total: string }[]; // cells: 14 (dayIdx*2 + Day/Night)
    totals: string[]; // 14
    grandTotal: string;
  };
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

export async function generateDowntimeReportPDF(input: DowntimeReportInput, opts?: { output?: "save" | "bloburl" }) {
  const { rangeLabel, filtersLabel, kpis, records, risks, topProblems, insights = [], matrix } = input;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");

  const drawHeader = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 24, "F");
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, 5, 24, 13, 2, 2, "F");
    if (logo) { try { doc.addImage(logo, "JPEG", margin + 1.5, 6.3, 21, 10.4); } catch { /* ignore */ } }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text("Downtime & Reliability", pageW - margin, 11, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(203, 213, 225);
    doc.text(rangeLabel, pageW - margin, 17.5, { align: "right" });
    doc.setTextColor(0);
  };
  const drawFooter = (data?: any) => {
    doc.setDrawColor(...CARD_BORDER);
    doc.line(margin, pageH - 9, pageW - margin, pageH - 9);
    doc.setFontSize(7); doc.setTextColor(...SUBTLE); doc.setFont("helvetica", "normal");
    doc.text(`Downtime & Reliability · Generated ${generatedOn}`, margin, pageH - 5);
    const page = data?.pageNumber ?? doc.getNumberOfPages();
    doc.text(`Page ${page}`, pageW - margin, pageH - 5, { align: "right" });
  };
  drawHeader();

  // ── KPI cards ──────────────────────────────────────────────────────────
  const cardY = 30, cardH = 20, gap = 4, cols = 6;
  const cardW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
  const card = (i: number, label: string, value: string, valueColor: RGB, accent: RGB) => {
    const x = margin + i * (cardW + gap);
    doc.setFillColor(...CARD_BG); doc.setDrawColor(...CARD_BORDER);
    doc.roundedRect(x, cardY, cardW, cardH, 2, 2, "FD");
    doc.setFillColor(...accent);
    doc.roundedRect(x, cardY, 1.6, cardH, 0.8, 0.8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); doc.setTextColor(...SUBTLE);
    doc.text(label.toUpperCase(), x + 4.5, cardY + 6);
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...valueColor);
    doc.text(value, x + 4.5, cardY + 15);
  };
  card(0, "Total Downtime", kpis.totalDowntime, INK, NAVY);
  card(1, "Active Stoppages", String(kpis.active), kpis.active > 0 ? AMBER_TX : INK, kpis.active > 0 ? AMBER_TX : NAVY);
  card(2, "Avg MTTR", kpis.avgMTTR, INK, NAVY);
  card(3, "Avg MTBF", kpis.avgMTBF, INK, NAVY);
  card(4, "Maintenance Orders", String(kpis.wos), INK, NAVY);
  card(5, "High-Risk Machines", String(kpis.highRisk), kpis.highRisk > 0 ? RED_TX : INK, kpis.highRisk > 0 ? RED_TX : NAVY);

  let y = cardY + cardH + 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...SUBTLE);
  doc.text(filtersLabel, margin, y);
  y += 5;

  const sectionTitle = (title: string, count?: number) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text(count === undefined ? title : `${title}  (${count})`, margin, y);
    y += 2.5;
  };

  const commonTable = {
    styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak" as const, lineColor: CARD_BORDER, lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: 255 as any, fontStyle: "bold" as const },
    alternateRowStyles: { fillColor: [248, 250, 252] as any },
    margin: { left: margin, right: margin, top: 28 },
    didDrawPage: (data: any) => { if (data.pageNumber > 1) drawHeader(); drawFooter(data); },
  };

  // ── Pattern Matrix (day × shift) ───────────────────────────────────────
  if (matrix && matrix.rows.length) {
    sectionTitle("Pattern Matrix — downtime by day & shift");
    const head: any[] = [{ content: "Line", styles: { halign: "left" } }];
    DAYS.forEach((d) => { head.push(`${d} D`); head.push(`${d} N`); });
    head.push("Total");
    autoTable(doc, {
      ...commonTable,
      startY: y,
      head: [head],
      body: matrix.rows.map((r) => [
        { content: r.line, styles: { fontStyle: "bold" as const, halign: "left" as const } },
        ...r.cells.map((c) => ({ content: c, styles: { halign: "center" as const, textColor: (c === "—" ? SUBTLE : INK) as any } })),
        { content: r.total, styles: { halign: "right" as const, fontStyle: "bold" as const } },
      ]),
      foot: [[
        { content: "Totals (wall-clock)", styles: { fontStyle: "bold" as const, halign: "left" as const } },
        ...matrix.totals.map((c) => ({ content: c, styles: { halign: "center" as const } })),
        { content: matrix.grandTotal, styles: { halign: "right" as const } },
      ]],
      styles: { ...commonTable.styles, fontSize: 6.5, cellPadding: 1.2 },
      footStyles: { fillColor: CARD_BORDER as any, textColor: INK as any, fontStyle: "bold" as const },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ── Downtime Records ───────────────────────────────────────────────────
  if (y > pageH - 40) { doc.addPage(); drawHeader(); y = 30; }
  sectionTitle("Downtime Records", records.length);
  autoTable(doc, {
    ...commonTable,
    startY: y,
    head: [["Line", "Machine", "Category", "Reason", "Started", "Duration", "Status"]],
    body: records.length
      ? records.map((r) => [
          r.line, r.machine, r.category, r.reason, r.started,
          { content: r.duration, styles: { halign: "right" as const } },
          { content: r.status, styles: { ...statusChip(r.status), fontStyle: "bold" as const, halign: "center" as const } },
        ])
      : [[{ content: "No downtime recorded in the selected range.", colSpan: 7, styles: { halign: "center" as const, textColor: SUBTLE, fontStyle: "italic" as const } }]],
    columnStyles: { 5: { halign: "right" }, 6: { halign: "center" } },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Machine Risk Assessment ────────────────────────────────────────────
  if (risks.length) {
    if (y > pageH - 40) { doc.addPage(); drawHeader(); y = 30; }
    sectionTitle("Machine Risk Assessment", risks.length);
    autoTable(doc, {
      ...commonTable,
      startY: y,
      head: [["Machine", "Failures", "MTBF (hrs)", "Risk", "Last Failure"]],
      body: risks.map((r) => [
        r.machine,
        { content: String(r.failures), styles: { halign: "center" as const } },
        { content: r.mtbf, styles: { halign: "center" as const } },
        { content: r.risk, styles: { ...riskChip(r.risk), fontStyle: "bold" as const, halign: "center" as const } },
        r.lastFailure,
      ]),
      columnStyles: { 1: { halign: "center" }, 2: { halign: "center" }, 3: { halign: "center" } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ── Top Problem Machines ───────────────────────────────────────────────
  if (topProblems.length) {
    if (y > pageH - 40) { doc.addPage(); drawHeader(); y = 30; }
    sectionTitle("Top Problem Machines");
    autoTable(doc, {
      ...commonTable,
      startY: y,
      head: [["#", "Machine", "Failures", "Top Problem"]],
      body: topProblems.map((t) => [
        { content: String(t.rank), styles: { halign: "center" as const } },
        t.machine,
        { content: String(t.failures), styles: { halign: "center" as const } },
        t.topProblem,
      ]),
      columnStyles: { 0: { halign: "center", cellWidth: 12 }, 2: { halign: "center" } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ── Auto Insights ──────────────────────────────────────────────────────
  if (insights.length) {
    if (y > pageH - 30) { doc.addPage(); drawHeader(); y = 30; }
    sectionTitle("Auto Insights — suggested PM windows");
    autoTable(doc, {
      ...commonTable,
      startY: y,
      head: [["Recommendation"]],
      body: insights.map((s) => [s]),
      headStyles: { fillColor: [180, 83, 9] as any, textColor: 255 as any, fontStyle: "bold" as const },
    });
  }

  if (opts?.output === "bloburl") return doc.output("bloburl") as unknown as string;
  doc.save(`downtime-reliability_${rangeLabel.replace(/[^0-9A-Za-z]+/g, "-")}.pdf`);
  return undefined;
}
