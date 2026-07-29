import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import type { WorkOrder } from "@/hooks/useWorkOrders";
import { invokeFunction } from "@/lib/invokeFunction";
import { formatMinutes } from "@/lib/formatDuration";
import {
  NAVY, INK, SUBTLE, CARD_BORDER, GREEN_TX, AMBER_TX, RED_TX,
  REPORT_MARGIN as M, HEADER_H, tableStyles,
  loadLogoDataUrl, drawReportHeader, drawReportFooter, drawKpiCard,
  type RGB,
} from "@/lib/reportTheme";

const fmtMin = (m: number | null | undefined) => {
  if (m === null || m === undefined || Number.isNaN(Number(m))) return "—";
  const minutes = Math.max(0, Math.round(Number(m)));
  return minutes >= 60 ? formatMinutes(minutes) : `${minutes} min`;
};

/**
 * Server-side authorization for PDF generation.
 * Returns true if the caller (admin/manager) is allowed to proceed.
 * Throws with a friendly message on 403 / network failure.
 */
export async function authorizePdfGeneration(opts?: {
  reportType?: string;
  entityId?: string;
}): Promise<true> {
  const { data, error } = await invokeFunction<{ ok?: boolean; error?: string }>(
    "generate-wo-pdf-auth",
    {
      reportType: opts?.reportType ?? "wo_report",
      entityId: opts?.entityId,
    }
  );
  if (error) {
    const status = (error as any)?.context?.status;
    if (status === 403) throw new Error("You don't have permission to generate this report.");
    if (status === 401) throw new Error("Your session has expired. Please sign in again.");
    throw new Error("Could not authorize report generation. Try again.");
  }
  if (!data?.ok) throw new Error("Report generation was not authorized.");
  return true;
}

interface ReportData {
  workOrders: WorkOrder[];
  machineLineMap: Record<string, string>;
  engineerRanking: { name: string; score: number; completed: number }[];
  kpis: { avgResponse: number; avgMTTR: number; totalWOs: number; openWOs: number; slaRate: number };
  dateRange: string;
  /** Shift label for the header, e.g. "Day (06–18)". Omit for all shifts. */
  shiftLabel?: string;
  /** Name shown in the footer's confidentiality line. */
  generatedBy?: string | null;
  financials?: { totalPartsCost: number; totalLaborCost: number; totalOvertimeCost: number; grandTotal: number };
  /** Caller's role — used as a defense-in-depth client guard before generating. */
  callerRole?: string | null;
}

