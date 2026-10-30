/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable + xlsx-js-style cells are loosely typed */
/**
 * The maintenance shift report as a file: PDF, TXT or Excel.
 *
 * All three are drawn from the one `ShiftReport` the builder returns — the same items,
 * the same totals, the same NOT VALIDATED list — so a PDF sent to the manager and a
 * TXT pasted into Teams cannot say different things. Nothing here reads the database
 * or computes a figure; it only lays out what the report already holds.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
import {
  drawKpiCard, drawReportFooter, drawReportHeader, loadLogoDataUrl,
  HEADER_H, REPORT_MARGIN, tableStyles, GREEN_TX, RED_TX, RED_BG, INK, SUBTLE,
} from "@/lib/reportTheme";
import {
  REPORT_MIN_MINUTES, HANDOVER_MAX_AGE_MS, lineLabelOf, londonStamp, reportFileName, shiftLabel,
  type ShiftReport,
} from "@/lib/maintenanceShiftReport";

export type ReportFormat = "pdf" | "txt" | "xlsx";

const MIME: Record<ReportFormat, string> = {
  pdf: "application/pdf",
  txt: "text/plain;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("/");
const stamp = (s: string | null) => (s ? londonStamp(new Date(s)) : "still stopped");
const FINISHED = new Set(["finished", "closed", "completed", "force_closed"]);

export async function reportToFile(report: ShiftReport, format: ReportFormat): Promise<File> {
  const name = reportFileName(report.window, format);
  if (format === "txt") return new File([report.text], name, { type: MIME.txt });
  if (format === "xlsx") return new File([reportToXlsx(report)], name, { type: MIME.xlsx });
  return new File([await reportToPdf(report)], name, { type: MIME.pdf });
}

function summaryRows(r: ShiftReport): [string, string | number][] {
  const listedMinutes = r.items.reduce((n, it) => n + it.totalMinutes, 0);
  const listedStops = r.items.reduce((n, it) => n + it.stops.length, 0);
  return [
    ["Shift", shiftLabel(r.window.shift)],
    ["Date", ddmmyyyy(r.window.sessionDate)],
    ["Period (Europe/London)", `${londonStamp(r.window.start)} → ${londonStamp(r.window.end)}`],
    ["Generated", `${londonStamp(r.generatedAt)}${r.generatedBy ? ` by ${r.generatedBy}` : ""}`],
    ["Source", "downtime_events, work_orders, wo_downtime_exclusions"],
    ["Validation", r.problems.length ? `NOT VALIDATED — ${r.problems.length} record(s) disagree` : "Checked: totals match the stops read"],
    ["Stops recorded", r.stopsRead],
    ["Work orders", r.ordersRead],
    [`Stops over ${REPORT_MIN_MINUTES} min`, listedStops],
    [`Minutes over ${REPORT_MIN_MINUTES} min`, listedMinutes],
    ["Planned stops not counted", r.plannedStops],
    ["Team-activity minutes excluded", r.excludedMinutes],
    ["Still open", r.openItems],
    ["Resolved", r.resolvedItems],
  ];
}

// ── Excel ─────────────────────────────────────────────────────────────────

export function reportToXlsx(r: ShiftReport): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const bold = { font: { bold: true } };
  const head = (cells: string[]) => cells.map((v) => ({ v, t: "s", s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E3A8A" } } } }));

  const sum = XLSX.utils.aoa_to_sheet([
    [{ v: "Maintenance Report", t: "s", s: { font: { bold: true, sz: 14 } } }],
    [],
    ...summaryRows(r).map(([k, v]) => [{ v: k, t: "s", s: bold }, v]),
  ]);
  sum["!cols"] = [{ wch: 32 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, sum, "Summary");

  const listed = XLSX.utils.aoa_to_sheet([
    head(["Line", "WO", "What was done", "Status", "Minutes", "Still stopped", "From previous shift"]),
    ...r.items.flatMap(({ wo, stops }) => stops.map((s) => [
      lineLabelOf(wo.line_at_time, wo.line_name), wo.wo_number ?? "",
      (wo.resolution_notes || wo.description || "No description recorded").trim(),
      wo.status, s.minutes, s.ongoing ? "yes" : "", s.carriedOver ? "yes" : "",
    ])),
  ]);
  listed["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 50 }, { wch: 13 }, { wch: 9 }, { wch: 13 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, listed, `Over ${REPORT_MIN_MINUTES} min`);

  // Every stop read, with what the report did with it: the sheet to check the
  // report against, row by row, and the same columns as docs/verify's SQL.
  const all = XLSX.utils.aoa_to_sheet([
    head(["WO", "Line", "Problem", "Status", "Stopped (London)", "Resumed (London)", "Minutes in shift", "Team activity excluded (min)", "In report"]),
    ...r.rows.map((x) => [
      x.woNumber ?? "", x.line, x.description, x.status, stamp(x.stoppedAt), stamp(x.resumedAt),
      x.minutes ?? "", x.excludedMinutes || "", x.verdict,
    ]),
  ]);
  all["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 36 }, { wch: 13 }, { wch: 17 }, { wch: 17 }, { wch: 15 }, { wch: 26 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, all, "All stops read");

  if (r.handover) {
    const h = XLSX.utils.aoa_to_sheet([
      [{ v: `Order status at ${londonStamp(r.generatedAt)}`, t: "s", s: bold }],
      head(["WO", "Line", "Problem", "Status", "Line stopped since", "Paused — reason as recorded", "Engineer"]),
      ...r.handover.pending.map((p) => [
        p.wo_number ?? "", lineLabelOf(p.line_at_time, p.line_name), (p.description ?? "").trim(), p.status,
        p.stopped_since ? londonStamp(new Date(p.stopped_since)) : "",
        p.paused_at ? (p.pause_reason?.trim() || "no reason recorded") : "",
        p.engineer_name?.trim() || "not assigned",
      ]),
      ...(r.handover.notes ? [[], [{ v: "Handover notes", t: "s", s: bold }, r.handover.notes]] : []),
    ]);
    h["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 36 }, { wch: 13 }, { wch: 18 }, { wch: 30 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, h, "Handover");
  }

  if (r.problems.length) {
    const p = XLSX.utils.aoa_to_sheet([head(["NOT VALIDATED — the records disagree"]), ...r.problems.map((x) => [x])]);
    p["!cols"] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(wb, p, "Not validated");
  }

  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

// ── PDF ───────────────────────────────────────────────────────────────────

export async function reportToPdf(r: ShiftReport): Promise<ArrayBuffer> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const logo = await loadLogoDataUrl();
  const subtitle = `${r.window.shift === "day" ? "Day" : "Night"} Shift · ${ddmmyyyy(r.window.sessionDate)}`;
  const generatedOn = londonStamp(r.generatedAt);
  const header = () => drawReportHeader(doc, { title: "Maintenance Report", subtitle, logo });
  header();

  let y = HEADER_H + 8;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK);
  for (const [k, v] of summaryRows(r).slice(0, 5)) {
    doc.setFont("helvetica", "bold"); doc.text(`${k}:`, REPORT_MARGIN, y);
    doc.setFont("helvetica", "normal"); doc.text(String(v), REPORT_MARGIN + 42, y);
    y += 5;
  }
  y += 2;

  const listedStops = r.items.reduce((n, it) => n + it.stops.length, 0);
  const listedMinutes = r.items.reduce((n, it) => n + it.totalMinutes, 0);
  const w = (pageW - REPORT_MARGIN * 2 - 3 * 4) / 4;
  const cards: [string, string, boolean?][] = [
    ["Stops recorded", `${r.stopsRead}`],
    [`Over ${REPORT_MIN_MINUTES} min`, `${listedStops}`],
    ["Minutes over 15", `${listedMinutes}`],
    ["Not validated", `${r.problems.length}`, r.problems.length > 0],
  ];
  cards.forEach(([label, value, bad], i) =>
    drawKpiCard(doc, { x: REPORT_MARGIN + i * (w + 4), y, w, h: 20, label, value, valueColor: bad ? RED_TX : INK, accent: bad ? RED_TX : undefined }));
  y += 26;

  doc.setFontSize(8); doc.setTextColor(...SUBTLE);
  doc.text(
    `${r.ordersRead} work order(s) · ${r.plannedStops} planned stop(s) not counted · ${r.excludedMinutes} min team activity excluded · ` +
      `${r.openItems} still open · ${r.resolvedItems} resolved`,
    REPORT_MARGIN, y,
  );
  y += 4;

  const table = (title: string, head: string[], body: any[][], startY: number) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK);
    doc.text(title, REPORT_MARGIN, startY + 5);
    autoTable(doc, {
      startY: startY + 8, head: [head], body, ...tableStyles,
      margin: { top: HEADER_H + 6, left: REPORT_MARGIN, right: REPORT_MARGIN, bottom: 14 },
      didDrawPage: header,
    });
    return (doc as any).lastAutoTable.finalY as number;
  };

  if (r.items.length) {
    y = table(`Stops over ${REPORT_MIN_MINUTES} minutes`, ["Line", "WO", "What was done", "Status", "Downtime"],
      r.items.map(({ wo, stops }) => [
        lineLabelOf(wo.line_at_time, wo.line_name), wo.wo_number ? `WO-${wo.wo_number}` : "—",
        (wo.resolution_notes || wo.description || "No description recorded").trim(),
        FINISHED.has(wo.status) ? wo.status : `${wo.status} (in progress)`,
        stops.map((s) => `${s.minutes}m${s.ongoing ? " so far" : ""}${s.carriedOver ? " (prev. shift)" : ""}`).join("; "),
      ]), y);
  } else if (!r.problems.length) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...GREEN_TX);
    doc.text(`No line stoppage over ${REPORT_MIN_MINUTES} minutes recorded this shift.`, REPORT_MARGIN, y + 6);
    y += 10;
  }

  if (r.problems.length) {
    autoTable(doc, {
      startY: y + 6, head: [["NOT VALIDATED — the records disagree"]], body: r.problems.map((p) => [p]),
      ...tableStyles, headStyles: { fillColor: RED_TX, textColor: 255, fontStyle: "bold" }, bodyStyles: { fillColor: RED_BG },
      margin: { top: HEADER_H + 6, left: REPORT_MARGIN, right: REPORT_MARGIN, bottom: 14 }, didDrawPage: header,
    });
    y = (doc as any).lastAutoTable.finalY;
  }

  if (r.handover) {
    y = table(`Handover — order status at ${generatedOn}`, ["WO", "Line", "Problem", "Status", "Line stopped since", "Engineer"],
      r.handover.pending.map((p) => [
        p.wo_number ? `WO-${p.wo_number}` : "—", lineLabelOf(p.line_at_time, p.line_name), (p.description ?? "").trim() || "—",
        p.paused_at ? `${p.status} · paused: ${p.pause_reason?.trim() || "no reason recorded"}` : p.status,
        p.stopped_since ? londonStamp(new Date(p.stopped_since)) : "—",
        p.engineer_name?.trim() || "not assigned",
      ]), y + 2);
    if (r.handover.notes) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...INK);
      doc.text(`Handover notes${r.generatedBy ? ` (${r.generatedBy})` : ""}:`, REPORT_MARGIN, y + 7);
      doc.setFont("helvetica", "normal");
      doc.text(doc.splitTextToSize(r.handover.notes, pageW - REPORT_MARGIN * 2), REPORT_MARGIN, y + 12);
    }
  } else {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...SUBTLE);
    doc.text(
      doc.splitTextToSize(`Handover not included: this shift ended more than ${HANDOVER_MAX_AGE_MS / 3_600_000} hours before the report was generated, and today's order statuses are not the ones it was handed over with.`, pageW - REPORT_MARGIN * 2),
      REPORT_MARGIN, y + 7,
    );
  }

  if (r.rows.length) {
    doc.addPage(); header();
    table("Every stop read, and what the report did with it", ["WO", "Line", "Stopped", "Resumed", "Min", "Excl.", "In report"],
      r.rows.map((x) => [x.woNumber ? `WO-${x.woNumber}` : "—", x.line, stamp(x.stoppedAt), stamp(x.resumedAt), x.minutes ?? "—", x.excludedMinutes || "", x.verdict]),
      HEADER_H + 2);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    drawReportFooter(doc, { pageNumber: i, generatedOn, generatedBy: r.generatedBy });
  }
  return doc.output("arraybuffer");
}
