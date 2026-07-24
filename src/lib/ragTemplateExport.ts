import { format, addDays, getISOWeek } from "date-fns";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Per-day columns: Day, Night, Total => 3 cols per day, 7 days = 21 cols + label + week total
// Layout:
//   col 1            -> metric label
//   cols 2..22       -> 7 days × (Day | Night | Total)
//   cols 23..25      -> Week Day | Week Night | Week Total
const DAYS = 7;
const COLS_PER_DAY = 3;
const FIRST_DATA_COL = 2;
const LAST_DAY_COL = FIRST_DATA_COL + DAYS * COLS_PER_DAY - 1; // 22
const WEEK_DAY_COL = LAST_DAY_COL + 1; // 23
const WEEK_NIGHT_COL = LAST_DAY_COL + 2; // 24
const WEEK_TOTAL_COL = LAST_DAY_COL + 3; // 25
const TOTAL_COLS = WEEK_TOTAL_COL;

/** One editable metric a filled export can pre-populate. */
export type RagFillField = "plan" | "actual" | "upmTarget" | "upmActual" | "downtime";

export interface RagFillCell {
  plan?: number;
  actual?: number;
  upmTarget?: number;
  upmActual?: number;
  downtime?: number;
}

/**
 * Data source for a *filled* export. Both callbacks are optional-return:
 * missing values simply leave the corresponding cell blank, exactly like the
 * empty template. Keys are the literal DB line name, ISO date (yyyy-MM-dd) and
 * shift — matching what the importer reads back.
 */
export interface RagFill {
  get: (line: string, dateStr: string, shift: "DAY" | "NIGHT") => RagFillCell | undefined;
  comment: (line: string) => string | undefined;
}

type Metric = {
  label: string;
  fill: string;
  field?: RagFillField;
  isVariance?: boolean;
  isComment?: boolean;
};

const METRICS: Metric[] = [
  { label: "Plan", fill: "FFF8FAFC", field: "plan" },
  { label: "Actual", fill: "FFFFFFFF", field: "actual" },
  { label: "Variance %", fill: "FFF1F5F9", isVariance: true },
  { label: "UPM Target", fill: "FFF8FAFC", field: "upmTarget" },
  { label: "UPM Actual", fill: "FFFFFFFF", field: "upmActual" },
  { label: "Downtime (min)", fill: "FFFEF2F2", field: "downtime" },
  { label: "Comments", fill: "FFFFFFFF", isComment: true },
];

/**
 * Build the RAG Weekly workbook. When `fill` is omitted the result is the blank
 * template (formulas + empty input cells). When `fill` is provided the input
 * cells are pre-populated with real data while every derived cell (Total,
 * Variance %, Week roll-up, All-Lines block) stays a live formula — so the file
 * is simultaneously a report *and* a re-importable template.
 */
