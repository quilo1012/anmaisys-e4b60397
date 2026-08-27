import { describe, it, expect } from "vitest";
import { hasLeader } from "@/lib/sessionLeader";

describe("hasLeader", () => {
  /**
   * O bug que este ficheiro existe para não voltar.
   *
   * O líder do turno é guardado em duas colunas: `leader_id`, que aponta para a
   * `line_leaders`, e `leader_name`, que é texto. O tablet da nave só escreve o nome —
   * o operador escreve-se a si próprio e carrega em sincronizar. A 27/08/2026 eram 344
   * das 563 sessões assim: nome sim, ligação não.
   *
   * A Production Control fazia a pergunta "esta sessão tem líder?" em três sítios pela
   * ligação, e respondia-a na própria fila pelo nome. A mesma sessão dizia "Gill" na
   * coluna do líder e "NO LEADER" na placa da baía, e o âmbar do "sem líder" acendia
   * em 61% da folha — que é como um aviso deixa de ser um aviso.
   */
  it("counts a session led by somebody the roster does not link", () => {
    expect(hasLeader({ leader_id: null, leader_name: "Gill" })).toBe(true);
  });

  it("counts a session linked to the roster", () => {
    expect(hasLeader({ leader_id: "30c79769-784f-4ab9-b705-7358f1aff09e", leader_name: null })).toBe(true);
    expect(hasLeader({ leader_id: "30c79769-784f-4ab9-b705-7358f1aff09e", leader_name: "Gill" })).toBe(true);
  });

  /** As que de facto não têm ninguém — 138 delas — continuam a acender o âmbar. */
  it("leaves a session with nobody on it flagged", () => {
    expect(hasLeader({ leader_id: null, leader_name: null })).toBe(false);
  });

  /** Um nome que são espaços não é um nome. O tablet aceita o campo em branco. */
  it("does not take blank text for a leader", () => {
    expect(hasLeader({ leader_id: null, leader_name: "" })).toBe(false);
    expect(hasLeader({ leader_id: null, leader_name: "   " })).toBe(false);
    expect(hasLeader({ leader_id: "", leader_name: null })).toBe(false);
  });

  it("survives a session that carries neither field", () => {
    expect(hasLeader({})).toBe(false);
    expect(hasLeader({ leader_id: undefined, leader_name: undefined })).toBe(false);
  });
});
