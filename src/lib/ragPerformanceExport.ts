// Exports the RAG Weekly data as the factory's own "Production Line Performance
// — RAG status" workbook: one sheet per week ("WC DDMMYY"), each line a block
// with a Day/Night/Total header and Plan / Actual / Variance / UPM target / UPM
// actual / Downtime / Comments rows across Mon–Sun, plus a Progressive-week
// roll-up and an All-Lines totals block. The layout matches parseRagPerformanceFile,
// so a downloaded sheet can be edited and re-imported.

import { format, addDays } from "date-fns";
import type { RagFill } from "./ragTemplateExport";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAYS = 7;
const FIRST = 3; // col C (Monday · Day)
const WD = 24, WN = 25, WT = 26, AA = 27; // Progressive Day/Night/Total + downtime-minutes
const UPM_DIV = 19 * 60; // available minutes/day used for UPM = qty / minute

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
const dayBase = (i: number) => FIRST + i * 3;

const NAVY = "FF1E3A5F", SLATE = "FF334155", INK = "FF0F172A";
const DAYFILL = "FFFEF3C7", NIGHTFILL = "FFDBEAFE", TOTFILL = "FFE2E8F0", GREY = "FFF3F4F6", COMFILL = "FFFFFBEB";

const METRICS: { label: string; field?: "plan" | "actual" | "upmTarget" | "upmActual" | "downtime"; kind: "num" | "variance" | "upm" | "downtime" | "comment" }[] = [
  { label: "Plan", field: "plan", kind: "num" },
  { label: "Actual", field: "actual", kind: "num" },
  { label: "Variance", kind: "variance" },
  { label: "UPM target", kind: "upm" },
  { label: "UPM actual", kind: "upm" },
  { label: "Downtime", kind: "downtime" },
  { label: "Comments", kind: "comment" },
];

