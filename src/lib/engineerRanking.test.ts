import { describe, it, expect } from "vitest";
import {
  band, rankEngineers, noScoreReason, RESPONSE_TARGET_MIN, REPAIR_TARGET_MIN,
  type EngineerTotals,
} from "./engineerRanking";

const totals = (over: Partial<EngineerTotals> & { name: string }): EngineerTotals => ({
  completed: 1, totalResp: 0, respCount: 0, totalMTTR: 0, mttrCount: 0, ...over,
});

describe("band", () => {
  it("dá nota máxima ao alvo e nada a quatro vezes o alvo", () => {
    expect(band(RESPONSE_TARGET_MIN, RESPONSE_TARGET_MIN)).toBe(50);
    expect(band(REPAIR_TARGET_MIN, REPAIR_TARGET_MIN)).toBe(50);
    expect(band(4 * RESPONSE_TARGET_MIN, RESPONSE_TARGET_MIN)).toBe(0);
    expect(band(10 * RESPONSE_TARGET_MIN, RESPONSE_TARGET_MIN)).toBe(0);
  });

  it("satura a 50 abaixo do alvo — e é daqui que vinha o defeito", () => {
    // `band` está certo: mais rápido do que o alvo não vale mais do que a nota máxima.
    // O erro era entregar-lhe zero em vez de "não há medição".
    expect(band(0, RESPONSE_TARGET_MIN)).toBe(50);
    expect(band(0, REPAIR_TARGET_MIN)).toBe(50);
  });
});

describe("rankEngineers", () => {
  it("pontua quem tem as duas medições", () => {
    const [e] = rankEngineers([totals({
      name: "Medido", completed: 10,
      totalResp: 300, respCount: 10,   // 30 min → 50
      totalMTTR: 600, mttrCount: 10,   // 60 min → 50
    })]);
    expect(e.avgResponse).toBe(30);
    expect(e.avgMTTR).toBe(60);
    expect(e.score).toBe(100);
  });

  /**
   * O defeito, nomeado.
   *
   * Dez ordens fechadas e nenhum tempo registado. A média era `0`, o `band` lia zero
   * como instantâneo, e esta pessoa aparecia em primeiro com 100 — à frente de quem
   * tem tempos medidos e merecidos.
   */
  it("não dá nota a quem fechou ordens sem nenhum tempo registado", () => {
    const [e] = rankEngineers([totals({ name: "Sem tempos", completed: 10 })]);
    expect(e.avgResponse).toBeNull();
    expect(e.avgMTTR).toBeNull();
    expect(e.score).toBeNull();
  });

  it("não dá nota a meio: uma metade medida não é comparável a duas", () => {
    const [so_resposta] = rankEngineers([totals({
      name: "Só resposta", completed: 5, totalResp: 150, respCount: 5,
    })]);
    expect(so_resposta.avgResponse).toBe(30);
    expect(so_resposta.avgMTTR).toBeNull();
    expect(so_resposta.score).toBeNull();
  });

  it("quem não fechou nada continua sem nota", () => {
    const [e] = rankEngineers([totals({ name: "Parado", completed: 0 })]);
    expect(e.score).toBeNull();
  });

  it("quem é medido fica acima de quem não é, por pior que seja", () => {
    const ranked = rankEngineers([
      totals({ name: "Sem tempos", completed: 50 }),
      totals({ name: "Lento mas medido", completed: 3, totalResp: 300, respCount: 3, totalMTTR: 600, mttrCount: 3 }),
    ]);
    expect(ranked.map((e) => e.name)).toEqual(["Lento mas medido", "Sem tempos"]);
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked[1].score).toBeNull();
  });

  it("entre dois sem nota, ordena por trabalho feito", () => {
    const ranked = rankEngineers([
      totals({ name: "Pouco", completed: 2 }),
      totals({ name: "Muito", completed: 40 }),
    ]);
    expect(ranked.map((e) => e.name)).toEqual(["Muito", "Pouco"]);
  });
});

describe("noScoreReason", () => {
  it("separa não ter trabalho de não ter medição", () => {
    // As duas liam "no orders", e a segunda é uma falha de dados que alguém pode ir
    // corrigir — chamar-lhe "sem ordens" esconde-a.
    expect(noScoreReason({ completed: 0, avgResponse: null, avgMTTR: null })).toBe("no orders");
    expect(noScoreReason({ completed: 12, avgResponse: null, avgMTTR: null })).toBe("no times recorded");
    expect(noScoreReason({ completed: 12, avgResponse: 30, avgMTTR: null })).toBe("no times recorded");
  });
});
