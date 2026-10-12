import { describe, expect, it } from "vitest";
import { answeredForDifferentHours, countStale, windowAnswered } from "./staleOvertimeAnswer";
import type { OvertimeResponse } from "./overtimeRequests";

const pedido = { on_date: "2026-10-13", starts_at: "18:00:00", ends_at: "06:00:00" };

const resposta = (over: Partial<OvertimeResponse> = {}): OvertimeResponse => ({
  id: "r1", request_id: "q1", employee_id: "e1", answer: "yes", decision: null,
  answered_at: "2026-10-12T09:00:00Z", decided_at: null,
  answered_for_date: "2026-10-13", answered_for_starts_at: "18:00:00", answered_for_ends_at: "06:00:00",
  ...over,
});

describe("answeredForDifferentHours", () => {
  it("as mesmas horas não são uma diferença", () => {
    expect(answeredForDifferentHours(resposta(), pedido)).toBe(false);
  });

  it("a gralha que motivou isto: 14:00 corrigido para 06:00", () => {
    expect(answeredForDifferentHours(resposta({ answered_for_ends_at: "14:00:00" }), pedido)).toBe(true);
  });

  it("apanha a hora de início e o dia", () => {
    expect(answeredForDifferentHours(resposta({ answered_for_starts_at: "20:00:00" }), pedido)).toBe(true);
    expect(answeredForDifferentHours(resposta({ answered_for_date: "2026-10-14" }), pedido)).toBe(true);
  });

  /**
   * A direcção que estraga tudo em silêncio: a base devolve `18:00:00` e o input
   * escreve `18:00`. Comparadas como texto, TODAS as respostas apareciam como dadas a
   * outro turno, e o aviso deixava de querer dizer alguma coisa à primeira vez.
   */
  it("06:00 e 06:00:00 são a mesma hora", () => {
    expect(answeredForDifferentHours(
      resposta({ answered_for_starts_at: "18:00", answered_for_ends_at: "06:00" }), pedido)).toBe(false);
    expect(answeredForDifferentHours(resposta(), { ...pedido, starts_at: "18:00", ends_at: "06:00" })).toBe(false);
  });

  /**
   * Sem instantâneo não se sabe, e não saber não é motivo para mandar o supervisor
   * telefonar. As respostas anteriores a esta coluna existir caem todas aqui.
   */
  it("uma resposta sem instantâneo não é assinalada", () => {
    for (const vazio of [null, undefined]) {
      expect(answeredForDifferentHours(resposta({
        answered_for_date: vazio, answered_for_starts_at: vazio, answered_for_ends_at: vazio,
      }), pedido)).toBe(false);
    }
    // e meio instantâneo também não chega
    expect(answeredForDifferentHours(resposta({ answered_for_ends_at: null }), pedido)).toBe(false);
    expect(windowAnswered(resposta({ answered_for_ends_at: null }))).toBeNull();
  });
});

describe("countStale", () => {
  it("conta só os sins dados a outro turno", () => {
    const rs = [
      resposta({ id: "a", answered_for_ends_at: "14:00:00" }),            // sim, desactualizado
      resposta({ id: "b", answered_for_ends_at: "14:00:00", answer: "no" }), // não, não conta
      resposta({ id: "c" }),                                              // sim, actual
      resposta({ id: "d", answered_for_date: null }),                     // sem instantâneo
    ];
    expect(countStale(rs, pedido)).toBe(1);
  });

  it("zero quando nada mudou", () => {
    expect(countStale([resposta(), resposta({ id: "b" })], pedido)).toBe(0);
    expect(countStale([], pedido)).toBe(0);
  });
});
