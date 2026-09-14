import { describe, it, expect } from "vitest";
import { computeHeatmap } from "@/lib/downtimeHeatmap";
import { warehouseWaitMinutes } from "@/lib/warehouseWait";
import {
  isWarehouseWo,
  toWarehouseHeatmapRecords,
  type WarehouseWoRow,
} from "@/lib/warehouseHeatmap";

// Segunda 07/09 00:00 → segunda 14/09 00:00, Europe/London (BST, UTC+1).
const FROM = Date.parse("2026-09-06T23:00:00.000Z");
const TO = Date.parse("2026-09-13T23:00:00.000Z");

function wo(partial: Partial<WarehouseWoRow>): WarehouseWoRow {
  return {
    id: "wo-1",
    wo_type: "warehouse_service",
    line_at_time: "Line 4",
    created_at: "2026-09-10T10:00:00.000Z",
    closed_at: "2026-09-10T10:12:00.000Z",
    ...partial,
  };
}

describe("isWarehouseWo", () => {
  it("aceita a ordem que o poll abriu para a espera do armazém", () => {
    expect(isWarehouseWo(wo({}))).toBe(true);
  });

  it("recusa tudo o resto — uma ordem de manutenção não é uma espera", () => {
    expect(isWarehouseWo(wo({ wo_type: "maintenance" }))).toBe(false);
    expect(isWarehouseWo(wo({ wo_type: null }))).toBe(false);
  });
});

describe("toWarehouseHeatmapRecords", () => {
  it("deixa de fora as ordens que não são do armazém", () => {
    const out = toWarehouseHeatmapRecords([wo({}), wo({ id: "wo-2", wo_type: "maintenance" })]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("wo-1");
  });

  it("a linha que esperou é a `line_at_time`, não a máquina", () => {
    // O `machine` traz a variante física ("Line 5A"); a matriz é por linha.
    const [r] = toWarehouseHeatmapRecords([wo({ line_at_time: "Line 5", machine: "Line 5A" })]);
    expect(r.line).toBe("Line 5");
  });

  it("um pedido manual não tem linha nenhuma e fica na sua própria fila", () => {
    // Criado pelo diálogo "New Request": traz armazém, não traz linha parada.
    const [r] = toWarehouseHeatmapRecords([
      wo({ line_at_time: null, machine: null, warehouse_location: "Warehouse 1" }),
    ]);
    expect(r.line).toBeNull();
  });

  it("o `closed_at` ganha ao `finished_at`", () => {
    const [r] = toWarehouseHeatmapRecords([
      wo({ closed_at: "2026-09-10T10:12:00.000Z", finished_at: "2026-09-10T10:30:00.000Z" }),
    ]);
    expect(r.ended_at).toBe("2026-09-10T10:12:00.000Z");
  });

  it("aceita o `finished_at` quando o `closed_at` não veio", () => {
    const [r] = toWarehouseHeatmapRecords([
      wo({ closed_at: null, finished_at: "2026-09-10T10:09:00.000Z" }),
    ]);
    expect(r.ended_at).toBe("2026-09-10T10:09:00.000Z");
  });

  it("a ordem ainda aberta chega sem fim, para a matriz a contar até agora", () => {
    const [r] = toWarehouseHeatmapRecords([wo({ closed_at: null, finished_at: null })]);
    expect(r.ended_at).toBeNull();
  });

  it("ignora a ordem sem hora de abertura em vez de a datar de hoje", () => {
    expect(toWarehouseHeatmapRecords([wo({ created_at: null })])).toHaveLength(0);
  });

  /**
   * A razão de existir deste módulo: a célula da matriz e a coluna "Wait" da
   * tabela por baixo dela têm de contar a mesma espera. Duas regras de fim
   * diferentes para o mesmo número é a divergência que este teste tranca.
   */
  it("conta os mesmos minutos que a coluna Wait da tabela", () => {
    const row = wo({ closed_at: null, finished_at: "2026-09-10T10:37:00.000Z" });
    const [r] = toWarehouseHeatmapRecords([row]);
    const hm = computeHeatmap([r], FROM, TO, "all", "all");
    expect(hm.lineTotals.get("Line 4")?.minutes).toBe(warehouseWaitMinutes(row as never));
    expect(hm.lineTotals.get("Line 4")?.minutes).toBe(37);
  });
});

describe("a matriz do armazém", () => {
  it("parte pelas 18:00 a espera que atravessa o fim do turno", () => {
    // Quinta 10/09, 17:40 → 18:20 em Londres (BST): 20 minutos de dia, 20 de noite.
    const [r] = toWarehouseHeatmapRecords([
      wo({
        created_at: "2026-09-10T16:40:00.000Z",
        closed_at: "2026-09-10T17:20:00.000Z",
      }),
    ]);
    const hm = computeHeatmap([r], FROM, TO, "all", "all");
    const cells = hm.matrix.get("Line 4")!;
    expect(cells.get("3-Day")?.minutes).toBe(20);
    expect(cells.get("3-Night")?.minutes).toBe(20);
    // Uma espera, não duas: a contagem fica no turno em que começou.
    expect(hm.lineTotals.get("Line 4")?.count).toBe(1);
  });

  it("soma por linha as esperas do dia, cada uma na sua célula", () => {
    const recs = toWarehouseHeatmapRecords([
      wo({ id: "a", created_at: "2026-09-10T10:00:00.000Z", closed_at: "2026-09-10T10:12:00.000Z" }),
      wo({ id: "b", created_at: "2026-09-10T13:00:00.000Z", closed_at: "2026-09-10T13:08:00.000Z" }),
      wo({ id: "c", line_at_time: "Line 1", created_at: "2026-09-10T13:00:00.000Z", closed_at: "2026-09-10T13:05:00.000Z" }),
    ]);
    const hm = computeHeatmap(recs, FROM, TO, "all", "all");
    expect(hm.matrix.get("Line 4")?.get("3-Day")?.minutes).toBe(20);
    expect(hm.matrix.get("Line 4")?.get("3-Day")?.count).toBe(2);
    expect(hm.lines).toEqual(["Line 1", "Line 4"]);
    // Duas linhas à espera ao mesmo tempo contam uma vez no total de parede.
    expect(hm.grandTotalMinutes).toBe(20);
  });
});