async function buildRagWorkbook(weekStart: Date, lines: string[], fill?: RagFill) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AN Maintenance";
  wb.created = new Date();
  const ws = wb.addWorksheet(`Week ${getISOWeek(weekStart)}`, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }],
  });

  const dates = Array.from({ length: DAYS }, (_, i) => addDays(weekStart, i));
  const dateStrs = dates.map((d) => format(d, "yyyy-MM-dd"));

  ws.columns = [
    { width: 22 },
    ...Array.from({ length: DAYS * COLS_PER_DAY }, () => ({ width: 9 })),
    { width: 10 },
    { width: 10 },
    { width: 11 },
  ];

  const border = {
    top: { style: "thin" as const, color: { argb: "FFCCCCCC" } },
    left: { style: "thin" as const, color: { argb: "FFCCCCCC" } },
    bottom: { style: "thin" as const, color: { argb: "FFCCCCCC" } },
    right: { style: "thin" as const, color: { argb: "FFCCCCCC" } },
  };

  // Title
  ws.mergeCells(1, 1, 1, TOTAL_COLS);
  const title = ws.getCell(1, 1);
  title.value = `RAG Weekly · Week ${getISOWeek(weekStart)} · ${format(weekStart, "dd MMM")} – ${format(addDays(weekStart, 6), "dd MMM yyyy")}`;
  title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1978E5" } };
  ws.getRow(1).height = 24;

  const writeDayHeader = (row: number) => {
    // Date row (merge 3 cols per day)
    for (let i = 0; i < DAYS; i++) {
      const c1 = FIRST_DATA_COL + i * COLS_PER_DAY;
      const c2 = c1 + COLS_PER_DAY - 1;
      ws.mergeCells(row, c1, row, c2);
      const cell = ws.getCell(row, c1);
      cell.value = `${DAY_LABELS[i]} ${format(dates[i], "dd/MM")}`;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.border = border;
    }
    ws.mergeCells(row, WEEK_DAY_COL, row, WEEK_TOTAL_COL);
    const wk = ws.getCell(row, WEEK_DAY_COL);
    wk.value = "Week Total";
    wk.font = { bold: true };
    wk.alignment = { horizontal: "center" };
    wk.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCBD5E1" } };
    wk.border = border;

    // Sub-header Day/Night/Total
    const sub = row + 1;
    for (let i = 0; i < DAYS; i++) {
      const base = FIRST_DATA_COL + i * COLS_PER_DAY;
      const d = ws.getCell(sub, base);
      d.value = "Day";
      d.font = { bold: true, color: { argb: "FF92400E" } };
      d.alignment = { horizontal: "center" };
      d.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      d.border = border;
      const n = ws.getCell(sub, base + 1);
      n.value = "Night";
      n.font = { bold: true, color: { argb: "FF1E3A8A" } };
      n.alignment = { horizontal: "center" };
      n.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
      n.border = border;
      const t = ws.getCell(sub, base + 2);
      t.value = "Total";
      t.font = { bold: true };
      t.alignment = { horizontal: "center" };
      t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      t.border = border;
    }
    for (const c of [WEEK_DAY_COL, WEEK_NIGHT_COL, WEEK_TOTAL_COL]) {
      const cell = ws.getCell(sub, c);
      cell.value = c === WEEK_DAY_COL ? "Day" : c === WEEK_NIGHT_COL ? "Night" : "Total";
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: c === WEEK_DAY_COL ? "FFFEF3C7" : c === WEEK_NIGHT_COL ? "FFDBEAFE" : "FFCBD5E1" },
      };
      cell.border = border;
    }
  };

  const colLetter = (c: number) => ws.getColumn(c).letter;

  // Writes the metric rows for a given line/section starting at `row`.
  // Returns the first row of the metrics (used by callers for cross-row formulas).
  const writeMetrics = (row: number, metrics: Metric[], line: string) => {
    const firstMetricRow = row;
    const planRow = firstMetricRow; // Plan is first
    const actualRow = firstMetricRow + 1; // Actual is second

    metrics.forEach((m) => {
      const r = ws.getRow(row);
      const lbl = r.getCell(1);
      lbl.value = m.label;
      lbl.font = { bold: true };
      lbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: m.fill } };
      lbl.border = border;
      lbl.alignment = { horizontal: "left", indent: 1 };

      // Per-day Day/Night/Total
      for (let i = 0; i < DAYS; i++) {
        const base = FIRST_DATA_COL + i * COLS_PER_DAY;
        const day = r.getCell(base);
        const night = r.getCell(base + 1);
        const total = r.getCell(base + 2);
        [day, night, total].forEach((c) => {
          c.border = border;
          c.alignment = { horizontal: "center" };
        });

        if (m.isComment) {
          ws.mergeCells(row, base, row, base + 2);
          const merged = ws.getCell(row, base);
          merged.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
          merged.border = border;
          continue;
        }

        if (m.isVariance) {
          day.value = { formula: `IFERROR(${colLetter(base)}${actualRow}/${colLetter(base)}${planRow},"")` };
          night.value = { formula: `IFERROR(${colLetter(base + 1)}${actualRow}/${colLetter(base + 1)}${planRow},"")` };
          total.value = { formula: `IFERROR(${colLetter(base + 2)}${actualRow}/${colLetter(base + 2)}${planRow},"")` };
          [day, night, total].forEach((c) => (c.numFmt = "0.0%;-0.0%;-"));
        } else {
          day.numFmt = "#,##0;-#,##0;-";
          night.numFmt = "#,##0;-#,##0;-";
          // Pre-fill editable input cells when data is supplied. Zero / missing
          // values stay blank so the sheet reads the same as the empty template.
          if (fill && m.field) {
            const dayVal = fill.get(line, dateStrs[i], "DAY")?.[m.field];
            const nightVal = fill.get(line, dateStrs[i], "NIGHT")?.[m.field];
            if (typeof dayVal === "number" && dayVal !== 0) day.value = dayVal;
            if (typeof nightVal === "number" && nightVal !== 0) night.value = nightVal;
          }
          total.value = { formula: `${colLetter(base)}${row}+${colLetter(base + 1)}${row}` };
          total.numFmt = "#,##0;-#,##0;-";
          total.font = { bold: true };
          total.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
        }
      }

      // Week roll-up: Day, Night, Total
      if (m.isComment) {
        ws.mergeCells(row, WEEK_DAY_COL, row, WEEK_TOTAL_COL);
        const merged = ws.getCell(row, WEEK_DAY_COL);
        merged.border = border;
        merged.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        // The app stores one comment per line per week — park it in the Week
        // Total slot of the Comments row. The importer reads it back from here.
        if (fill) {
          const c = fill.comment(line);
          if (c && c.trim()) merged.value = c.trim();
        }
      } else if (m.isVariance) {
        const wd = r.getCell(WEEK_DAY_COL);
        const wn = r.getCell(WEEK_NIGHT_COL);
        const wt = r.getCell(WEEK_TOTAL_COL);
        wd.value = { formula: `IFERROR(${colLetter(WEEK_DAY_COL)}${actualRow}/${colLetter(WEEK_DAY_COL)}${planRow},"")` };
        wn.value = { formula: `IFERROR(${colLetter(WEEK_NIGHT_COL)}${actualRow}/${colLetter(WEEK_NIGHT_COL)}${planRow},"")` };
        wt.value = { formula: `IFERROR(${colLetter(WEEK_TOTAL_COL)}${actualRow}/${colLetter(WEEK_TOTAL_COL)}${planRow},"")` };
        [wd, wn, wt].forEach((c) => {
          c.border = border;
          c.alignment = { horizontal: "center" };
          c.numFmt = "0.0%;-0.0%;-";
          c.font = { bold: true };
        });
      } else {
        // Sum of Day cells across week / Night cells across week / Total cells
        const dayCells: string[] = [];
        const nightCells: string[] = [];
        const totalCells: string[] = [];
        for (let i = 0; i < DAYS; i++) {
          const base = FIRST_DATA_COL + i * COLS_PER_DAY;
          dayCells.push(`${colLetter(base)}${row}`);
          nightCells.push(`${colLetter(base + 1)}${row}`);
          totalCells.push(`${colLetter(base + 2)}${row}`);
        }
        const wd = r.getCell(WEEK_DAY_COL);
        const wn = r.getCell(WEEK_NIGHT_COL);
        const wt = r.getCell(WEEK_TOTAL_COL);
        wd.value = { formula: `SUM(${dayCells.join(",")})` };
        wn.value = { formula: `SUM(${nightCells.join(",")})` };
        wt.value = { formula: `SUM(${totalCells.join(",")})` };
        [wd, wn, wt].forEach((c) => {
          c.border = border;
          c.alignment = { horizontal: "center" };
          c.numFmt = "#,##0;-#,##0;-";
          c.font = { bold: true };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
        });
      }

      row++;
    });

    // RAG conditional formatting on Variance % row across all per-day Day/Night/Total cells + week roll-up
    const varianceRow = firstMetricRow + 2;
    const ref = `${colLetter(FIRST_DATA_COL)}${varianceRow}:${colLetter(WEEK_TOTAL_COL)}${varianceRow}`;
    ws.addConditionalFormatting({
      ref,
      rules: [
        {
          type: "cellIs",
          operator: "greaterThanOrEqual" as any,
          formulae: ["0.95"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD1FAE5" } } },
          priority: 1,
        },
        {
          type: "cellIs",
          operator: "greaterThanOrEqual" as any,
          formulae: ["0.80"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } } },
          priority: 2,
        },
        {
          type: "cellIs",
          operator: "lessThan" as any,
          formulae: ["0.80"],
          style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFECACA" } } },
          priority: 3,
        },
      ],
    });

    return { planRow, actualRow, varianceRow, nextRow: row };
  };

  let row = 3;
  // Track Plan/Actual rows per line so we can build grand totals
  const lineRows: { plan: number; actual: number }[] = [];

  for (const line of lines) {
    // Line header
    ws.mergeCells(row, 1, row, TOTAL_COLS);
    const lc = ws.getCell(row, 1);
    lc.value = line;
    lc.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    lc.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getRow(row).height = 20;
    row++;

    // Day header (2 rows: dates + Day/Night/Total)
    writeDayHeader(row);
    row += 2;

    const { planRow, actualRow, nextRow } = writeMetrics(row, METRICS, line);
    lineRows.push({ plan: planRow, actual: actualRow });
    row = nextRow + 1; // spacer
  }

  // ===== Grand totals: All Lines — Plan / Actual / Variance =====
  ws.mergeCells(row, 1, row, TOTAL_COLS);
  const gh = ws.getCell(row, 1);
  gh.value = "All Lines";
  gh.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  gh.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  gh.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  ws.getRow(row).height = 20;
  row++;

  writeDayHeader(row);
  row += 2;

  const buildSum = (col: number, sourceRows: number[]) =>
    `SUM(${sourceRows.map((r) => `${colLetter(col)}${r}`).join(",")})`;

  const writeTotalsRow = (label: string, sourceRows: number[], fillArgb: string) => {
    const r = ws.getRow(row);
    const lbl = r.getCell(1);
    lbl.value = `All Lines — ${label}`;
    lbl.font = { bold: true, color: { argb: "FFFFFFFF" } };
    lbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
    lbl.alignment = { horizontal: "left", indent: 1 };
    lbl.border = border;

    for (let c = FIRST_DATA_COL; c <= WEEK_TOTAL_COL; c++) {
      const cell = r.getCell(c);
      cell.value = { formula: buildSum(c, sourceRows) };
      cell.numFmt = "#,##0;-#,##0;-";
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
      cell.alignment = { horizontal: "center" };
      cell.border = border;
    }
    row++;
  };

  const planRows = lineRows.map((l) => l.plan);
  const actualRows = lineRows.map((l) => l.actual);
  writeTotalsRow("Plan", planRows, "FF1E293B");
  const allPlanRow = row - 1;
  writeTotalsRow("Actual", actualRows, "FF334155");
  const allActualRow = row - 1;

  // Variance % row
  const varR = ws.getRow(row);
  const vlbl = varR.getCell(1);
  vlbl.value = "All Lines — Variance %";
  vlbl.font = { bold: true, color: { argb: "FFFFFFFF" } };
  vlbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
  vlbl.alignment = { horizontal: "left", indent: 1 };
  vlbl.border = border;
  for (let c = FIRST_DATA_COL; c <= WEEK_TOTAL_COL; c++) {
    const cell = varR.getCell(c);
    cell.value = {
      formula: `IFERROR(${colLetter(c)}${allActualRow}/${colLetter(c)}${allPlanRow},"")`,
    };
    cell.numFmt = "0.0%;-0.0%;-";
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center" };
    cell.border = border;
  }
  const allVarRow = row;
  ws.addConditionalFormatting({
    ref: `${colLetter(FIRST_DATA_COL)}${allVarRow}:${colLetter(WEEK_TOTAL_COL)}${allVarRow}`,
    rules: [
      {
        type: "cellIs",
        operator: "greaterThanOrEqual" as any,
        formulae: ["0.95"],
        style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD1FAE5" } } },
        priority: 1,
      },
      {
        type: "cellIs",
        operator: "greaterThanOrEqual" as any,
        formulae: ["0.80"],
        style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } } },
        priority: 2,
      },
      {
        type: "cellIs",
        operator: "lessThan" as any,
        formulae: ["0.80"],
        style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFECACA" } } },
        priority: 3,
      },
    ],
  });
  row++;

  // Instructions sheet
  const info = wb.addWorksheet("Instructions");
  info.columns = [{ width: 110 }];
  [
    "RAG Weekly Template",
    "",
    "Per line, fill in the white/grey cells under Day and Night for each day:",
    "  • Plan, Actual, UPM Target, UPM Actual, Downtime (min), Comments",
    "Auto-calculated (do NOT edit):",
    "  • Total column per day (= Day + Night)",
    "  • Variance % row (= Actual / Plan) with RAG colours (≥95% green, ≥80% amber, else red)",
    "  • Week Total (Day / Night / Total) on the right",
    "  • All Lines block at the bottom (sum of every line)",
    "Do NOT rename the line headers, the metric labels, or move columns — the importer relies on this layout.",
    "When finished, upload via RAG Weekly → Import Excel.",
  ].forEach((t, i) => {
    const c = info.getCell(i + 1, 1);
    c.value = t;
    if (i === 0) c.font = { bold: true, size: 14 };
    c.alignment = { wrapText: true };
  });

  return wb;
}

