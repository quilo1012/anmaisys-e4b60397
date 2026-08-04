/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable cells are loosely typed */
// Printable Production Performance report: branded header band, KPI cards,
// per-line table (target / actual / gap / %) with RAG colours and a total row,
// and the open quality actions for the period with severity chips.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
  status?: string | null;
}
/** One shift's worth of the per-line table, printed under its own heading. */
export interface PerfReportSection {
  label: string;
  lines: PerfReportLine[];
  totalTarget: number;
  totalActual: number;
}
export interface PerfReportInput {
  periodLabel: string;
  filtersLabel: string;
  lines: PerfReportLine[];
  totalTarget: number;
  totalActual: number;
  /**
   * Day and Night as separate tables.
   *
   * A report run across both shifts summed them into one row per line, so a line
   * that made target on days and lost it on nights printed as a single average that
   * happened on neither. The headline figures stay whole-period; the tables split,
   * because that is the level the work is actually reviewed at.
   *
   * Absent, the flat `lines` table is printed as before — which is what a report
   * already filtered to one shift wants.
   */
  sections?: PerfReportSection[];
  openActions: PerfReportOpenAction[];
  generatedBy: string;
}

type RGB = [number, number, number];
const NAVY: RGB = [30, 58, 138]; // Applied Nutrition blue
const INK: RGB = [15, 23, 42];
const SUBTLE: RGB = [100, 116, 139];
const CARD_BG: RGB = [248, 250, 252];
const CARD_BORDER: RGB = [226, 232, 240];
const GREEN_BG: RGB = [209, 250, 229], GREEN_TX: RGB = [4, 120, 87];
const AMBER_BG: RGB = [254, 243, 199], AMBER_TX: RGB = [180, 83, 9];
const RED_BG: RGB = [254, 226, 226], RED_TX: RGB = [185, 28, 28];

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const signed = (v: number) => (v >= 0 ? "+" : "") + n(v);
const ragBg = (pct: number): RGB => (pct >= 100 ? GREEN_BG : pct >= 90 ? AMBER_BG : RED_BG);
const ragTx = (pct: number): RGB => (pct >= 100 ? GREEN_TX : pct >= 90 ? AMBER_TX : RED_TX);
const gapTx = (v: number): RGB => (v >= 0 ? GREEN_TX : RED_TX);
const sevChip = (s: string | null): { fillColor: RGB; textColor: RGB } => {
  const t = (s ?? "").toLowerCase();
  if (t.includes("crit") || t.includes("high")) return { fillColor: RED_BG, textColor: RED_TX };
  if (t.includes("med")) return { fillColor: AMBER_BG, textColor: AMBER_TX };
  return { fillColor: [241, 245, 249], textColor: [71, 85, 105] };
};

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

