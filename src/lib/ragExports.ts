// RAG Weekly professional exports — PDF (jsPDF) + Excel (xlsx-js-style)
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
import { format, addDays, getISOWeek } from "date-fns";
import logoUrl from "@/assets/appliedlogo.jpeg";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Match RAG downtime buckets by category keyword. Real data buckets may be
// named "Maint Downtime (iTouching)", "Brushing Cleaning", "Deep Clean",
// "Break", etc. — normalize with a case-insensitive keyword match so the
// export columns aggregate every matching bucket.
type BucketMatcher = (bucketName: string) => boolean;
const BUCKET_MATCHERS: Record<string, BucketMatcher> = {
  "WO Request": (b) => /wo\s*request/i.test(b),
  MAINT: (b) => {
    const lc = b.toLowerCase();
    return lc === "maint" || lc.includes("maintenance") || lc.includes("itouching");
  },
  Break: (b) => /break/i.test(b),
  Cleaning: (b) => /clean/i.test(b),
};

function sumBucket(
  autoDtBucketMap: Map<string, Map<string, number>>,
  category: string,
  line: string,
  dates: string[],
): number {
  const match = BUCKET_MATCHERS[category] ?? ((b: string) => b === category);
  let total = 0;
  for (const [bucketName, cellMap] of autoDtBucketMap.entries()) {
    if (!match(bucketName)) continue;
    for (const d of dates) {
      for (const shift of ["DAY", "NIGHT"] as const) {
        total += cellMap.get(`${d}|${line}|${shift}`) ?? 0;
      }
    }
  }
  return total;
}

export interface RagExportEntry {
  entry_date: string;
  line: string;
  shift: "DAY" | "NIGHT";
  plan_qty: number;
  actual_qty: number;
  downtime_min: number;
}

export interface RagExportInput {
  weekStart: Date;
  lines: string[];
  entries: RagExportEntry[];
  /** bucket -> (dateKey "yyyy-MM-dd|line|SHIFT") -> minutes */
  autoDtBucketMap: Map<string, Map<string, number>>;
  generatedBy: string;
  /** Optional map of line -> comment for the week */
  comments?: Map<string, string>;
}

interface DayTotals {
  plan: number;
  actual: number;
}
interface ShiftedDayTotals {
  day: DayTotals;
  night: DayTotals;
}

function pctColorHex(pct: number | null): string {
  if (pct === null) return "FFFFFF";
  if (pct >= 90) return "C6F0D2"; // green
  if (pct >= 70) return "FCEBC1"; // amber
  return "FCC9C9"; // red
}
function pctColorRgb(pct: number | null): [number, number, number] {
  if (pct === null) return [255, 255, 255];
  if (pct >= 90) return [198, 240, 210];
  if (pct >= 70) return [252, 235, 193];
  return [252, 201, 201];
}

function computeDaily(entries: RagExportEntry[], lines: string[], weekStart: Date) {
  const dates = Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), "yyyy-MM-dd"));
  // line -> date -> {day:{plan,actual}, night:{plan,actual}}
  const byLine = new Map<string, Map<string, ShiftedDayTotals>>();
  for (const l of lines) {
    const m = new Map<string, ShiftedDayTotals>();
    for (const d of dates) m.set(d, { day: { plan: 0, actual: 0 }, night: { plan: 0, actual: 0 } });
    byLine.set(l, m);
  }
  for (const e of entries) {
    const m = byLine.get(e.line);
    if (!m) continue;
    const t = m.get(e.entry_date);
    if (!t) continue;
    const bucket = e.shift === "NIGHT" ? t.night : t.day;
    bucket.plan += Number(e.plan_qty ?? 0);
    bucket.actual += Number(e.actual_qty ?? 0);
  }
  return { dates, byLine };
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
  } catch {
    return null;
  }
}

