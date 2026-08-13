import { describe, it, expect } from "vitest";
import {
  buildAssetIndex, assetKind, mtbfDays, recommendInterval, verdictOf, buildPmAssetRows,
  PM_FLOOR_DAYS, PM_CEILING_DAYS,
} from "@/lib/pmIntelligence";
import type { PmSchedule } from "@/hooks/usePreventiveMaintenance";

/** O registo de activos como está na base: as duas tabelas não são duas taxonomias limpas. */
const LINES = [
  { id: "l1", name: "Line 1" },
  { id: "l4", name: "Line 4" },
  { id: "l5", name: "Line 5" },
  { id: "l6", name: "Line 6" },
  { id: "lgel", name: "GEL Line" },
  { id: "ltab", name: "Tablet Line" },
  { id: "lc1", name: "Capsules Machine 1" },
];
const MACHINES = [
  { name: "Line 1", line_id: "l1" },
  { name: "Line 4", line_id: "l4" },
  { name: "Line 5A", line_id: "l5" },
  { name: "Line 5B", line_id: "l5" },
  { name: "Line 6A", line_id: "l6" },
  { name: "Line 6B", line_id: "l6" },
  { name: "Gel Machine", line_id: "lgel" },
  { name: "Gel Packing", line_id: "lgel" },
  { name: "Capsules Packing", line_id: "ltab" },
  { name: "Capsules Machine 1", line_id: "lc1" },
  { name: "Bags Sealer 3", line_id: null },
];

const WINDOW = 90;

describe("buildAssetIndex", () => {
  const index = buildAssetIndex(LINES, MACHINES);

  /**
   * A regressão de que este ficheiro existe.
   *
   * A versão anterior perguntava só "está na tabela `lines`?". `Capsules Machine 1`
   * está — e é uma máquina — por isso a tabela recusava-lhe recomendação e escrevia
   * "n/a". `Line 6A` não está, por isso recebia uma como se fosse uma unidade
   * independente. O erro corria nos dois sentidos ao mesmo tempo.
   */
  it("treats a line whose only machine carries its own name as a serviceable unit", () => {
    expect(assetKind("Capsules Machine 1", index)).toBe("unit");
    expect(assetKind("Line 1", index)).toBe("unit");
    expect(assetKind("Line 4", index)).toBe("unit");
  });

  it("treats a line with distinct machines under it as an aggregate", () => {
    expect(assetKind("Line 5", index)).toBe("aggregate");
    expect(assetKind("Line 6", index)).toBe("aggregate");
    expect(assetKind("GEL Line", index)).toBe("aggregate");
    // Tablet Line tem "Capsules Packing" por baixo — nome diferente, logo agregado.
    expect(assetKind("Tablet Line", index)).toBe("aggregate");
  });

  it("treats a line section as the unit it is", () => {
    expect(assetKind("Line 6A", index)).toBe("unit");
    expect(assetKind("Line 5B", index)).toBe("unit");
  });

  it("flags a free-text name that is in neither register", () => {
    expect(assetKind("Bag Sealer 3 + Printer 2 @ Line 3", index)).toBe("unknown");
  });

  it("matches on trimmed, case-insensitive names", () => {
    expect(assetKind("  line 6a  ", index)).toBe("unit");
  });

  it("survives an empty or unloaded register without inventing kinds", () => {
    const empty = buildAssetIndex(undefined, undefined);
    expect(assetKind("Line 4", empty)).toBe("unknown");
  });
});

describe("mtbfDays", () => {
  /**
   * O bug de fundo, isolado.
   *
   * O estimador anterior era `vão(primeira..última) / (n-1)`, que deita fora a janela
   * de observação. Duas falhas com uma hora entre elas dentro de 90 dias davam 0,04
   * dias; o certo é 45. Com 0,7 × MTBF abaixo do piso, o clamp levantava tudo para 7
   * e a coluna inteira passou a imprimir a mesma constante.
   */
  it("measures against the observation window, not the span between failures", () => {
    expect(mtbfDays(2, WINDOW)).toBe(45);
    expect(mtbfDays(73, WINDOW)).toBeCloseTo(1.233, 3);
    expect(mtbfDays(4, WINDOW)).toBe(22.5);
  });

  it("has no answer for a single failure", () => {
    expect(mtbfDays(1, WINDOW)).toBeNull();
    expect(mtbfDays(0, WINDOW)).toBeNull();
  });

  it("has no answer for an empty window", () => {
    expect(mtbfDays(5, 0)).toBeNull();
  });
});

