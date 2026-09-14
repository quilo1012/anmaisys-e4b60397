/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable cells are loosely typed */
/**
 * A matriz de padrões fora do ecrã: achatada para o papel e para a folha de cálculo.
 *
 * O ecrã lê o `HeatmapResult` em Maps; o autoTable e o XLSX querem 14 colunas em
 * fila (7 dias × 2 turnos). Essa tradução estava escrita à mão dentro da página de
 * Downtime, e o armazém precisava dela igual. Escrita uma vez, o PDF da manutenção
 * e o do armazém não podem divergir na ordem das colunas.
 */
import autoTable from "jspdf-autotable";
import { DAYS, type HeatmapResult } from "@/lib/downtimeHeatmap";
import { formatMinutes } from "@/lib/formatDuration";
import { CARD_BORDER, INK, SUBTLE, type ReportChrome } from "@/lib/reportChrome";

export interface ReportMatrix {
  /** `cells` tem 14 entradas: dia 0 Dia, dia 0 Noite, dia 1 Dia, … */
  rows: { line: string; cells: string[]; total: string }[];
  totals: string[];
  grandTotal: string;
}

/** Os cabeçalhos das 14 colunas, na mesma ordem que `cells`. */
export const MATRIX_COLUMN_LABELS: string[] = DAYS.flatMap((d) => [`${d} D`, `${d} N`]);

export function buildReportMatrix(
  hm: HeatmapResult,
  opts?: { emptyRowLabel?: string },
): ReportMatrix | undefined {
  if (!hm.lines.length) return undefined;
  const emptyRowLabel = opts?.emptyRowLabel ?? "(line removed)";
  const cellVal = (line: string, di: number, s: "Day" | "Night") => {
    const c = hm.matrix.get(line)?.get(`${di}-${s}`);
    return c && c.minutes > 0 ? formatMinutes(c.minutes) : "—";
  };
  const flat14 = (fn: (di: number, s: "Day" | "Night") => string) =>
    Array.from({ length: 7 }, (_, di) => [fn(di, "Day"), fn(di, "Night")]).flat();
  return {
    rows: hm.lines.map((line) => ({
      line: line === "—" ? emptyRowLabel : line,
      cells: flat14((di, s) => cellVal(line, di, s)),
      total: formatMinutes(hm.lineTotals.get(line)?.minutes ?? 0),
    })),
    totals: flat14((di, s) => {
      const v = hm.dayShiftTotals.get(`${di}-${s}`)?.minutes ?? 0;
      return v > 0 ? formatMinutes(v) : "—";
    }),
    grandTotal: formatMinutes(hm.grandTotalMinutes),
  };
}

/** A mesma matriz em linhas planas, para uma folha de Excel. */
export function matrixToSheetRows(matrix: ReportMatrix, rowHeader = "Line"): Record<string, string>[] {
  const row = (label: string, cells: string[], total: string) => {
    const out: Record<string, string> = { [rowHeader]: label };
    MATRIX_COLUMN_LABELS.forEach((h, i) => { out[h] = cells[i] ?? "—"; });
    out.Total = total;
    return out;
  };
  return [
    ...matrix.rows.map((r) => row(r.line, r.cells, r.total)),
    row("Totals (wall-clock)", matrix.totals, matrix.grandTotal),
  ];
}

export function drawPatternMatrixSection(
  chrome: ReportChrome,
  matrix: ReportMatrix,
  opts: { title: string; rowHeader?: string },
) {
  const { title, rowHeader = "Line" } = opts;
  chrome.sectionTitle(title);
  const head: any[] = [{ content: rowHeader, styles: { halign: "left" } }];
  MATRIX_COLUMN_LABELS.forEach((h) => head.push(h));
  head.push("Total");
  autoTable(chrome.doc, {
    ...chrome.commonTable,
    startY: chrome.y,
    head: [head],
    body: matrix.rows.map((r) => [
      { content: r.line, styles: { fontStyle: "bold" as const, halign: "left" as const } },
      ...r.cells.map((c) => ({ content: c, styles: { halign: "center" as const, textColor: (c === "—" ? SUBTLE : INK) as any } })),
      { content: r.total, styles: { halign: "right" as const, fontStyle: "bold" as const } },
    ]),
    foot: [[
      { content: "Totals (wall-clock)", styles: { fontStyle: "bold" as const, halign: "left" as const } },
      ...matrix.totals.map((c) => ({ content: c, styles: { halign: "center" as const } })),
      { content: matrix.grandTotal, styles: { halign: "right" as const } },
    ]],
    styles: { ...chrome.commonTable.styles, fontSize: 6.5, cellPadding: 1.2 },
    footStyles: { fillColor: CARD_BORDER as any, textColor: INK as any, fontStyle: "bold" as const },
  });
  chrome.afterTable();
}