// ============================================================
// PDF
// ============================================================
export async function exportRagPdf(input: RagExportInput) {
  const { weekStart, lines, entries, autoDtBucketMap, generatedBy, comments } = input;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const weekNo = getISOWeek(weekStart);
  const weekEnd = addDays(weekStart, 6);
  const range = `${format(weekStart, "dd/MM/yyyy")} – ${format(weekEnd, "dd/MM/yyyy")}`;

  const logo = await loadLogoDataUrl();
  if (logo) {
    try { doc.addImage(logo, "JPEG", margin, 8, 26, 14); } catch { /* ignore */ }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("RAG Weekly Report", margin + 30, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Week ${weekNo} · ${range}`, margin + 30, 21);

  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, pageW - margin, 14, { align: "right" });
  doc.text(`By: ${generatedBy}`, pageW - margin, 19, { align: "right" });
  doc.setTextColor(0);

  const { dates, byLine } = computeDaily(entries, lines, weekStart);

  // Header rows: two levels — Day name across 3 cols (Target / Actual / %) + Week totals
  const head1: any[] = [{ content: "Line", rowSpan: 2, styles: { valign: "middle", halign: "left" } }];
  for (let i = 0; i < 7; i++) {
    head1.push({ content: DAY_LABELS[i], colSpan: 3, styles: { halign: "center" } });
  }
  head1.push({ content: "Week Total", colSpan: 3, styles: { halign: "center" } });
  const head2: any[] = [];
  for (let i = 0; i < 8; i++) head2.push("Target", "Actual", "%");

  const body: any[] = [];
  const weekTotals: { plan: number; actual: number } = { plan: 0, actual: 0 };
  const dailyGrand: DayTotals[] = dates.map(() => ({ plan: 0, actual: 0 }));

  for (const line of lines) {
    const m = byLine.get(line)!;
    let lp = 0, la = 0;
    const shiftRows: Array<{ label: "Day" | "Night"; get: (t: ShiftedDayTotals) => DayTotals }> = [
      { label: "Day", get: (t) => t.day },
      { label: "Night", get: (t) => t.night },
    ];
    for (const sr of shiftRows) {
      const row: any[] = [{ content: `${line} · ${sr.label}`, styles: { halign: "left" } }];
      let rp = 0, ra = 0;
      dates.forEach((d, idx) => {
        const t = sr.get(m.get(d)!);
        rp += t.plan; ra += t.actual;
        dailyGrand[idx].plan += t.plan;
        dailyGrand[idx].actual += t.actual;
        const pct = t.plan ? (t.actual / t.plan) * 100 : null;
        row.push(t.plan || "", t.actual || "", {
          content: pct === null ? "" : `${pct.toFixed(0)}%`,
          styles: { fillColor: pctColorRgb(pct), halign: "center" },
        });
      });
      lp += rp; la += ra;
      const rpct = rp ? (ra / rp) * 100 : null;
      row.push(rp || "", ra || "", {
        content: rpct === null ? "" : `${rpct.toFixed(0)}%`,
        styles: { fillColor: pctColorRgb(rpct), halign: "center" },
      });
      body.push(row);
    }
    weekTotals.plan += lp; weekTotals.actual += la;
    const wpct = lp ? (la / lp) * 100 : null;
    const totalRow: any[] = [{ content: `${line} · Total`, styles: { fontStyle: "bold", fillColor: [240, 240, 240] } }];
    dates.forEach((d) => {
      const t = m.get(d)!;
      const p = t.day.plan + t.night.plan;
      const a = t.day.actual + t.night.actual;
      const pct = p ? (a / p) * 100 : null;
      totalRow.push(
        { content: p || "", styles: { fontStyle: "bold", fillColor: [240, 240, 240] } },
        { content: a || "", styles: { fontStyle: "bold", fillColor: [240, 240, 240] } },
        { content: pct === null ? "" : `${pct.toFixed(0)}%`, styles: { fillColor: pctColorRgb(pct), fontStyle: "bold", halign: "center" } },
      );
    });
    totalRow.push(lp || "", la || "", {
      content: wpct === null ? "" : `${wpct.toFixed(0)}%`,
      styles: { fillColor: pctColorRgb(wpct), halign: "center", fontStyle: "bold" },
    });
    body.push(totalRow);
    const cmt = comments?.get(line)?.trim();
    if (cmt) {
      body.push([{
        content: `Comments: ${cmt}`,
        colSpan: 25,
        styles: { fontStyle: "italic", halign: "left", fillColor: [255, 251, 235], textColor: [92, 65, 8] },
      }]);
    }
  }

  // Totals row
  const totRow: any[] = [{ content: "TOTAL", styles: { fontStyle: "bold" } }];
  dailyGrand.forEach((t) => {
    const p = t.plan ? (t.actual / t.plan) * 100 : null;
    totRow.push(
      { content: t.plan || "", styles: { fontStyle: "bold" } },
      { content: t.actual || "", styles: { fontStyle: "bold" } },
      { content: p === null ? "" : `${p.toFixed(0)}%`, styles: { fillColor: pctColorRgb(p), fontStyle: "bold", halign: "center" } },
    );
  });
  const wp = weekTotals.plan ? (weekTotals.actual / weekTotals.plan) * 100 : null;
  totRow.push(
    { content: weekTotals.plan || "", styles: { fontStyle: "bold" } },
    { content: weekTotals.actual || "", styles: { fontStyle: "bold" } },
    { content: wp === null ? "" : `${wp.toFixed(0)}%`, styles: { fillColor: pctColorRgb(wp), fontStyle: "bold", halign: "center" } },
  );
  body.push(totRow);

  autoTable(doc, {
    startY: 28,
    head: [head1, head2],
    body,
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.5, lineColor: [200, 200, 200] },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold", halign: "center" },
    columnStyles: { 0: { fontStyle: "bold", halign: "left", cellWidth: 30 } },
    margin: { left: margin, right: margin },
  });

  // Trend chart (simple line chart drawn manually)
  const afterTableY = (doc as any).lastAutoTable.finalY + 6;
  const chartH = 55;
  const chartW = pageW - margin * 2;
  const chartTop = afterTableY;
  const chartBottom = chartTop + chartH;

  if (chartTop + chartH + 40 > pageH) {
    doc.addPage();
  }
  const cTop = chartTop + chartH + 40 > pageH ? 20 : chartTop;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Weekly Efficiency Trend", margin, cTop - 2);

  // Chart area
  doc.setDrawColor(200);
  doc.rect(margin, cTop, chartW, chartH);
  // y-axis 0-120%
  const yMax = 120;
  const px = (i: number) => margin + (chartW / 6) * i;
  const py = (pct: number) => cTop + chartH - (pct / yMax) * chartH;

  // grid + labels
  doc.setFontSize(6); doc.setTextColor(140);
  [0, 25, 50, 75, 90, 100].forEach((v) => {
    const y = py(v);
    doc.setDrawColor(230);
    doc.line(margin, y, margin + chartW, y);
    doc.text(`${v}%`, margin - 1, y + 1, { align: "right" });
  });
  // 90% target dashed
  doc.setDrawColor(120);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, py(90), margin + chartW, py(90));
  doc.setLineDashPattern([], 0);

  // x-axis
  doc.setTextColor(60);
  DAY_LABELS.forEach((d, i) => doc.text(d, px(i), cTop + chartH + 4, { align: "center" }));

  // colors per line
  const palette: [number, number, number][] = [
    [59, 130, 246], [34, 197, 94], [239, 68, 68], [234, 179, 8],
    [168, 85, 247], [14, 165, 233], [249, 115, 22], [107, 114, 128],
  ];
  lines.forEach((line, li) => {
    const c = palette[li % palette.length];
    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(0.4);
    let prev: { x: number; y: number } | null = null;
    dates.forEach((d, i) => {
      const t = byLine.get(line)!.get(d)!;
      const p = t.day.plan + t.night.plan;
      const a = t.day.actual + t.night.actual;
      if (!p) { prev = null; return; }
      const pct = Math.min(yMax, (a / p) * 100);
      const x = px(i), y = py(pct);
      if (prev) doc.line(prev.x, prev.y, x, y);
      doc.circle(x, y, 0.6, "F");
      prev = { x, y };
    });
  });
  doc.setLineWidth(0.2);

  // Legend
  const legY = cTop + chartH + 8;
  let legX = margin;
  doc.setFontSize(6.5); doc.setTextColor(40);
  lines.forEach((line, li) => {
    const c = palette[li % palette.length];
    doc.setFillColor(c[0], c[1], c[2]);
    doc.rect(legX, legY - 2, 3, 2, "F");
    doc.text(line, legX + 4, legY);
    legX += doc.getTextWidth(line) + 10;
    if (legX > pageW - margin - 30) { legX = margin; }
  });

  // Downtime summary
  const dtStartY = legY + 8;
  const dtCategories = ["WO Request", "MAINT", "Break", "Cleaning"];
  const dtHead = [["Line", "WO Requests", "Maint Downtime (iTouching)", "Break", "Cleaning"]];
  const dtBody = lines.map((line) => {
    const cells = dtCategories.map((bucket) => sumBucket(autoDtBucketMap, bucket, line, dates));
    return [line, ...cells.map((v) => (v ? `${v} min` : "—"))];
  });

  if (dtStartY + 40 > pageH) doc.addPage();
  autoTable(doc, {
    startY: dtStartY + 40 > pageH ? 20 : dtStartY,
    head: dtHead,
    body: dtBody,
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold" },
    margin: { left: margin, right: margin },
  });

  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(120);
    doc.text(
      `Applied Nutrition Maintenance — Confidential — Generated by ${generatedBy}`,
      margin, pageH - 6,
    );
    doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 6, { align: "right" });
  }

  doc.save(`RAG-Weekly-W${weekNo}-${format(weekStart, "yyyy-MM-dd")}.pdf`);
}

// ============================================================
// EXCEL
// ============================================================
export function exportRagExcel(input: RagExportInput) {
  const { weekStart, lines, entries, autoDtBucketMap, generatedBy, comments } = input;
  const weekNo = getISOWeek(weekStart);
  const { dates, byLine } = computeDaily(entries, lines, weekStart);

  const wb = XLSX.utils.book_new();

  // ---- Styles ----
  const headerFill = { patternType: "solid", fgColor: { rgb: "1E3A5F" } };
  const headerFont = { bold: true, color: { rgb: "FFFFFF" }, name: "Calibri", sz: 11 };
  const border = {
    top: { style: "thin", color: { rgb: "CCCCCC" } },
    bottom: { style: "thin", color: { rgb: "CCCCCC" } },
    left: { style: "thin", color: { rgb: "CCCCCC" } },
    right: { style: "thin", color: { rgb: "CCCCCC" } },
  };
  const centerAlign = { horizontal: "center", vertical: "center" };
  const altRowFill = { patternType: "solid", fgColor: { rgb: "F3F4F6" } };
  const totalFill = { patternType: "solid", fgColor: { rgb: "E5E7EB" } };

  // =============== Sheet 1: RAG Weekly ===============
  const s1: any[][] = [];
  s1.push([`RAG Weekly · Week ${weekNo} · ${format(weekStart, "dd MMM yyyy")} – ${format(addDays(weekStart, 6), "dd MMM yyyy")}`]);
  s1.push([`Generated ${format(new Date(), "dd/MM/yyyy HH:mm")} by ${generatedBy}`]);
  s1.push([]);
  // Header row 1
  const h1: any[] = ["Line"];
  DAY_LABELS.forEach((d) => h1.push(d, "", ""));
  h1.push("Week Total", "", "");
  s1.push(h1);
  // Header row 2
  const h2: any[] = [""];
  for (let i = 0; i < 8; i++) h2.push("Target", "Actual", "%");
  s1.push(h2);

  const dataStartRow = s1.length; // 0-indexed
  const dailyGrand: DayTotals[] = dates.map(() => ({ plan: 0, actual: 0 }));
  const weekT = { plan: 0, actual: 0 };

  for (const line of lines) {
    const m = byLine.get(line)!;
    let lp = 0, la = 0;
    for (const sr of [{ label: "Day", get: (t: ShiftedDayTotals) => t.day }, { label: "Night", get: (t: ShiftedDayTotals) => t.night }] as const) {
      const row: any[] = [`${line} · ${sr.label}`];
      let rp = 0, ra = 0;
      dates.forEach((d, idx) => {
        const t = sr.get(m.get(d)!);
        rp += t.plan; ra += t.actual;
        dailyGrand[idx].plan += t.plan;
        dailyGrand[idx].actual += t.actual;
        const pct = t.plan ? t.actual / t.plan : null;
        row.push(t.plan || 0, t.actual || 0, pct === null ? "" : pct);
      });
      const rpct = rp ? ra / rp : null;
      row.push(rp, ra, rpct === null ? "" : rpct);
      lp += rp; la += ra;
      s1.push(row);
    }
    // Line total row
    const totalRow: any[] = [`${line} · Total`];
    dates.forEach((d) => {
      const t = m.get(d)!;
      const p = t.day.plan + t.night.plan;
      const a = t.day.actual + t.night.actual;
      const pct = p ? a / p : null;
      totalRow.push(p, a, pct === null ? "" : pct);
    });
    const wpct = lp ? la / lp : null;
    totalRow.push(lp, la, wpct === null ? "" : wpct);
    weekT.plan += lp; weekT.actual += la;
    s1.push(totalRow);
  }
  // Totals row
  const totRow: any[] = ["TOTAL"];
  dailyGrand.forEach((t) => {
    const p = t.plan ? t.actual / t.plan : null;
    totRow.push(t.plan, t.actual, p === null ? "" : p);
  });
  const wp = weekT.plan ? weekT.actual / weekT.plan : null;
  totRow.push(weekT.plan, weekT.actual, wp === null ? "" : wp);
  s1.push(totRow);

  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 24 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 24 } },
    // Day headers spanning 3 cols each
    ...Array.from({ length: 8 }, (_, i) => ({ s: { r: 3, c: 1 + i * 3 }, e: { r: 3, c: 3 + i * 3 } })),
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
  ];
  ws1["!cols"] = [{ wch: 18 }, ...Array(24).fill({ wch: 9 })];

  // Title style
  const titleCell = ws1["A1"]; if (titleCell) titleCell.s = { font: { bold: true, sz: 14, color: { rgb: "1E3A5F" } } };
  const subCell = ws1["A2"]; if (subCell) subCell.s = { font: { italic: true, sz: 9, color: { rgb: "6B7280" } } };

  // Style headers
  for (let c = 0; c <= 24; c++) {
    const a = XLSX.utils.encode_cell({ r: 3, c });
    const b = XLSX.utils.encode_cell({ r: 4, c });
    if (ws1[a]) ws1[a].s = { fill: headerFill, font: headerFont, alignment: centerAlign, border };
    if (ws1[b]) ws1[b].s = { fill: headerFill, font: headerFont, alignment: centerAlign, border };
  }

  // Style data rows
  const totalRowIdx = dataStartRow + lines.length * 3;
  for (let r = dataStartRow; r <= totalRowIdx; r++) {
    const isGrand = r === totalRowIdx;
    const rowOffset = (r - dataStartRow) % 3; // 0=Day, 1=Night, 2=LineTotal
    const isLineTotal = !isGrand && rowOffset === 2;
    for (let c = 0; c <= 24; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws1[addr];
      if (!cell) continue;
      const isPct = c > 0 && ((c - 1) % 3 === 2);
      const style: any = {
        border,
        alignment: c === 0 ? { horizontal: "left", vertical: "center" } : centerAlign,
        font: { name: "Calibri", sz: 10, bold: isGrand || isLineTotal || c === 0 },
      };
      if (isGrand) style.fill = totalFill;
      else if (isLineTotal) style.fill = altRowFill;
      if (isPct && typeof cell.v === "number") {
        cell.z = "0%";
        const pctVal = cell.v * 100;
        style.fill = { patternType: "solid", fgColor: { rgb: pctColorHex(pctVal) } };
        style.font = { ...style.font, bold: true };
      }
      cell.s = style;
    }
  }

  // Comments section (below totals)
  const commentEntries = lines
    .map((l) => ({ line: l, comment: (comments?.get(l) ?? "").trim() }))
    .filter((c) => c.comment);
  if (commentEntries.length) {
    const startR = s1.length + 1; // blank spacer row
    s1.push([]);
    s1.push(["Comments"]);
    for (const c of commentEntries) s1.push([c.line, c.comment]);
    // Re-generate sheet with new rows
    const ws1b = XLSX.utils.aoa_to_sheet(s1);
    // Copy over previous merges + cols
    ws1b["!merges"] = ws1["!merges"];
    ws1b["!cols"] = ws1["!cols"];
    // Re-apply styles from ws1 to ws1b for existing cells
    for (const addr of Object.keys(ws1)) {
      if (addr.startsWith("!")) continue;
      if (ws1b[addr] && (ws1 as any)[addr].s) (ws1b as any)[addr].s = (ws1 as any)[addr].s;
    }
    // Style the Comments header + rows
    const hdrAddr = XLSX.utils.encode_cell({ r: startR + 1, c: 0 });
    if (ws1b[hdrAddr]) (ws1b as any)[hdrAddr].s = { fill: headerFill, font: headerFont, alignment: { horizontal: "left", vertical: "center" }, border };
    ws1b["!merges"] = [...(ws1b["!merges"] ?? []), { s: { r: startR + 1, c: 0 }, e: { r: startR + 1, c: 24 } }];
    for (let i = 0; i < commentEntries.length; i++) {
      const r = startR + 2 + i;
      const a0 = XLSX.utils.encode_cell({ r, c: 0 });
      const a1 = XLSX.utils.encode_cell({ r, c: 1 });
      if (ws1b[a0]) (ws1b as any)[a0].s = { border, font: { name: "Calibri", sz: 10, bold: true }, alignment: { horizontal: "left", vertical: "top" } };
      if (ws1b[a1]) {
        (ws1b as any)[a1].s = { border, font: { name: "Calibri", sz: 10, italic: true }, alignment: { horizontal: "left", vertical: "top", wrapText: true }, fill: { patternType: "solid", fgColor: { rgb: "FFFBEB" } } };
      }
      ws1b["!merges"].push({ s: { r, c: 1 }, e: { r, c: 24 } });
    }
    XLSX.utils.book_append_sheet(wb, ws1b, "RAG Weekly");
  } else {
    XLSX.utils.book_append_sheet(wb, ws1, "RAG Weekly");
  }

  // =============== Sheet 2: Downtime ===============
  const dtCategories = ["WO Request", "MAINT", "Break", "Cleaning"];
  const s2: any[][] = [];
  s2.push([`Downtime · Week ${weekNo}`]);
  s2.push([]);
  s2.push(["Line", "WO Requests (min)", "Maint Downtime iTouching (min)", "Break (min)", "Cleaning (min)", "Total (min)"]);
  for (const line of lines) {
    const cells = dtCategories.map((bucket) => sumBucket(autoDtBucketMap, bucket, line, dates));
    s2.push([line, ...cells, cells.reduce((a, b) => a + b, 0)]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(s2);
  ws2["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  ws2["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  const t2 = ws2["A1"]; if (t2) t2.s = { font: { bold: true, sz: 14, color: { rgb: "1E3A5F" } } };
  for (let c = 0; c <= 5; c++) {
    const a = XLSX.utils.encode_cell({ r: 2, c });
    if (ws2[a]) ws2[a].s = { fill: headerFill, font: headerFont, alignment: centerAlign, border };
  }
  for (let r = 3; r < 3 + lines.length; r++) {
    const isAlt = (r - 3) % 2 === 1;
    for (let c = 0; c <= 5; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws2[addr]) continue;
      ws2[addr].s = {
        border,
        alignment: c === 0 ? { horizontal: "left", vertical: "center" } : centerAlign,
        font: { name: "Calibri", sz: 10, bold: c === 0 },
        ...(isAlt ? { fill: altRowFill } : {}),
      };
    }
  }
  XLSX.utils.book_append_sheet(wb, ws2, "Downtime");

  // =============== Sheet 3: Trend Data ===============
  const s3: any[][] = [];
  s3.push(["Line", ...DAY_LABELS.map((d) => `${d} %`), "Week %"]);
  for (const line of lines) {
    const m = byLine.get(line)!;
    const row: any[] = [line];
    let lp = 0, la = 0;
    dates.forEach((d) => {
      const t = m.get(d)!;
      const p = t.day.plan + t.night.plan;
      const a = t.day.actual + t.night.actual;
      lp += p; la += a;
      row.push(p ? a / p : "");
    });
    row.push(lp ? la / lp : "");
    s3.push(row);
  }
  const ws3 = XLSX.utils.aoa_to_sheet(s3);
  ws3["!cols"] = [{ wch: 18 }, ...Array(8).fill({ wch: 10 })];
  for (let c = 0; c <= 8; c++) {
    const a = XLSX.utils.encode_cell({ r: 0, c });
    if (ws3[a]) ws3[a].s = { fill: headerFill, font: headerFont, alignment: centerAlign, border };
  }
  for (let r = 1; r <= lines.length; r++) {
    for (let c = 0; c <= 8; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws3[addr];
      if (!cell) continue;
      const style: any = {
        border,
        alignment: c === 0 ? { horizontal: "left" } : centerAlign,
        font: { name: "Calibri", sz: 10, bold: c === 0 },
      };
      if (c > 0 && typeof cell.v === "number") {
        cell.z = "0.0%";
        const pctVal = cell.v * 100;
        style.fill = { patternType: "solid", fgColor: { rgb: pctColorHex(pctVal) } };
      }
      cell.s = style;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws3, "Trend Data");

  XLSX.writeFile(wb, `RAG-Weekly-W${weekNo}-${format(weekStart, "yyyy-MM-dd")}.xlsx`);
}