describe("recommendInterval", () => {
  /**
   * O que a página imprimia 11 vezes seguidas. Com o estimador certo, quatro destas
   * chaves passam a ter intervalos distintos e reais.
   */
  it("gives distinct intervals to assets with distinct failure rates", () => {
    expect(recommendInterval(4, WINDOW)).toEqual({ kind: "interval", days: 16 });
    expect(recommendInterval(5, WINDOW)).toEqual({ kind: "interval", days: 13 });
    expect(recommendInterval(2, WINDOW)).toEqual({ kind: "interval", days: 31 });
  });

  /**
   * Um activo que falha de 30 em 30 horas não precisa de um plano de 7 dias — precisa
   * de alguém que veja porquê. O clamp devolvia "7d" e não tinha como dizer isso.
   */
  it("refuses an interval for an asset that fails faster than any PM cycle", () => {
    const r = recommendInterval(73, WINDOW);
    expect(r.kind).toBe("chronic");
    if (r.kind === "chronic") expect(r.wouldBe).toBeLessThan(PM_FLOOR_DAYS);
  });

  it("puts the floor exactly where it says it is", () => {
    // 0,7 × MTBF = 7 exactamente → é intervalo, não crónico.
    expect(recommendInterval(9, 90)).toEqual({ kind: "interval", days: 7 });
    expect(recommendInterval(10, 90).kind).toBe("chronic");
  });

  it("caps a very reliable asset and says the cap was applied", () => {
    const r = recommendInterval(2, 1000);
    expect(r).toEqual({ kind: "capped", days: PM_CEILING_DAYS, uncapped: 350 });
  });

  it("has nothing to recommend from a single failure", () => {
    expect(recommendInterval(1, WINDOW)).toEqual({ kind: "sparse" });
  });
});

describe("verdictOf", () => {
  const interval = recommendInterval(4, WINDOW); // 16d

  it("asks for a plan when the evidence supports one and none exists", () => {
    expect(verdictOf("unit", interval, null)).toBe("plan");
  });

  it("leaves a plan alone when it is already within tolerance", () => {
    expect(verdictOf("unit", interval, 15)).toBe("calibrated");
    expect(verdictOf("unit", interval, 18)).toBe("calibrated");
  });

  it("asks for a change when the plan has drifted past tolerance", () => {
    expect(verdictOf("unit", interval, 60)).toBe("adjust");
    expect(verdictOf("unit", interval, 7)).toBe("adjust");
  });

  it("never recommends an interval for a line", () => {
    expect(verdictOf("aggregate", interval, 30)).toBe("aggregate");
    expect(verdictOf("aggregate", recommendInterval(73, WINDOW), null)).toBe("aggregate");
  });

  it("reports chronic before it reports a missing plan", () => {
    expect(verdictOf("unit", recommendInterval(73, WINDOW), null)).toBe("chronic");
  });
});

