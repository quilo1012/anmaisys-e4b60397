import { describe, it, expect } from "vitest";
import { woReference, formatWONumber } from "@/lib/woFormat";

/**
 * As duas séries, e a fronteira entre elas.
 *
 * Até 15/09/2026 as ordens de armazém tiravam senha da fila da manutenção:
 * ficaram com 1027, 1042, 1051… e deixaram catorze buracos na série que vai nas
 * folhas assinadas. A migração `20260924090000` deu-lhes série própria e
 * renumerou as catorze; isto é o lado que se lê.
 */
describe("woReference", () => {
  const criada = "2026-09-09T09:02:15.996Z";

  it("escreve uma avaria na série da manutenção", () => {
    expect(woReference({ wo_number: 1027, wo_type: "production", created_at: criada }))
      .toBe("WO-2026-001027");
  });

  it("escreve uma espera de embalagem na sua própria série", () => {
    // A WO-2026-001027 de ontem é a WH-2026-000001 de hoje; o wo_number fica na
    // coluna para quem tiver a referência velha.
    expect(woReference({
      wo_number: 1027, warehouse_number: 1, wo_type: "warehouse_service", created_at: criada,
    })).toBe("WH-2026-000001");
  });

  it("não confunde os dois números da mesma linha", () => {
    const wo = { wo_number: 1069, warehouse_number: 14, wo_type: "warehouse_service", created_at: criada };
    expect(woReference(wo)).toContain("000014");
    expect(woReference(wo)).not.toContain("001069");
  });

  it("uma ordem de manutenção nunca leva o prefixo do armazém", () => {
    // O trigger só dá número às de armazém, mas uma linha vinda de um `select`
    // antigo pode trazer o campo a nulo — e o tipo é que manda, não o campo.
    expect(woReference({ wo_number: 900, warehouse_number: 3, wo_type: "production", created_at: criada }))
      .toBe("WO-2026-000900");
  });

  it("cai na forma antiga quando quem foi buscar a ordem não pediu a coluna", () => {
    // Pior do que a resposta certa, melhor do que "WH-2026-NaN".
    expect(woReference({ wo_number: 1027, wo_type: "warehouse_service", created_at: criada }))
      .toBe("WO-2026-001027");
  });

  it("devolve um travessão em vez de inventar um número", () => {
    expect(woReference(null)).toBe("—");
    expect(woReference({ wo_number: null, created_at: criada })).toBe("—");
  });

  it("o ano é o da abertura, não o de hoje", () => {
    expect(woReference({ wo_number: 98, wo_type: "production", created_at: "2025-02-11T10:00:00Z" }))
      .toBe("WO-2025-000098");
  });

  it("deixa `formatWONumber` como estava, para quem só tem o número", () => {
    expect(formatWONumber(1027, criada)).toBe("WO-2026-001027");
  });
});