export async function generatePerformanceReportPDF(input: PerfReportInput, opts?: { output?: "save" | "dataurl" | "bloburl" }) {
  const { periodLabel, filtersLabel, lines, totalTarget, totalActual, sections, openActions, generatedBy } = input;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");
  const overall = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;
  const totalGap = totalActual - totalTarget;

  // ── Branded header band ───────────────────────────────────────────────
  const drawHeader = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 26, "F");
    // white chip for the logo so the jpeg sits on white, not navy
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, 6, 26, 14, 2, 2, "F");
    if (logo) { try { doc.addImage(logo, "JPEG", margin + 1.5, 7.5, 23, 11); } catch { /* ignore */ } }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text("Production Performance", pageW - margin, 13, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(203, 213, 225);
    doc.text(periodLabel, pageW - margin, 19, { align: "right" });
    doc.setTextColor(0);
  };
  drawHeader();

  // ── KPI cards ─────────────────────────────────────────────────────────
  const cardY = 32, cardH = 22, gap = 4;
  const cardW = (pageW - margin * 2 - gap * 3) / 4;
  const card = (i: number, label: string, value: string, valueColor: RGB, accent: RGB) => {
    const x = margin + i * (cardW + gap);
    doc.setFillColor(...CARD_BG); doc.setDrawColor(...CARD_BORDER);
    doc.roundedRect(x, cardY, cardW, cardH, 2, 2, "FD");
    doc.setFillColor(...accent);
    doc.roundedRect(x, cardY, 1.6, cardH, 0.8, 0.8, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...SUBTLE);
    doc.text(label.toUpperCase(), x + 5, cardY + 6);
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...valueColor);
    doc.text(value, x + 5, cardY + 15.5);
  };
  card(0, "Overall Efficiency", `${overall.toFixed(0)}%`, ragTx(overall), ragTx(overall));
  card(1, "Actual", n(totalActual), INK, NAVY);
  card(2, "Target", n(totalTarget), INK, NAVY);
  card(3, "Gap", signed(totalGap), gapTx(totalGap), gapTx(totalGap));

  let y = cardY + cardH + 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...SUBTLE);
  doc.text(`${lines.length} ${lines.length === 1 ? "line" : "lines"} scored   ·   ${filtersLabel}`, margin, y);
  y += 5;

  // ── Per-line table, once per shift when both are in scope ─────────────
  //
  // Drawn by a single routine so a split report and a whole-period one cannot
  // drift apart in layout, spacing or colour rules.
  const drawLineTable = (rows: PerfReportLine[], tTarget: number, tActual: number, startY: number) => {
    const tGap = tActual - tTarget;
    const tPct = tTarget > 0 ? (tActual / tTarget) * 100 : 0;
    autoTable(doc, {
      startY,
      head: [["Line", "Leader", "Target", "Actual", "Gap", "%"]],
      body: rows.map((l) => {
        const g = l.actual - l.target;
        return [
          l.line,
          l.leader ?? "—",
          { content: n(l.target), styles: { halign: "right" } },
          { content: n(l.actual), styles: { halign: "right" } },
          { content: signed(g), styles: { halign: "right", textColor: gapTx(g), fontStyle: "bold" } },
          { content: `${l.eff.toFixed(0)}%`, styles: { halign: "center", fillColor: ragBg(l.eff), textColor: ragTx(l.eff), fontStyle: "bold" } },
        ];
      }),
      foot: [[
        { content: "TOTAL", styles: { fontStyle: "bold" } },
        "",
        { content: n(tTarget), styles: { halign: "right", fontStyle: "bold" } },
        { content: n(tActual), styles: { halign: "right", fontStyle: "bold" } },
        { content: signed(tGap), styles: { halign: "right", fontStyle: "bold", textColor: gapTx(tGap) } },
        { content: `${tPct.toFixed(0)}%`, styles: { halign: "center", fontStyle: "bold", fillColor: ragBg(tPct), textColor: ragTx(tPct) } },
      ]],
      styles: { fontSize: 9, cellPadding: 2.4, lineColor: [226, 232, 240], lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", halign: "left" },
      footStyles: { fillColor: [226, 232, 240], textColor: INK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { fontStyle: "bold" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "center" } },
      margin: { left: margin, right: margin },
    });
    return (doc as any).lastAutoTable.finalY as number;
  };

  const printable = (sections ?? []).filter((sec) => sec.lines.length > 0);
  if (printable.length > 0) {
    for (const sec of printable) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...NAVY);
      doc.text(`${sec.label}  —  ${sec.lines.length} ${sec.lines.length === 1 ? "line" : "lines"}`, margin, y);
      doc.setTextColor(0);
      y = drawLineTable(sec.lines, sec.totalTarget, sec.totalActual, y + 2) + 7;
    }
    // Nudged back so the shared advance below lands in the same place either way.
    y -= 7;
  } else {
    y = drawLineTable(lines, totalTarget, totalActual, y);
  }

  y = (doc as any).lastAutoTable.finalY + 9;

  // ── Quality actions (all statuses in the period) ──────────────────────
  const fmtStatus = (s: string | null | undefined) =>
    s === "in_progress" ? "In progress" : s === "todo" ? "To do" : s === "complete" ? "Complete" : (s ?? "—");
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK);
  doc.text(`Quality Actions  (${openActions.length})`, margin, y);
  y += 3;
  doc.setTextColor(0);
  autoTable(doc, {
    startY: y,
    head: [["Date", "Action #", "Line", "Shift", "Status", "Severity", "Description"]],
    body: openActions.length
      ? openActions.map((a) => [
          fmtDate(a.recorded_at),
          a.action_no ?? "—",
          a.line ?? "—",
          a.shift ?? "—",
          fmtStatus(a.status),
          { content: (a.severity ?? "—").toUpperCase(), styles: { ...sevChip(a.severity), fontStyle: "bold", halign: "center" } },
          (a.description ?? "").slice(0, 70) || "—",
        ])
      : [[{ content: "No quality actions in this period.", colSpan: 7, styles: { halign: "center", textColor: SUBTLE, fontStyle: "italic" } }]],
    styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak", lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 4: { halign: "center" }, 5: { halign: "center" } },
    margin: { left: margin, right: margin, top: 30 },
    didDrawPage: (data: any) => {
      if (data.pageNumber > 1) drawHeader();
      doc.setDrawColor(...CARD_BORDER);
      doc.line(margin, pageH - 10, pageW - margin, pageH - 10);
      doc.setFontSize(7); doc.setTextColor(130);
      doc.text(`Applied Nutrition · Confidential · Generated ${generatedOn} by ${generatedBy}`, margin, pageH - 6);
      doc.text(`Page ${data.pageNumber}`, pageW - margin, pageH - 6, { align: "right" });
    },
  });

  const filename = `production-performance-${Date.now()}.pdf`;
  // "dataurl" feeds the in-app preview iframe — a self-contained data: URI
  //   renders even inside a sandboxed iframe (the Lovable editor), where a
  //   blob: URL gets "blocked by Chrome".
  // "bloburl" is for opening the PDF in a new tab to print (top-level blob nav
  //   is allowed; data: is not).
  if (opts?.output === "dataurl") return doc.output("datauristring") as unknown as string;
  if (opts?.output === "bloburl") return doc.output("bloburl") as unknown as string;
  doc.save(filename);
  return undefined;
}
