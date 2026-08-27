import { describe, it, expect } from "vitest";
import { hasLeader, resolveLeader } from "@/lib/sessionLeader";

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

describe("resolveLeader", () => {
  const roster = [
    { id: "30c79769", name: "Gill" },
    { id: "7e7f1558", name: "thiago souza" },
    { id: "60d30863", name: "ROBERT" },
  ];

  /**
   * A origem do bug, atacada onde nasce.
   *
   * O tablet da nave grava o nome que o operador escreve e mais nada. Enquanto for
   * assim, cada turno cria outra sessão sem ligação à `line_leaders` — e o `hasLeader`
   * aqui ao lado conserta a leitura de hoje mas não impede a de amanhã.
   */
  it("links a typed name to the roster", () => {
    expect(resolveLeader("Gill", roster)).toEqual({ id: "30c79769", name: "Gill" });
  });

  /** Quem escreve à pressa num tablet não acerta nas maiúsculas nem nos espaços. */
  it("forgives the case and the spacing of a name typed in a hurry", () => {
    expect(resolveLeader("  gill ", roster)).toEqual({ id: "30c79769", name: "Gill" });
    expect(resolveLeader("ROBERT", roster)).toEqual({ id: "60d30863", name: "ROBERT" });
    expect(resolveLeader("thiago  souza", roster)).toEqual({ id: "7e7f1558", name: "thiago souza" });
  });

  /** A grafia que fica é a da tabela, não a do teclado: um nome, uma escrita. */
  it("writes the name back the way the roster spells it", () => {
    expect(resolveLeader("robert", roster).name).toBe("ROBERT");
  });

  /**
   * Quem não está na tabela continua a ficar escrito.
   *
   * Deitar fora o nome por não haver ligação seria trocar um problema por outro pior:
   * a sessão passava de "tem líder mas sem ligação" para "não teve ninguém", e o turno
   * perdia a única coisa que se sabia dele.
   */
  it("keeps a name it cannot link rather than dropping it", () => {
    expect(resolveLeader("Fulano", roster)).toEqual({ id: null, name: "Fulano" });
    expect(resolveLeader("  Fulano  ", roster)).toEqual({ id: null, name: "Fulano" });
  });

  it("treats a blank field as nobody", () => {
    expect(resolveLeader("", roster)).toEqual({ id: null, name: null });
    expect(resolveLeader("   ", roster)).toEqual({ id: null, name: null });
  });

  /** Dois homónimos na tabela: escolher um deles à sorte é pior do que não escolher. */
  it("refuses to guess between two people with the same name", () => {
    const twins = [{ id: "a", name: "Gill" }, { id: "b", name: "gill" }];
    expect(resolveLeader("Gill", twins)).toEqual({ id: null, name: "Gill" });
  });
});
