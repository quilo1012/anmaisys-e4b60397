/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable + xlsx-js-style cells are loosely typed */
// Professional Quality report exports for the Quality Actions data:
//   - PDF (jsPDF + autoTable): printable report with logo header, KPIs, per-leader tracking, full list.
//   - Excel (xlsx-js-style): styled workbook with a Summary sheet + an Actions sheet.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
import logoUrl from "@/assets/appliedlogo.jpeg";
import { severityMeta, validationMeta, actionHeadline } from "@/lib/qualityConstants";
import { leaderTracking, pointsLabel } from "@/lib/leaderTracking";
import { parseProductNote, resolveSkuFromNote } from "@/lib/qualityProductNote";

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
  /** What the sync calls the finding. NULL on every action typed by hand. */
  title?: string | null;
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
  /**
   * Active SKU catalogue. OPTIONAL on purpose: without it the workbook comes out
   * exactly as it does today (no SKUs sheet, no Product column), which is what
   * `src/lib/qualityReport.test.ts` calls in 4 places without passing it.
   */
  skuCatalog?: { code: string; name: string }[];
  /**
   * Which SKUs each batch code was actually run as, from `production_items`.
   * OPTIONAL: without it the Actions sheet still recovers the product name and the
   * batch an operator wrote into a SafetyCulture note, and leaves SKU unresolved.
   */
  batchSkus?: { batch: string; code: string; name: string }[];
}

/**
 * What an empty cell says. The PDF has always printed an em dash for an ungraded
 * severity; the workbook now says the same thing everywhere, because a grid of
 * blanks reads as a sheet nobody finished rather than as a fact about the factory.
 */
export const EMPTY_CELL = "\u2014";

/** Sentinel written when a SKU is not in the catalogue — the same text the formula produces. */
export const SKU_NOT_FOUND = "### CODIGO NAO ENCONTRADO ###";

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

// ── Detail table ─────────────────────────────────────────────────────────────
/**
 * The action log's columns, decided by the rows being printed rather than by a
 * constant — a column that is blank on most of its rows is not neutral. It takes
 * width from Notes, which is the column a reader is actually looking for, and it
 * makes a document that gets signed and filed look like a form nobody finished.
 *
 * On the 19/08/2026 report (69 actions, three months) `Action #` was blank on 49
 * rows — only the 20 rows imported from the old spreadsheet carry a number, the log
 * form has never required one — and `Severity` printed an em dash on 46, because the
 * grade is a judgement the form leaves optional. Two of eleven columns said nothing.
 *
 * Both come back on their own the moment the period contains them: import a sheet
 * with action numbers and the column is worth its width again. Nothing here is
 * hidden — what is not printed is what no row in the period has.
 */
const filled = (v: string | null | undefined) => (v ?? "").trim() !== "";

