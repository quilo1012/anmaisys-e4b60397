/**
 * A matriz do armazém, desenhada com as nove esperas que a fábrica tinha.
 *
 * Os testes do `warehouseHeatmap` provam a aritmética; este prova que ela chega
 * ao ecrã — que a tabela tem as colunas todas, que as células escrevem o número
 * na forma curta que a coluna "Wait" já usa, e que o punhal † da manutenção não
 * aparece aqui. Um total certo numa tabela que não desenha não vale nada.
 *
 * As linhas são reais: `work_orders` com `wo_type = 'warehouse_service'`, tal
 * como estavam a 14/09/2026.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PatternMatrixCard } from "@/components/PatternMatrixCard";
import { computeHeatmap } from "@/lib/downtimeHeatmap";
import { isMostlyUnresumed } from "@/lib/downtimeAttribution";
import { formatDurationCompact } from "@/lib/formatDuration";
import { buildReportMatrix, matrixToSheetRows } from "@/lib/patternMatrixReport";
import { filterWarehouseWaits, toWarehouseHeatmapRecords } from "@/lib/warehouseHeatmap";

const fmtWait = (minutes: number) => formatDurationCompact(minutes * 60);

const WO = (
  id: string, line: string | null, created: string, closed: string | null, status = "closed",
) => ({ id, wo_type: "warehouse_service", line_at_time: line, created_at: created, closed_at: closed, finished_at: closed, status });

/** As nove ordens de armazém abertas entre 09/09 e 14/09 de 2026. */
const REAL_WAITS = [
  // A ordem de teste que ninguém fechou durante quatro dias, arrumada à mão.
  WO("1027", "Line 2", "2026-09-09T09:02:15.996Z", "2026-09-13T05:52:14.265Z", "force_closed"),
  WO("1042", "Line 6", "2026-09-10T18:22:01.763Z", "2026-09-10T18:23:00.996Z"),
  WO("1051", "Line 2", "2026-09-11T12:23:01.745Z", "2026-09-11T12:26:01.465Z"),
  WO("1052", "Line 5", "2026-09-11T15:50:02.115Z", "2026-09-11T15:52:01.008Z"),
  WO("1053", "Line 5", "2026-09-12T08:38:02.017Z", "2026-09-12T08:43:01.391Z"),
  WO("1055", "Capsules Machine 1", "2026-09-14T07:18:04.105Z", "2026-09-14T08:53:01.140Z"),
  WO("1056", "Line 1", "2026-09-14T07:47:01.723Z", "2026-09-14T07:57:01.586Z"),
  WO("1058", "Line 4", "2026-09-14T11:23:03.131Z", "2026-09-14T11:33:02.921Z"),
  WO("1059", "Line 4", "2026-09-14T11:46:01.886Z", "2026-09-14T11:59:01.358Z"),
];

// Segunda 07/09 00:00 → segunda 14/09 23:59, Europe/London.
const FROM = Date.parse("2026-09-06T23:00:00.000Z");
const TO = Date.parse("2026-09-14T22:59:59.000Z");

function build() {
  const kept = filterWarehouseWaits(REAL_WAITS, { fromMs: FROM, toMs: TO });
  return { kept, heatmap: computeHeatmap(toWarehouseHeatmapRecords(kept), FROM, TO, "all", "all") };
}

function renderMatrix() {
  const { heatmap } = build();
  const { container } = render(
    <PatternMatrixCard
      title="Pattern Matrix — warehouse wait"
      description="…"
      heatmap={heatmap}
      fromMs={FROM}
      toMs={TO}
      shiftFilter="all"
      emptyRowLabel="(no line)"
      emptyMessage="No warehouse waits in the selected range."
      showUnresumed
      unresumedLegend="† not closed by the poll"
      countNoun="waits"
      formatCell={fmtWait}
    />,
  );
  return { heatmap, container };
}

describe("a matriz do armazém desenha-se", () => {
  it("põe uma fila por linha que esperou, a Capsules incluída", () => {
    const { heatmap } = renderMatrix();
    // A mesma ordenação da manutenção: as linhas numeradas por número, o resto
    // por nome — e "Capsules" vem antes de "Line".
    expect(heatmap.lines).toEqual(["Capsules Machine 1", "Line 1", "Line 2", "Line 4", "Line 5", "Line 6"]);
    for (const line of heatmap.lines) expect(screen.getByText(line)).toBeTruthy();
  });

  it("tem as catorze colunas de dia × turno, mais a linha e o total", () => {
    renderMatrix();
    const header = screen.getAllByRole("row")[0];
    // 7 cabeçalhos de dia (colSpan 2) + "Line" + "Total".
    expect(within(header).getAllByRole("columnheader")).toHaveLength(9);
    const shiftRow = screen.getAllByRole("row")[1];
    expect(within(shiftRow).getAllByRole("columnheader")).toHaveLength(16);
  });

  it("escreve os minutos na forma curta, sem o \"0h\" à frente", () => {
    renderMatrix();
    // WO-1056: Line 1, segunda 14/09, 08:47→08:57 em Londres. Dez minutos.
    // Duas vezes: a célula de segunda-dia e o total da fila.
    expect(screen.getAllByText("10m")).toHaveLength(2);
    expect(screen.queryByText("0h 10m")).toBeNull();
  });

  /**
   * O caso que a folha desenhada mostrou e a aritmética sozinha escondia.
   *
   * A WO-1027 esteve aberta de 09/09 às 09:02 até 13/09 às 05:52 — 92h50m de
   * 94h48m da semana inteira — e foi `force_closed`, não fechada pelo poll.
   * Sem marca, a Line 2 fica vermelha cinco dias seguidos, as esperas reais
   * (de 1 minuto a 1h35m) afundam-se no fundo da escala, e o total por cima da
   * tabela diz que o armazém custou 95 horas. Os minutos ficam; a marca diz que
   * não são uma medição.
   */
  it("marca a espera que o poll não fechou", () => {
    const { container, heatmap } = renderMatrix();
    expect(container.textContent).toContain("†");
    expect(screen.getByText("† not closed by the poll")).toBeTruthy();
    expect(isMostlyUnresumed(heatmap.lineTotals.get("Line 2"))).toBe(true);
    // E as que o poll fechou não levam marca nenhuma.
    for (const line of ["Line 1", "Line 4", "Line 5", "Line 6", "Capsules Machine 1"]) {
      expect(isMostlyUnresumed(heatmap.lineTotals.get(line)), line).toBe(false);
    }
  });

  it("leva ao papel exactamente os números que o ecrã mostra", () => {
    const { heatmap } = build();
    const matrix = buildReportMatrix(heatmap, { emptyRowLabel: "(no line)", format: fmtWait })!;
    const line1 = matrix.rows.find((r) => r.line === "Line 1")!;
    // Segunda é a coluna 0; o turno de dia é a primeira das duas.
    expect(line1.cells).toHaveLength(14);
    expect(line1.cells[0]).toBe("10m");
    expect(line1.total).toBe("10m");
    // A folha de Excel repete a mesma linha, com um cabeçalho por coluna.
    const sheet = matrixToSheetRows(matrix);
    expect(sheet[sheet.length - 1].Line).toBe("Totals (wall-clock)");
    expect(Object.keys(sheet[0])).toHaveLength(16);
  });

  it("conta as nove esperas e nenhuma a mais", () => {
    const { kept, heatmap } = build();
    expect(kept).toHaveLength(9);
    let waits = 0;
    heatmap.lineTotals.forEach((c) => { waits += c.count; });
    expect(waits).toBe(9);
  });
});