describe("buildPmAssetRows", () => {
  const from = new Date("2026-05-14T00:00:00.000Z");
  const to = new Date("2026-08-12T00:00:00.000Z"); // 90 dias
  const assetIndex = buildAssetIndex(LINES, MACHINES);

  const at = (dayOffset: number) =>
    new Date(from.getTime() + dayOffset * 86_400_000).toISOString();

  const wo = (machine: string | null, day: number, extra: Record<string, unknown> = {}) => ({
    machine, created_at: at(day), description: "Belt slipping", ...extra,
  });

  it("excludes preventive and warehouse orders from every failure count", () => {
    /**
     * `preventive` já era excluída. `warehouse_service` não era, e traz um nome de
     * activo no mesmo campo — um pedido de armazém contava como avaria da máquina.
     */
    const { rows, coverage } = buildPmAssetRows(
      [
        wo("Line 6A", 1),
        wo("Line 6A", 40),
        wo("Line 6A", 20, { wo_type: "preventive" }),
        wo("Line 6A", 30, { wo_type: "warehouse_service" }),
      ],
      [], { from, to, assetIndex },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].failures).toBe(2);
    expect(coverage.excluded).toBe(2);
    expect(coverage.considered).toBe(2);
  });

  it("counts unnamed orders as read-but-unusable rather than dropping them silently", () => {
    const { coverage } = buildPmAssetRows(
      [wo("Line 6A", 1), wo("Line 6A", 40), wo(null, 5), wo("", 6)],
      [], { from, to, assetIndex },
    );
    expect(coverage.considered).toBe(4);
    expect(coverage.named).toBe(2);
    expect(coverage.unnamed).toBe(2);
  });

  it("ignores orders outside the window on both ends", () => {
    const { coverage } = buildPmAssetRows(
      [wo("Line 6A", -5), wo("Line 6A", 10), wo("Line 6A", 200)],
      [], { from, to, assetIndex },
    );
    expect(coverage.considered).toBe(1);
  });

  /**
   * O intervalo vem da janela pedida, não de 90 dias fixos. Sem isto, escolher
   * "últimos 7 dias" mantinha as mesmas recomendações e o cabeçalho passava a mentir.
   */
  it("derives MTBF from the window that was actually asked for", () => {
    const narrow = new Date(to.getTime() - 30 * 86_400_000);
    const orders = [wo("Line 6A", 65), wo("Line 6A", 80)];
    const wide = buildPmAssetRows(orders, [], { from, to, assetIndex });
    const tight = buildPmAssetRows(orders, [], { from: narrow, to, assetIndex });
    expect(wide.windowDays).toBe(90);
    expect(tight.windowDays).toBe(30);
    expect(wide.rows[0].mtbfDays).toBe(45);
    expect(tight.rows[0].mtbfDays).toBe(15);
  });

  it("reads the shortest active plan and ignores inactive ones", () => {
    const schedules = [
      { id: "a", machine: "Line 6A", interval_days: 30, active: true },
      { id: "b", machine: "Line 6A", interval_days: 5, active: false },
    ] as unknown as PmSchedule[];
    const { rows } = buildPmAssetRows(
      [wo("Line 6A", 1), wo("Line 6A", 40)], schedules, { from, to, assetIndex },
    );
    expect(rows[0].currentInterval).toBe(30);
    expect(rows[0].scheduleId).toBe("a");
  });

  it("drops impossible repair times from MTTR but still counts the order as a failure", () => {
    const { rows } = buildPmAssetRows(
      [
        wo("Line 6A", 1, { started_at: at(1), finished_at: at(1 + 2 / 24) }), // 2h
        wo("Line 6A", 40, { started_at: at(40), finished_at: at(45) }),       // 5 dias
      ],
      [], { from, to, assetIndex },
    );
    expect(rows[0].failures).toBe(2);
    expect(rows[0].repairSample).toBe(1);
    expect(rows[0].mttrHours).toBeCloseTo(2, 5);
  });

  it("puts what nobody is handling above what is already calibrated", () => {
    const { rows } = buildPmAssetRows(
      [
        ...Array.from({ length: 40 }, (_, i) => wo("Line 4", i)),   // crónico
        wo("Line 6A", 1), wo("Line 6A", 40),                        // sem plano → plan
        wo("Line 5", 2), wo("Line 5", 50),                          // agregado
        wo("Bags Sealer 3", 3),                                     // uma falha → sparse
      ],
      [], { from, to, assetIndex },
    );
    expect(rows.map((r) => r.verdict)).toEqual(["chronic", "plan", "aggregate", "sparse"]);
  });
});