/** Long enough to read, cut on a word so the last word is not sliced in half. */
const NOTE_MAX = 140;
function noteText(a: QualityReportAction) {
  // The headline, not `description` alone. 52 of the 66 SafetyCulture rows carry no
  // description at all, so this column printed blank for them in a PDF that goes to a
  // review — the same hole the log had on screen. See actionHeadline().
  const t = (actionHeadline(a) ?? "").replace(/\s+/g, " ");
  if (t.length <= NOTE_MAX) return t;
  const cut = t.slice(0, NOTE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > NOTE_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
}

interface DetailColumn {
  header: string;
  /** mm. Notes is left unset so autoTable gives it everything the others leave. */
  width?: number;
  cell: (a: QualityReportAction) => string;
}

export function qualityDetailTable(actions: QualityReportAction[]) {
  // Widths in mm, out of the 269 a landscape A4 leaves between the margins. Each is
  // the width its own longest real value measures at 7pt Helvetica plus autoTable's
  // 1.4mm padding either side — measured with `doc.getTextWidth`, not estimated — so
  // that Notes, the one column whose length is not bounded, keeps 104mm when the
  // optional two are absent and still 77mm when both are present.
  const columns: DetailColumn[] = [
    { header: "Date", width: 16, cell: (a) => fmtDate(a.recorded_at) },
    ...(actions.some((a) => filled(a.action_no))
      ? [{ header: "Action #", width: 14, cell: (a: QualityReportAction) => a.action_no ?? "" }]
      : []),
    // "Awaiting verdict" is the longest verdict, at 17.2mm.
    { header: "Validation", width: 21, cell: (a) => validationMeta(a.validation_status).label },
    ...(actions.some((a) => filled(a.severity))
      ? [{ header: "Severity", width: 13, cell: (a: QualityReportAction) => sevLabel(a.severity) }]
      : []),
    // Sized for "Capsules Machine 2" (22.2mm), not for "Line 5". The old width broke
    // that name across two lines and pushed the whole row's shift into a third.
    { header: "Line", width: 25, cell: (a) => a.line ?? "" },
    { header: "Shift", width: 11, cell: (a) => a.shift ?? "" },
    { header: "Leader", width: 18, cell: (a) => a.leader_name ?? "" },
    { header: "Dept", width: 17, cell: (a) => a.department ?? "" },
    // A full product name lives here ("ORIGINAL CRITICAL MASS CHOCOLATE 2.4Kg"), so
    // this one wraps by design rather than taking the width Notes needs.
    { header: "SKU", width: 32, cell: (a) => a.sku ?? "" },
    { header: "Batch", width: 25, cell: (a) => a.batch ?? "" },
    { header: "Notes", cell: noteText },
  ];
  return {
    head: columns.map((c) => c.header),
    body: actions.map((a) => columns.map((c) => c.cell(a))),
    columnStyles: Object.fromEntries(
      columns.flatMap((c, i) => (c.width ? [[i, { cellWidth: c.width }]] : [])),
    ) as Record<number, { cellWidth: number }>,
  };
}

// ── PDF ──────────────────────────────────────────────────────────────────────
const INK = [20, 30, 60] as const;
const HEAD_FILL = [30, 41, 59] as const;
const ZEBRA = [245, 247, 250] as const;

export async function generateQualityReportPDF(input: QualityReportInput) {
  const { actions, periodLabel, generatedBy } = input;
  // Landscape: the log carries up to eleven columns, and portrait squeezed Notes to
  // a sliver while wrapping Leader and Department onto two lines each.
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");

  const drawHeader = () => {
    if (logo) { try { doc.addImage(logo, "JPEG", margin, 8, 22, 12); } catch { /* ignore */ } }
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...INK);
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
  // domains with no filter. The action log further down is unaffected: that is the
  // raw record, not a ranking.
  const qualityOnly = actions.filter((a) => a.domain !== "safety");
  const tracking = leaderTracking(qualityOnly);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
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
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
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
    headStyles: { fillColor: [...HEAD_FILL], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [...ZEBRA] },
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
    margin: { left: margin, right: margin, top: 26 },
    didDrawPage: () => { if (doc.getCurrentPageInfo().pageNumber > 1) drawHeader(); },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // The action log — every action in the period, in the order it was raised.
  //
  // A heading with no table under it is worse than no heading, so if the leader table
  // finished near the foot of the page the log starts on a fresh one rather than
  // leaving "Action log" stranded above the footer.
  const detail = qualityDetailTable(actions);
  if (y > pageH - 45) { doc.addPage(); drawHeader(); y = 32; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("Action log", margin, y);
  autoTable(doc, {
    startY: y + 3,
    head: [detail.head],
    body: detail.body,
    styles: { fontSize: 7, cellPadding: 1.4, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: [...HEAD_FILL], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [...ZEBRA] },
    columnStyles: detail.columnStyles as any,
    // One action, one row, one page. autoTable splits a tall row across the page break
    // by default, which left a note's second line and its SKU stranded at the top of
    // the next page under a header row belonging to a record that started overleaf.
    rowPageBreak: "avoid",
    margin: { left: margin, right: margin, top: 26 },
    didDrawPage: () => { if (doc.getCurrentPageInfo().pageNumber > 1) drawHeader(); },
  });

  // Footer last, in one pass over the finished document.
  //
  // It used to be stamped from the log table's `didDrawPage`, where `pageNumber`
  // counts that table's pages and not the document's: page 1 — the summary and the
  // leader table — got no footer at all, and a five-page report ended on a page
  // numbered 4. A signed document has to say which page of how many this is.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(130);
    doc.text(`Generated ${generatedOn} by ${generatedBy}`, margin, pageH - 6);
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 6, { align: "right" });
  }

  doc.save(`quality-report-${Date.now()}.pdf`);
}