async function buildRagPerformanceWorkbook(weekStart: Date, lines: string[], fill: RagFill) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AN Maintenance";
  wb.created = new Date();
  const ws = wb.addWorksheet(`WC ${format(weekStart, "ddMMyy")}`, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 5 }],
  });

  const dates = Array.from({ length: DAYS }, (_, i) => addDays(weekStart, i));
  const dateStrs = dates.map((d) => format(d, "yyyy-MM-dd"));

  ws.columns = [
    { width: 2.5 },
    { width: 15 },
    ...Array.from({ length: DAYS * 3 }, () => ({ width: 7.5 })),
    { width: 8 }, { width: 8 }, { width: 9 }, { width: 7 },
  ];

  const thin = { style: "thin" as const, color: { argb: "FFC7CDD6" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

  // ── Title band ──────────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, AA);
  const t = ws.getCell(1, 1);
  t.value = "APPLIED NUTRITION";
  t.font = { name: "Calibri", bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  t.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  t.fill = solid(NAVY);
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, AA);
  const st = ws.getCell(2, 1);
  st.value = `Production Line Performance — RAG status   ·   Week commencing ${format(weekStart, "dd MMM yyyy")}`;
  st.font = { bold: true, size: 11, color: { argb: NAVY } };
  st.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  st.fill = solid(GREY);

  const varianceRule = (row: number) => {
    const ref = `${colLetter(FIRST)}${row}:${colLetter(WT)}${row}`;
    ws.addConditionalFormatting({
      ref,
      rules: [
        { type: "cellIs", operator: "greaterThanOrEqual" as any, formulae: ["-0.05"], style: { fill: solid("FFD1FAE5") }, priority: 1 },
        { type: "cellIs", operator: "between" as any, formulae: ["-0.2", "-0.05"], style: { fill: solid("FFFEF3C7") }, priority: 2 },
        { type: "cellIs", operator: "lessThan" as any, formulae: ["-0.2"], style: { fill: solid("FFFECACA") }, priority: 3 },
      ],
    });
  };

  const paRows: { plan: number; actual: number }[] = [];
  let row = 6;

  for (const line of lines) {
    const nameRow = row;
    const hoursRow = row - 3, daysRow = row - 2, datesRow = row - 1;

    // Hours row (12 per active shift)
    const hl = ws.getCell(hoursRow, 2);
    hl.value = "Hrs"; hl.font = { italic: true, size: 9, color: { argb: "FF64748B" } }; hl.alignment = { horizontal: "left", indent: 1 };
    for (let i = 0; i < DAYS; i++) {
      const b = dayBase(i);
      const day = fill.get(line, dateStrs[i], "DAY");
      const night = fill.get(line, dateStrs[i], "NIGHT");
      const hrs = 12 * (day?.plan || day?.actual ? 1 : 0) + 12 * (night?.plan || night?.actual ? 1 : 0);
      ws.mergeCells(hoursRow, b, hoursRow, b + 2);
      const c = ws.getCell(hoursRow, b);
      if (hrs) c.value = hrs;
      c.font = { italic: true, size: 9, color: { argb: "FF64748B" } };
      c.alignment = { horizontal: "center" };
    }

    // Day names + dates
    for (let i = 0; i < DAYS; i++) {
      const b = dayBase(i);
      ws.mergeCells(daysRow, b, daysRow, b + 2);
      const dn = ws.getCell(daysRow, b);
      dn.value = DAY_NAMES[i]; dn.font = { bold: true }; dn.alignment = { horizontal: "center" }; dn.fill = solid(TOTFILL); dn.border = border;
      ws.mergeCells(datesRow, b, datesRow, b + 2);
      const dc = ws.getCell(datesRow, b);
      dc.value = dates[i]; dc.numFmt = "ddd dd/mm"; dc.alignment = { horizontal: "center" }; dc.border = border; dc.font = { size: 9 };
    }
    ws.mergeCells(datesRow, WD, datesRow, WT);
    const pw = ws.getCell(datesRow, WD);
    pw.value = "Progressive week to date"; pw.font = { bold: true, italic: true, size: 9 }; pw.alignment = { horizontal: "center" };

    // Header row (line name + Day/Night/Total ×7 + progressive)
    const ln = ws.getCell(nameRow, 2);
    ln.value = line; ln.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }; ln.fill = solid(SLATE); ln.alignment = { horizontal: "left", indent: 1 }; ln.border = border;
    ws.getRow(nameRow).height = 18;
    const groups = [...Array.from({ length: DAYS }, (_, i) => [dayBase(i), dayBase(i) + 1, dayBase(i) + 2]), [WD, WN, WT]];
    for (const [b, n, tt] of groups) {
      for (const [col, txt] of [[b, "Day"], [n, "Night"], [tt, "Total"]] as [number, string][]) {
        const c = ws.getCell(nameRow, col);
        c.value = txt; c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; c.fill = solid(SLATE); c.alignment = { horizontal: "center" }; c.border = border;
      }
    }

    const planRow = nameRow + 1, actualRow = nameRow + 2;
    paRows.push({ plan: planRow, actual: actualRow });

    METRICS.forEach((m, k) => {
      const r = nameRow + 1 + k;
      const lc = ws.getCell(r, 2);
      lc.value = m.label; lc.font = { bold: true, size: 10 }; lc.border = border; lc.alignment = { horizontal: "left", indent: 1 };
      lc.fill = solid(m.label === "Plan" || m.label === "UPM target" ? GREY : "FFFFFFFF");

      if (m.kind === "comment") {
        ws.mergeCells(r, FIRST, r + 9, WT);
        const c = ws.getCell(r, FIRST);
        const text = fill.comment(line);
        if (text && text.trim()) c.value = text.trim();
        c.alignment = { horizontal: "left", vertical: "top", wrapText: true }; c.fill = solid(COMFILL); c.border = border;
        return;
      }

      for (let i = 0; i < DAYS; i++) {
        const b = dayBase(i), n = b + 1, tt = b + 2;
        const cells = [b, n, tt];
        for (const col of cells) { const c = ws.getCell(r, col); c.border = border; c.alignment = { horizontal: "center" }; c.font = { size: 10 }; }
        const cell = fill.get(line, dateStrs[i], "DAY");
        const cellN = fill.get(line, dateStrs[i], "NIGHT");
        if (m.kind === "num" && m.field) {
          const dv = m.field === "plan" ? cell?.plan : cell?.actual;
          const nv = m.field === "plan" ? cellN?.plan : cellN?.actual;
          if (typeof dv === "number" && dv) ws.getCell(r, b).value = dv;
          if (typeof nv === "number" && nv) ws.getCell(r, n).value = nv;
          for (const col of [b, n]) ws.getCell(r, col).numFmt = "#,##0;-#,##0;";
          const tc = ws.getCell(r, tt);
          tc.value = { formula: `SUM(${colLetter(b)}${r},${colLetter(n)}${r})` };
          tc.numFmt = "#,##0;-#,##0;"; tc.font = { bold: true, size: 10 }; tc.fill = solid(TOTFILL);
        } else if (m.kind === "variance") {
          for (const col of cells) {
            const c = ws.getCell(r, col);
            c.value = { formula: `IFERROR(${colLetter(col)}${actualRow}/${colLetter(col)}${planRow}-1,"")` };
            c.numFmt = "0%";
          }
        } else if (m.kind === "upm") {
          const src = m.label === "UPM target" ? planRow : actualRow;
          const c = ws.getCell(r, tt);
          c.value = { formula: `IFERROR(${colLetter(tt)}${src}/${UPM_DIV},"")` };
          c.numFmt = "0.00"; c.fill = solid(TOTFILL);
        } else if (m.kind === "downtime") {
          const mins = (cell?.downtime ?? 0) + (cellN?.downtime ?? 0);
          const c = ws.getCell(r, tt);
          if (mins) c.value = mins / 1440;
          c.numFmt = "[h]:mm"; c.fill = solid(TOTFILL);
        }
      }

      // Progressive week to date
      if (m.kind === "num") {
        for (const [col, idx] of [[WD, 0], [WN, 1], [WT, 2]] as [number, number][]) {
          const parts = Array.from({ length: DAYS }, (_, i) => `${colLetter(dayBase(i) + idx)}${r}`);
          const c = ws.getCell(r, col);
          c.value = { formula: `SUM(${parts.join(",")})` };
          c.numFmt = "#,##0;-#,##0;"; c.font = { bold: true, size: 10 }; c.fill = solid(TOTFILL); c.border = border; c.alignment = { horizontal: "center" };
        }
      } else if (m.kind === "variance") {
        for (const col of [WD, WN, WT]) {
          const c = ws.getCell(r, col);
          c.value = { formula: `IFERROR(${colLetter(col)}${actualRow}/${colLetter(col)}${planRow}-1,"")` };
          c.numFmt = "0%"; c.border = border; c.alignment = { horizontal: "center" };
        }
      } else if (m.kind === "upm") {
        const src = m.label === "UPM target" ? planRow : actualRow;
        const c = ws.getCell(r, WT);
        c.value = { formula: `IFERROR(${colLetter(WT)}${src}/${UPM_DIV},"")` };
        c.numFmt = "0.00"; c.border = border; c.alignment = { horizontal: "center" };
      } else if (m.kind === "downtime") {
        let tot = 0;
        for (let i = 0; i < DAYS; i++) {
          tot += (fill.get(line, dateStrs[i], "DAY")?.downtime ?? 0) + (fill.get(line, dateStrs[i], "NIGHT")?.downtime ?? 0);
        }
        const c = ws.getCell(r, AA);
        if (tot) c.value = tot;
        c.font = { size: 9, color: { argb: "FF64748B" } }; c.alignment = { horizontal: "center" };
      }

      if (m.kind === "variance") varianceRule(r);
    });

    row = nameRow + 21;
  }

  // ── All Lines totals ────────────────────────────────────────────────────
  const gh = row;
  ws.mergeCells(gh, 2, gh, AA);
  const g = ws.getCell(gh, 2);
  g.value = "ALL LINES — week to date"; g.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }; g.fill = solid(INK); g.alignment = { horizontal: "left", indent: 1 };
  const totals: [string, number][] = [["Plan", 1], ["Actual", 2], ["Variance", 3]];
  for (const [label, off] of totals) {
    const r = gh + off;
    const lc = ws.getCell(r, 2);
    lc.value = label; lc.font = { bold: true, size: 10 }; lc.border = border; lc.alignment = { horizontal: "left", indent: 1 };
    for (let col = FIRST; col <= WT; col++) {
      const c = ws.getCell(r, col);
      if (label === "Plan" || label === "Actual") {
        const src = label === "Plan" ? "plan" : "actual";
        const parts = paRows.map((p) => `${colLetter(col)}${p[src as "plan" | "actual"]}`);
        c.value = { formula: `SUM(${parts.join(",")})` };
        c.numFmt = "#,##0;-#,##0;";
      } else {
        c.value = { formula: `IFERROR(${colLetter(col)}${gh + 2}/${colLetter(col)}${gh + 1}-1,"")` };
        c.numFmt = "0%";
      }
      c.border = border; c.alignment = { horizontal: "center" }; c.font = { bold: true, size: 10 };
    }
    if (label === "Variance") varianceRule(r);
  }

  return wb;
}

/** Build the workbook bytes without touching the DOM (used by tests). */
export async function buildRagPerformanceBuffer(weekStart: Date, lines: string[], fill: RagFill): Promise<ArrayBuffer> {
  const wb = await buildRagPerformanceWorkbook(weekStart, lines, fill);
  return wb.xlsx.writeBuffer();
}

export async function exportRagPerformance(weekStart: Date, lines: string[], fill: RagFill) {
  const buf = await buildRagPerformanceBuffer(weekStart, lines, fill);
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `RAG-Weekly-WC${format(weekStart, "ddMMyy")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
