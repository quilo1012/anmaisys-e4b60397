/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable cells are loosely typed */
// Printable Downtime & Reliability report: branded header band, KPI cards, and
// clean tables for records, machine risk and top problem machines. Consistent
// styling, repeated header, page footers — no overlaps.
//
// A moldura (banda, rodapé, cartões, defaults das tabelas) vive em `reportChrome`
// desde que o armazém passou a imprimir a sua própria folha; aqui fica só o que é
// desta folha.
import autoTable from "jspdf-autotable";
import {
  createReportChrome, statusChip,
  AMBER_TX, GREEN_BG, GREEN_TX, INK, NAVY, RED_BG, RED_TX, SUBTLE, AMBER_BG,
  type RGB,
} from "@/lib/reportChrome";
import { drawPatternMatrixSection, type ReportMatrix } from "@/lib/patternMatrixReport";

const riskChip = (s: string): { fillColor: RGB; textColor: RGB } => {
  const t = (s || "").toUpperCase();
  if (t === "HIGH") return { fillColor: RED_BG, textColor: RED_TX };
  if (t === "MEDIUM") return { fillColor: AMBER_BG, textColor: AMBER_TX };
  return { fillColor: GREEN_BG, textColor: GREEN_TX };
};

export interface DowntimeReportInput {
  rangeLabel: string;
  filtersLabel: string;
  kpis: { totalDowntime: string; active: number; avgMTTR: string; avgMTBF: string; wos: number; highRisk: number };
  records: { line: string; machine: string; category: string; reason: string; started: string; duration: string; excluded?: string; status: string }[];
  risks: { machine: string; failures: number; mtbf: string; risk: string; lastFailure: string }[];
  topProblems: { rank: number; machine: string; failures: number; topProblem: string }[];
  insights?: string[];
  /** 14 células por linha: dia 0 Dia, dia 0 Noite, dia 1 Dia, … */
  matrix?: ReportMatrix;
}

export async function generateDowntimeReportPDF(input: DowntimeReportInput, opts?: { output?: "save" | "bloburl" }) {
  const { rangeLabel, filtersLabel, kpis, records, risks, topProblems, insights = [], matrix } = input;
  const chrome = await createReportChrome({ title: "Downtime & Reliability", rangeLabel });
  const { doc } = chrome;

  chrome.kpiCards([
    { label: "Total Downtime", value: kpis.totalDowntime },
    { label: "Active Stoppages", value: String(kpis.active), valueColor: kpis.active > 0 ? AMBER_TX : INK, accent: kpis.active > 0 ? AMBER_TX : NAVY },
    { label: "Avg MTTR", value: kpis.avgMTTR },
    { label: "Avg MTBF", value: kpis.avgMTBF },
    { label: "Maintenance Orders", value: String(kpis.wos) },
    { label: "High-Risk Machines", value: String(kpis.highRisk), valueColor: kpis.highRisk > 0 ? RED_TX : INK, accent: kpis.highRisk > 0 ? RED_TX : NAVY },
  ]);
  chrome.captionLine(filtersLabel);

  const { commonTable } = chrome;

  // ── Pattern Matrix (day × shift) ───────────────────────────────────────
  if (matrix && matrix.rows.length) {
    drawPatternMatrixSection(chrome, matrix, { title: "Pattern Matrix — downtime by day & shift" });
  }

  // ── Downtime Records ───────────────────────────────────────────────────
  chrome.ensureSpace(40);
  chrome.sectionTitle("Downtime Records", records.length);
  autoTable(doc, {
    ...commonTable,
    startY: chrome.y,
    head: [["Line", "Machine", "Category", "Reason", "Started", "Duration", "Excluded (team activity)", "Status"]],
    body: records.length
      ? records.map((r) => [
          r.line, r.machine, r.category, r.reason, r.started,
          { content: r.duration, styles: { halign: "right" as const } },
          { content: r.excluded ?? "—", styles: { halign: "right" as const, textColor: SUBTLE } },
          { content: r.status, styles: { ...statusChip(r.status), fontStyle: "bold" as const, halign: "center" as const } },
        ])
      : [[{ content: "No downtime recorded in the selected range.", colSpan: 8, styles: { halign: "center" as const, textColor: SUBTLE, fontStyle: "italic" as const } }]],
    columnStyles: { 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "center" } },
  });
  chrome.afterTable();

  // ── Machine Risk Assessment ────────────────────────────────────────────
  if (risks.length) {
    chrome.ensureSpace(40);
    chrome.sectionTitle("Machine Risk Assessment", risks.length);
    autoTable(doc, {
      ...commonTable,
      startY: chrome.y,
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
    chrome.afterTable();
  }

  // ── Top Problem Machines ───────────────────────────────────────────────
  if (topProblems.length) {
    chrome.ensureSpace(40);
    chrome.sectionTitle("Top Problem Machines");
    autoTable(doc, {
      ...commonTable,
      startY: chrome.y,
      head: [["#", "Machine", "Failures", "Top Problem"]],
      body: topProblems.map((t) => [
        { content: String(t.rank), styles: { halign: "center" as const } },
        t.machine,
        { content: String(t.failures), styles: { halign: "center" as const } },
        t.topProblem,
      ]),
      columnStyles: { 0: { halign: "center", cellWidth: 12 }, 2: { halign: "center" } },
    });
    chrome.afterTable();
  }

  // ── Auto Insights ──────────────────────────────────────────────────────
  if (insights.length) {
    chrome.ensureSpace(30);
    chrome.sectionTitle("Auto Insights — suggested PM windows");
    autoTable(doc, {
      ...commonTable,
      startY: chrome.y,
      head: [["Recommendation"]],
      body: insights.map((s) => [s]),
      headStyles: { fillColor: [180, 83, 9] as any, textColor: 255 as any, fontStyle: "bold" as const },
    });
  }

  return chrome.finish(`downtime-reliability_${rangeLabel.replace(/[^0-9A-Za-z]+/g, "-")}`, opts);
}