// ── Excel ────────────────────────────────────────────────────────────────────
const HEAD_STYLE = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E293B" } } };
const TITLE_STYLE = { font: { bold: true, sz: 14, color: { rgb: "141E3C" } } };

export function generateQualityReportExcel(input: QualityReportInput) {
  const { actions, periodLabel, generatedBy } = input;
  const s = summarize(actions);
  const wb = XLSX.utils.book_new();

  // SKU catalogue, normalised (TRIM + UPPER) so the VLOOKUP below — whose left-hand
  // side is normalised the same way — matches a hand-typed " abebr ".
  const catalog = (input.skuCatalog ?? [])
    .map((p) => ({ code: (p.code ?? "").trim().toUpperCase(), name: p.name }))
    .filter((p) => p.code)
    .sort((a, b) => a.code.localeCompare(b.code));
  const nameByCode = new Map(catalog.map((p) => [p.code, p.name]));
  const lastCatalogRow = catalog.length + 1; // +1 for the SKUs header row

  // What each batch code was actually run as, so a note naming a batch can name a SKU.
  const byBatch = new Map<string, { code: string; name: string }[]>();
  for (const b of input.batchSkus ?? []) {
    const key = (b.batch ?? "").trim().toUpperCase();
    const code = (b.code ?? "").trim().toUpperCase();
    if (!key || !code) continue;
    const list = byBatch.get(key) ?? [];
    if (!list.some((c) => c.code === code)) list.push({ code, name: b.name });
    byBatch.set(key, list);
  }

  /**
   * SKU, Product and Batch for one row.
   *
   * From the form when the form holds them. Otherwise from the operator's own note:
   * every action since 01/09/2026 comes from SafetyCulture, which has no product
   * field and never writes `sku` or `batch`, so those three columns printed blank on
   * all 106 of them while the note said, in as many words, which product and which
   * batch. See `qualityProductNote.ts`.
   *
   * `derived` marks a value read out of a sentence rather than typed into the field
   * for it — the sheet sets those in italic, because on a document that gets signed
   * the two are not the same claim.
   */
  const identify = (a: QualityReportAction) => {
    const sku = (a.sku ?? "").trim();
    const batch = (a.batch ?? "").trim();
    if (sku || batch) return { sku, batch, product: "", derived: false };
    const note = parseProductNote(a.description);
    if (!note) return { sku: "", batch: "", product: "", derived: false };
    const code = resolveSkuFromNote(note, byBatch.get(note.batch) ?? []);
    return {
      sku: code ?? "",
      batch: note.batch,
      // The catalogue's name when the code is certain, the operator's own words when
      // it is not — never nothing, because the note did name the product.
      product: (code && nameByCode.get(code)) || note.product,
      derived: true,
    };
  };
  const ids = actions.map(identify);
  const derivedRows = ids.filter((i) => i.derived).length;

  // Summary sheet
  const sum: any[][] = [];
  sum.push([{ v: "Quality Report", s: TITLE_STYLE }]);
  sum.push([periodLabel]);
  sum.push([`Generated ${new Date().toLocaleString("en-GB")} by ${generatedBy}`]);
  if (derivedRows) {
    sum.push([`Actions sheet: ${derivedRows} row(s) have SKU, Product and Batch read from the action's own note, shown in italic.`]);
  }
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
    for (const [k, v] of (rows.length ? rows : [["\u2014", 0] as [string, number]])) sum.push([k, v]);
  };
  block("By Validation", tally(actions, (a) => validationMeta(a.validation_status).label));
  block("By Severity", tally(actions, (a) => sevLabel(a.severity)));
  block("By Line", tally(actions, (a) => a.line || EMPTY_CELL));
  block("By Department", tally(actions, (a) => a.department || EMPTY_CELL));
  // Same rule as `leaderTracking` above and in the PDF's per-leader table: this is a
  // per-leader ranking, and a safety near miss must not inflate anyone's place in it.
  block("By Leader", tally(actions.filter((a) => a.domain !== "safety"), (a) => a.leader_name || EMPTY_CELL));
  const wsSum = XLSX.utils.aoa_to_sheet(sum);
  wsSum["!cols"] = [{ wch: 22 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  /** A value read out of a note, not typed into the field for it. */
  const DERIVED_STYLE = { font: { italic: true, color: { rgb: "475569" } } };
  const derivedCell = (v: string) => ({ t: "s", v, s: DERIVED_STYLE });
  /** No cell is left blank: the em dash says "this action has none", which is a fact. */
  const text = (v: string | null | undefined) => (filled(v) ? (v as string).trim() : EMPTY_CELL);

  const productCell = (excelRow: number, id: ReturnType<typeof identify>) => {
    if (id.derived) return derivedCell(id.product || EMPTY_CELL);
    const key = id.sku.toUpperCase();
    return {
      t: "s",
      // Cached value: readers that do not evaluate formulas (Numbers, a parser,
      // a Google Sheets import) still show the name instead of a blank cell.
      v: key ? (nameByCode.get(key) ?? SKU_NOT_FOUND) : EMPTY_CELL,
      // Formula: when someone types a code into the sheet by hand, the column answers.
      // An em dash on the left is the sheet's own "none", not a code to look up.
      f: `IF(OR(TRIM(I${excelRow})="",TRIM(I${excelRow})="${EMPTY_CELL}"),"${EMPTY_CELL}",IFERROR(VLOOKUP(TRIM(UPPER(I${excelRow})),SKUs!$A$2:$B$${lastCatalogRow},2,FALSE),"${SKU_NOT_FOUND}"))`,
    };
  };

  // Actions sheet
  const header = ["Date", "Action #", "Validation", "Severity", "Line", "Shift", "Leader", "Department", "SKU",
    ...(catalog.length ? ["Product"] : []),
    "Batch", "Labels", "Notes"];
  const rows: any[][] = [header.map((h) => ({ v: h, s: HEAD_STYLE }))];
  actions.forEach((a, r) => {
    const id = ids[r];
    rows.push([
      text(fmtDate(a.recorded_at)), text(a.action_no), validationMeta(a.validation_status).label, sevLabel(a.severity),
      text(a.line), text(a.shift), text(a.leader_name), text(a.department),
      id.derived && id.sku ? derivedCell(id.sku) : text(id.sku),
      ...(catalog.length ? [productCell(r + 2, id)] : []),
      id.derived && id.batch ? derivedCell(id.batch) : text(id.batch),
      text((a.labels ?? []).join("; ")),
      // `actionHeadline`, not `description`: 88 of the 106 SafetyCulture rows carry no
      // description at all, and the whole of what they say lives in `title`.
      text(actionHeadline(a)),
    ]);
  });
  const wsAct = XLSX.utils.aoa_to_sheet(rows);
  wsAct["!cols"] = header.map((h) => ({ wch: h === "Notes" ? 45 : h === "Product" ? 40 : h === "Department" ? 18 : 14 }));
  XLSX.utils.book_append_sheet(wb, wsAct, "Actions");

  // SKUs sheet — only when a catalogue was given, so callers without one get the
  // workbook they always got.
  if (catalog.length) {
    const skuRows: any[][] = [[{ v: "Code", s: HEAD_STYLE }, { v: "Product", s: HEAD_STYLE }]];
    for (const p of catalog) skuRows.push([p.code, p.name]);
    const wsSku = XLSX.utils.aoa_to_sheet(skuRows);
    wsSku["!cols"] = [{ wch: 16 }, { wch: 52 }];
    XLSX.utils.book_append_sheet(wb, wsSku, "SKUs");
  }

  XLSX.writeFile(wb, `quality-report-${Date.now()}.xlsx`);
}
