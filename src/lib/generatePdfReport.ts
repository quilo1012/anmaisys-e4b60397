import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import type { WorkOrder } from "@/hooks/useWorkOrders";
import { invokeFunction } from "@/lib/invokeFunction";
import { formatMinutes } from "@/lib/formatDuration";

const fmtMin = (m: number) => (m >= 60 ? formatMinutes(m) : `${m} min`);

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
  financials?: { totalPartsCost: number; totalLaborCost: number; totalOvertimeCost: number; grandTotal: number };
  /** Caller's role — used as a defense-in-depth client guard before generating. */
  callerRole?: string | null;
}

export function generatePdfReport(data: ReportData) {
  // Defense-in-depth client guard. Real authorization happens server-side
  // via authorizePdfGeneration(), but this prevents misuse if a caller forgets.
  if (data.callerRole && data.callerRole !== "admin" && data.callerRole !== "manager") {
    throw new Error("You don't have permission to generate this report.");
  }
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("AN Maintenance", 14, 20);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text("Work Orders Report", 14, 28);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(data.dateRange, 14, 34);
  doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, pageWidth - 14, 34, { align: "right" });

  doc.setDrawColor(0);
  doc.line(14, 37, pageWidth - 14, 37);

  // KPIs
  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Performance Summary", 14, 45);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const kpiY = 52;
  const kpis = [
    [`Total WOs: ${data.kpis.totalWOs}`, `Open WOs: ${data.kpis.openWOs}`],
    [`Avg Response: ${fmtMin(data.kpis.avgResponse)}`, `Avg MTTR: ${fmtMin(data.kpis.avgMTTR)}`],
    [`SLA Compliance: ${data.kpis.slaRate}%`, ""],
  ];
  kpis.forEach((row, i) => {
    doc.text(row[0], 14, kpiY + i * 6);
    if (row[1]) doc.text(row[1], 100, kpiY + i * 6);
  });

  // WO Table
  const tableData = data.workOrders.slice(0, 100).map((wo) => [
    `WO-${new Date(wo.created_at).getFullYear()}-${String(wo.wo_number).padStart(6, "0")}`,
    data.machineLineMap[wo.machine] || "—",
    wo.machine,
    wo.description.substring(0, 30),
    wo.status.toUpperCase(),
    format(new Date(wo.created_at), "dd/MM HH:mm"),
  ]);

  autoTable(doc, {
    startY: kpiY + 22,
    head: [["WO#", "Line", "Machine", "Problem", "Status", "Created"]],
    body: tableData,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  });

  // Financial summary
  if (data.financials && data.financials.grandTotal > 0) {
    doc.addPage();
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text("Financial Summary", 14, 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const finY = 28;
    doc.text(`Total Parts Cost: £${data.financials.totalPartsCost.toFixed(2)}`, 14, finY);
    doc.text(`Total Labor Cost: £${data.financials.totalLaborCost.toFixed(2)}`, 14, finY + 6);
    doc.text(`Total Overtime Cost: £${data.financials.totalOvertimeCost.toFixed(2)}`, 14, finY + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`Grand Total: £${data.financials.grandTotal.toFixed(2)}`, 14, finY + 22);
  }

  // Engineer ranking on new page if data exists
  if (data.engineerRanking.length > 0) {
    doc.addPage();
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text("Engineer Ranking", 14, 20);

    autoTable(doc, {
      startY: 26,
      head: [["#", "Engineer", "Score", "Completed WOs"]],
      body: data.engineerRanking.map((e, i) => [
        `${i + 1}`,
        e.name,
        `${e.score}`,
        `${e.completed}`,
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: "bold" },
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 10, { align: "right" });
    doc.text("AN Maintenance System", 14, doc.internal.pageSize.getHeight() - 10);
  }

  doc.save(`AN_Maintenance_Report_${format(new Date(), "yyyyMMdd_HHmm")}.pdf`);
}
