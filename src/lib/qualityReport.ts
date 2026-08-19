/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable + xlsx-js-style cells are loosely typed */
// Professional Quality report exports for the Quality Actions data:
//   - PDF (jsPDF + autoTable): printable report with logo header, KPIs, per-leader tracking, full list.
//   - Excel (xlsx-js-style): styled workbook with a Summary sheet + an Actions sheet.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
import logoUrl from "@/assets/appliedlogo.jpeg";
import { severityMeta, validationMeta } from "@/lib/qualityConstants";
import { leaderTracking, pointsLabel } from "@/lib/leaderTracking";

export interface QualityReportAction {
  recorded_at: string;
  action_no: string | null;
  // No `status`. The To do / In progress / Complete board is gone and nothing writes
  // the column any more, so a report that asked for it would be asking every caller
  // for a value none of them can mean anything by. `validation_status` below is the
  // lifecycle this report prints.
  severity: string | null;
  line: string | null;
  shift: string | null;
  leader_name: string | null;
  department: string | null;
  sku: string | null;
  batch: string | null;
  labels: string[] | null;
  description: string | null;
  /** Quality's verdict — a rejected action costs the leader nothing. */
  validation_status?: string | null;
  /** Filed by a manager; until then the action is still standing. */
  closed_at?: string | null;
  /** 'quality' | 'safety' | undefined (rows recorded before the column existed). */
  domain?: string | null;
  safety_kind?: string | null;
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

/**
 * Counted on the validation lifecycle, not on To do / In progress / Complete.
 *
 * That board is gone: an action is written down because it already happened, so
 * nothing writes `status` any more and every new row carries the column's default.
 * Counting it here would have printed a backlog that grew with every action logged
 * and meant nothing — on a signed document, which is the worst place for it.
 *
 * What replaces it is the state an audit asks about: has Quality ruled on this.
 */
function summarize(actions: QualityReportAction[]) {
  const s = { total: actions.length, awaitingVerdict: 0, validated: 0, rejected: 0, highCritical: 0 };
  for (const a of actions) {
    const v = a.validation_status ?? "open";
    if (v === "validated") s.validated++;
    else if (v === "rejected") s.rejected++;
    else s.awaitingVerdict++;
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
  // Landscape: the detail table carries eleven columns, and portrait squeezed Notes
  // to a sliver while wrapping Leader and Department onto two lines each.
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
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

  // KPIs. Deliberately NOT the To do / In progress / Complete counts: those are the
  // team's working board, they change through the shift, and on a report dated last
  // Tuesday they mean nothing. What survives on paper is what was raised, how severe
  // it was, and how much of it was paperwork.
  let y = 32;
  // The ranking/points half of the report is quality's alone — safety never charges
  // a leader, and `leaderTracking` ranks by points, so a safety row must not reach
  // it here even when the caller (e.g. `printDaily`) fetched a whole day of both
  // domains with no filter. The full actions table further down is unaffected: that
  // is the raw log, not a ranking.
  const qualityOnly = actions.filter((a) => a.domain !== "safety");
  const tracking = leaderTracking(qualityOnly);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20, 30, 60);
  doc.text("Summary", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(0);
  const validatedPaperwork = tracking.reduce((n, r) => n + r.paperwork, 0);
  const kpis = [
    `Total actions: ${s.total}`,
    `Still open: ${tracking.reduce((n, r) => n + r.open, 0)}`,
    `High / Critical: ${s.highCritical}`,
    `Validated paperwork errors: ${validatedPaperwork}`,
    `Leaders involved: ${tracking.length}`,
  ];
  doc.text(kpis.join("      "), margin, y);
  y += 6;

  // Quality tracking by leader — the accountability view.
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(20, 30, 60);
  doc.text("Quality tracking by leader", margin, y);
  y += 2;
  autoTable(doc, {
    startY: y + 1,
    head: [["Leader", "Shift", "Actions", "Open", "Paperwork (validated)", "High / Critical", "Points in period"]],
    body: tracking.length
      ? tracking.map((r) => [
          r.leader,
          r.shifts,
          String(r.total),
          String(r.open),
          r.paperworkPending ? `${r.paperwork}  (+${r.paperworkPending} pending)` : String(r.paperwork),
          String(r.highCritical),
          pointsLabel(r),
        ])
      : [["—", "—", "0", "0", "0", "0", "0 pts"]],
    styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      2: { halign: "center", cellWidth: 18 },
      3: { halign: "center", cellWidth: 16 },
      4: { halign: "center", cellWidth: 34 },
      5: { halign: "center", cellWidth: 24 },
      6: { halign: "right", cellWidth: 34 },
    },
    // A High or Critical is worth seeing from across the room; the points total is
    // left in plain black, because it is a record of what was raised and not a fine.
    didParseCell: (data: any) => {
      if (data.section !== "body") return;
      const r = tracking[data.row.index];
      if (!r) return;
      if (data.column.index === 3 && r.open > 0) { data.cell.styles.textColor = [180, 83, 9]; data.cell.styles.fontStyle = "bold"; }
      if (data.column.index === 5 && r.highCritical > 0) { data.cell.styles.textColor = [190, 18, 60]; data.cell.styles.fontStyle = "bold"; }
      if (data.column.index === 6) data.cell.styles.fontStyle = "bold";
    },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // Full actions table
  autoTable(doc, {
    startY: y + 2,
    head: [["Date", "Action #", "Validation", "Severity", "Line", "Shift", "Leader", "Dept", "SKU", "Batch", "Notes"]],
    body: actions.map((a) => [
      fmtDate(a.recorded_at), a.action_no ?? "", validationMeta(a.validation_status).label, sevLabel(a.severity),
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
  sum.push(["Awaiting verdict", s.awaitingVerdict]);
  sum.push(["Validated", s.validated]);
  sum.push(["Rejected", s.rejected]);
  sum.push(["High / Critical", s.highCritical]);
  const block = (title: string, rows: [string, number][]) => {
    sum.push([]);
    sum.push([{ v: title, s: HEAD_STYLE }, { v: "Count", s: HEAD_STYLE }]);
    for (const [k, v] of (rows.length ? rows : [["—", 0] as [string, number]])) sum.push([k, v]);
  };
  block("By Validation", tally(actions, (a) => validationMeta(a.validation_status).label));
  block("By Severity", tally(actions, (a) => sevLabel(a.severity)));
  block("By Line", tally(actions, (a) => a.line || "—"));
  block("By Department", tally(actions, (a) => a.department || "—"));
  // Same rule as `leaderTracking` above and in the PDF's per-leader table: this is a
  // per-leader ranking, and a safety near miss must not inflate anyone's place in it.
  block("By Leader", tally(actions.filter((a) => a.domain !== "safety"), (a) => a.leader_name || "—"));
  const wsSum = XLSX.utils.aoa_to_sheet(sum);
  wsSum["!cols"] = [{ wch: 22 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  // Actions sheet
  const header = ["Date", "Action #", "Validation", "Severity", "Line", "Shift", "Leader", "Department", "SKU", "Batch", "Labels", "Notes"];
  const rows: any[][] = [header.map((h) => ({ v: h, s: HEAD_STYLE }))];
  for (const a of actions) {
    rows.push([
      fmtDate(a.recorded_at), a.action_no ?? "", validationMeta(a.validation_status).label, sevLabel(a.severity),
      a.line ?? "", a.shift ?? "", a.leader_name ?? "", a.department ?? "", a.sku ?? "", a.batch ?? "",
      (a.labels ?? []).join("; "), a.description ?? "",
    ]);
  }
  const wsAct = XLSX.utils.aoa_to_sheet(rows);
  wsAct["!cols"] = header.map((h) => ({ wch: h === "Notes" ? 45 : h === "Department" ? 18 : 14 }));
  XLSX.utils.book_append_sheet(wb, wsAct, "Actions");

  XLSX.writeFile(wb, `quality-report-${Date.now()}.xlsx`);
}