async function downloadWorkbook(wb: unknown, filename: string) {
  const buf = await (wb as { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } }).xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build the workbook and return its xlsx bytes without touching the DOM.
 * Used by the download helpers and by round-trip tests.
 */
export async function buildRagWorkbookBuffer(
  weekStart: Date,
  lines: string[],
  fill?: RagFill,
): Promise<ArrayBuffer> {
  const wb = await buildRagWorkbook(weekStart, lines, fill);
  return wb.xlsx.writeBuffer();
}

/** Blank template — empty input cells + live formulas. */
export async function downloadRagTemplate(weekStart: Date, lines: string[]) {
  const wb = await buildRagWorkbook(weekStart, lines);
  await downloadWorkbook(wb, `rag-template-week${getISOWeek(weekStart)}-${format(weekStart, "yyyy-MM-dd")}.xlsx`);
}

/**
 * Filled template — identical layout to `downloadRagTemplate`, but with the
 * week's real Plan / Actual / UPM / Downtime / Comments pre-populated. Because
 * the layout matches the importer exactly, the user can download it, edit in
 * Excel, and re-import via RAG Weekly → Import Excel.
 */
export async function exportRagFilledTemplate(weekStart: Date, lines: string[], fill: RagFill) {
  const wb = await buildRagWorkbook(weekStart, lines, fill);
  await downloadWorkbook(wb, `rag-weekly-week${getISOWeek(weekStart)}-${format(weekStart, "yyyy-MM-dd")}.xlsx`);
}