export async function generatePdfReport(data: ReportData) {
  // Defense-in-depth client guard. Real authorization happens server-side
  // via authorizePdfGeneration(), but this prevents misuse if a caller forgets.
  if (
    data.callerRole &&
    data.callerRole !== "admin" &&
    data.callerRole !== "manager" &&
    data.callerRole !== "maintenance_manager"
  ) {
    throw new Error("You don't have permission to generate this report.");
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");
  const subtitle = [data.dateRange, data.shiftLabel].filter(Boolean).join("  ·  ");

  const header = () => drawReportHeader(doc, { title: "Maintenance Orders", subtitle, logo });
  const footer = (pageNumber: number) =>
    drawReportFooter(doc, { pageNumber, generatedOn, generatedBy: data.generatedBy });
  header();

  // ── KPI cards ─────────────────────────────────────────────────────────
  // Colour carries meaning, so the reader sees the exception before the number:
  // SLA is scored against the same 80/95 thresholds the Analytics page uses, and
  // open orders read amber only when there are any.
  const sla = data.kpis.slaRate;
  const slaTx: RGB = sla >= 95 ? GREEN_TX : sla >= 80 ? AMBER_TX : RED_TX;
  const openTx: RGB = data.kpis.openWOs > 0 ? AMBER_TX : GREEN_TX;

  const cardY = HEADER_H + 6, cardH = 22, gap = 4;
  const cardW = (pageW - M * 2 - gap * 3) / 4;
  const cards: Array<{ label: string; value: string; color: RGB }> = [
    { label: "Total orders", value: String(data.kpis.totalWOs), color: INK },
    { label: "Still open", value: String(data.kpis.openWOs), color: openTx },
    { label: "Avg response", value: fmtMin(data.kpis.avgResponse), color: INK },
    { label: "SLA compliance", value: `${sla}%`, color: slaTx },
  ];
  cards.forEach((c, i) => drawKpiCard(doc, {
    x: M + i * (cardW + gap), y: cardY, w: cardW, h: cardH,
    label: c.label, value: c.value, valueColor: c.color, accent: c.color,
  }));

  let y = cardY + cardH + 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...SUBTLE);
  doc.text(`Avg repair time (MTTR): ${fmtMin(data.kpis.avgMTTR)}`, M, y);
  y += 5;

  // ── Orders ────────────────────────────────────────────────────────────
  const statusChip = (status: string): { fillColor: RGB; textColor: RGB } => {
    const s = status.toLowerCase();
    if (s === "open") return { fillColor: [254, 226, 226], textColor: RED_TX };
    if (s === "in_progress") return { fillColor: [254, 243, 199], textColor: AMBER_TX };
    return { fillColor: [209, 250, 229], textColor: GREEN_TX };
  };

  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK);
  doc.text(`Orders  (${data.workOrders.length})`, M, y);
  y += 3;
  doc.setTextColor(0);

  autoTable(doc, {
    startY: y,
    head: [["WO#", "Line", "Machine", "Problem", "Status", "Created"]],
    body: data.workOrders.length
      ? data.workOrders.map((wo) => [
          `WO-${new Date(wo.created_at).getFullYear()}-${String(wo.wo_number).padStart(6, "0")}`,
          data.machineLineMap[wo.machine] || "—",
          wo.machine || "—",
          (wo.description || "—").slice(0, 60),
          {
            content: wo.status.replace(/_/g, " ").toUpperCase(),
            styles: { ...statusChip(wo.status), fontStyle: "bold" as const, halign: "center" as const },
          },
          format(new Date(wo.created_at), "dd/MM HH:mm"),
        ])
      : [[{ content: "No maintenance orders in this period.", colSpan: 6, styles: { halign: "center" as const, textColor: SUBTLE, fontStyle: "italic" as const } }]],
    ...tableStyles,
    styles: { ...tableStyles.styles, fontSize: 7.5, overflow: "linebreak" as const },
    columnStyles: { 0: { fontStyle: "bold" as const, cellWidth: 27 }, 4: { halign: "center" as const, cellWidth: 22 }, 5: { cellWidth: 22 } },
    margin: { left: M, right: M, top: HEADER_H + 4 },
    didDrawPage: (d: { pageNumber: number }) => {
      if (d.pageNumber > 1) header();
      footer(d.pageNumber);
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;

  // ── Engineer ranking ──────────────────────────────────────────────────
  if (data.engineerRanking.length > 0) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text("Engineer ranking", M, y);
    y += 3;
    doc.setTextColor(0);
    autoTable(doc, {
      startY: y,
      head: [["#", "Engineer", "Score", "Completed"]],
      body: data.engineerRanking.map((e, i) => [
        `${i + 1}`,
        e.name,
        { content: String(e.score), styles: { halign: "right" as const } },
        { content: String(e.completed), styles: { halign: "right" as const, fontStyle: "bold" as const } },
      ]),
      ...tableStyles,
      columnStyles: { 0: { cellWidth: 10 }, 2: { halign: "right" as const }, 3: { halign: "right" as const } },
      margin: { left: M, right: M, top: HEADER_H + 4 },
      didDrawPage: (d: { pageNumber: number }) => {
        if (d.pageNumber > 1) header();
        footer(d.pageNumber);
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
  }

  // ── Financial summary ─────────────────────────────────────────────────
  if (data.financials && data.financials.grandTotal > 0) {
    const f = data.financials;
    const gbp = (v: number) => `£${v.toFixed(2)}`;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text("Cost summary", M, y);
    y += 3;
    doc.setTextColor(0);
    autoTable(doc, {
      startY: y,
      head: [["Item", "Amount"]],
      body: [
        ["Parts", { content: gbp(f.totalPartsCost), styles: { halign: "right" as const } }],
        ["Labour", { content: gbp(f.totalLaborCost), styles: { halign: "right" as const } }],
        ["Overtime", { content: gbp(f.totalOvertimeCost), styles: { halign: "right" as const } }],
      ],
      foot: [[
        { content: "TOTAL", styles: { fontStyle: "bold" as const } },
        { content: gbp(f.grandTotal), styles: { halign: "right" as const, fontStyle: "bold" as const } },
      ]],
      ...tableStyles,
      footStyles: { fillColor: CARD_BORDER, textColor: INK, fontStyle: "bold" as const },
      margin: { left: M, right: M, top: HEADER_H + 4 },
      didDrawPage: (d: { pageNumber: number }) => {
        if (d.pageNumber > 1) header();
        footer(d.pageNumber);
      },
    });
  }

  // The first page never passes through didDrawPage, so its footer is drawn here.
  doc.setPage(1);
  footer(1);

  doc.save(`AN_Maintenance_Orders_${format(new Date(), "yyyyMMdd_HHmm")}.pdf`);
}
