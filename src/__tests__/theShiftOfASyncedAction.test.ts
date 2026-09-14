import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { londonShift } from "../../supabase/functions/_shared/safetyculture/classification";

/**
 * Porque é que a Production Performance dava zero pontos de qualidade em todas as
 * linhas, todos os dias.
 *
 * Medido a 13/09/2026 sobre as 192 linhas do log:
 *
 *   source='pm'             69 linhas   shift preenchido    todas às 12:00 de Londres
 *   source='safetyculture' 123 linhas   shift NULL          instantes reais, 24 horas
 *
 * O SafetyCulture não tem campo de turno e esta sync nunca escreveu um. O ecrã abre
 * fixado no turno a correr e filtra `.eq("shift", …)` no servidor, portanto derrubava
 * as 123 — e imprimia 0 em "Quality pts" e 0 em "Open actions" em cada linha da tabela,
 * sem nada no ecrã a dizer que estava a olhar para um filtro e não para a fábrica.
 *
 * As 69 da origem 'pm' ficam de fora da derivação de propósito: o meio-dia delas é
 * sintético (o formulário pede uma data, não uma hora) e ler DAY dele seria trocar um
 * branco honesto por uma invenção.
 */
describe("the shift of a synced action", () => {
  const at = (iso: string) => londonShift(iso);

  it("reads the factory clock: 06:00 starts the day, 18:00 starts the night", () => {
    // BST em Setembro, portanto Londres = UTC+1.
    expect(at("2026-09-11T04:59:00Z")).toBe("NIGHT"); // 05:59 local
    expect(at("2026-09-11T05:00:00Z")).toBe("DAY");   // 06:00 local
    expect(at("2026-09-11T16:59:00Z")).toBe("DAY");   // 17:59 local
    expect(at("2026-09-11T17:00:00Z")).toBe("NIGHT"); // 18:00 local
  });

  it("holds across the GMT/BST switch, where the clock and UTC disagree by an hour", () => {
    // Janeiro: Londres = UTC.
    expect(at("2026-01-11T05:30:00Z")).toBe("NIGHT");
    expect(at("2026-01-11T06:30:00Z")).toBe("DAY");
  });

  it("classifies the rows that were being dropped", () => {
    expect(at("2026-09-11T01:25:39.584462+00:00")).toBe("NIGHT");
    expect(at("2026-09-11T08:41:02.567153+00:00")).toBe("DAY");
    expect(at("2026-09-13T16:16:11.736658+00:00")).toBe("DAY");   // 17:16 local
    expect(at("2026-09-13T20:40:00.000000+00:00")).toBe("NIGHT"); // 21:40 local
  });

  it("says nothing when there is no instant to read", () => {
    expect(at(null)).toBeNull();
    expect(at("")).toBeNull();
    expect(at("not a date")).toBeNull();
  });

  it("is written on every row the import writes", () => {
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/_shared/safetyculture/sync.ts"),
      "utf8",
    );
    expect(src).toContain("shift: londonShift(draft.recorded_at)");
  });
});
