/**
 * A folha das esperas do armazém: a mesma moldura da Downtime & Reliability, a
 * mesma matriz dia × turno, e por baixo as esperas uma a uma.
 *
 * O título diz "Warehouse Waits" e não "Downtime" de propósito. Uma espera do
 * armazém nunca contou como avaria de linha, e uma folha assinada e arquivada é
 * o pior sítio para deixar essa confusão por dizer — daí também a nota no rodapé
 * dos KPIs.
 */
import autoTable from "jspdf-autotable";
import { createReportChrome, statusChip, AMBER_TX, INK, NAVY, SUBTLE } from "@/lib/reportChrome";
import { drawPatternMatrixSection, type ReportMatrix } from "@/lib/patternMatrixReport";

export interface WarehouseReportInput {
  rangeLabel: string;
  filtersLabel: string;
  kpis: {
    /** Tempo de parede: esperas em paralelo em linhas diferentes contam uma vez. */
    totalWait: string;
    /** A parte do total que saiu de ordens que o poll não fechou. */
    totalUnmeasured?: string;
    /** A soma por linha — o mesmo tempo, contado uma vez por linha parada. */
    lineWait: string;
    waits: number;
    linesAffected: number;
    /** Quantas ainda estão abertas neste momento. */
    openNow: number;
  };
  waits: { line: string; machine: string; reason: string; started: string; wait: string; status: string }[];
  matrix?: ReportMatrix;
}

export async function generateWarehouseReportPDF(
  input: WarehouseReportInput,
  opts?: { output?: "save" | "bloburl" },
) {
  const { rangeLabel, filtersLabel, kpis, waits, matrix } = input;
  const chrome = await createReportChrome({ title: "Warehouse Waits", rangeLabel });
  const { doc, commonTable } = chrome;

  chrome.kpiCards([
    { label: "Total Wait (wall-clock)", value: kpis.totalWait },
    { label: "Line Time Waiting", value: kpis.lineWait },
    { label: "Waits", value: String(kpis.waits) },
    { label: "Lines Affected", value: String(kpis.linesAffected) },
    { label: "Open Now", value: String(kpis.openNow), valueColor: kpis.openNow > 0 ? AMBER_TX : INK, accent: kpis.openNow > 0 ? AMBER_TX : NAVY },
  ]);
  chrome.captionLine(
    `${filtersLabel}  ·  Warehouse waits never count as production-line downtime.` +
    (kpis.totalUnmeasured
      ? `  ·  † ${kpis.totalUnmeasured} of the total sits on orders the iTouching poll did not close — the line was flagged, not measured.`
      : ""),
  );

  if (matrix && matrix.rows.length) {
    drawPatternMatrixSection(chrome, matrix, {
      title: "Pattern Matrix — warehouse wait by day & shift",
    });
  }

  chrome.ensureSpace(40);
  chrome.sectionTitle("Warehouse Waits", waits.length);
  autoTable(doc, {
    ...commonTable,
    startY: chrome.y,
    head: [["Line", "Asset", "Reason", "Started", "Wait", "Status"]],
    body: waits.length
      ? waits.map((w) => [
          w.line, w.machine, w.reason, w.started,
          { content: w.wait, styles: { halign: "right" as const } },
          { content: w.status, styles: { ...statusChip(w.status), fontStyle: "bold" as const, halign: "center" as const } },
        ])
      : [[{ content: "No warehouse waits in the selected range.", colSpan: 6, styles: { halign: "center" as const, textColor: SUBTLE, fontStyle: "italic" as const } }]],
    columnStyles: { 4: { halign: "right" }, 5: { halign: "center" } },
  });

  return chrome.finish(`warehouse-waits_${rangeLabel.replace(/[^0-9A-Za-z]+/g, "-")}`, opts);
}
