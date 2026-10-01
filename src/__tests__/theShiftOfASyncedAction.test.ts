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

  it("is still what the import falls back on when no session answers", () => {
    // Esta asserção lia `shift: londonShift(draft.recorded_at)` no ficheiro da sync,
    // que era a linha que escrevia o turno. Deixou de existir a 01/10: o turno passa
    // agora pela sessão de produção primeiro (ver oTurnoPerguntaSeALinha.test.ts), e
    // o relógio é o recurso para uma linha onde ninguém abriu sessão.
    //
    // O que se verifica aqui é que o recurso continua ligado, e verifica-se no
    // comportamento e não no texto do ficheiro: a asserção anterior passou a vida
    // inteira a confirmar que uma string estava presente, o que teria continuado a
    // passar se a linha lá estivesse e nunca corresse.
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/_shared/safetyculture/normalize.ts"),
      "utf8",
    );
    expect(src).toContain("sessionShift ?? londonShift(at)");
  });
});
