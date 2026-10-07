import { describe, it, expect } from "vitest";
import { resolveIdentity, suggestTablets, looksLikeEmail } from "./loginIdentity";

/**
 * O ecrã de login deixou de perguntar em que ambiente estás e passou a ler quem és
 * a partir de um campo só. Estes testes fixam a regra, porque falhá-la em qualquer
 * das duas direcções tem custo real:
 *
 *   - um email lido como tablet manda a palavra-passe de uma pessoa para a edge
 *     function `tablet-signin`, que força o papel `operator`;
 *   - um tablet lido como email manda o rótulo para `signInWithPassword`, que
 *     devolve "Unable to validate email address: invalid format" ao operador.
 */

const TABLETS = [
  { id: "t1", label: "Line 3" },
  { id: "t2", label: "Line 3 — Blending" },
  { id: "t3", label: "Packing A" },
];

describe("resolveIdentity", () => {
  it("não reconhece nada num campo vazio", () => {
    expect(resolveIdentity("", TABLETS)).toEqual({ kind: "empty" });
    expect(resolveIdentity("   ", TABLETS)).toEqual({ kind: "empty" });
  });

  it("reconhece um tablet pelo nome exacto", () => {
    expect(resolveIdentity("Line 3", TABLETS)).toEqual({
      kind: "tablet",
      tablet: TABLETS[0],
    });
  });

  it("ignora caixa e espaços à volta, como um teclado de tablet os deixa", () => {
    expect(resolveIdentity("  line 3  ", TABLETS)).toEqual({
      kind: "tablet",
      tablet: TABLETS[0],
    });
  });

  it("exige o nome inteiro — um prefixo não chega para entrar", () => {
    // "Line" é prefixo de dois postos: escolher um deles seria escolher por acaso.
    expect(resolveIdentity("Line", TABLETS).kind).toBe("unknown");
  });

  it("reconhece um endereço de trabalho", () => {
    expect(resolveIdentity("Ana@AppliedNutrition.com", TABLETS)).toEqual({
      kind: "email",
      email: "ana@appliednutrition.com",
    });
  });

  it("a arroba decide primeiro, mesmo que um tablet tenha esse nome", () => {
    // Um administrador pode chamar um posto "linha3@turno". Sem esta precedência
    // esse rótulo passaria a capturar tentativas de login por email.
    const armadilha = [{ id: "x", label: "ana@appliednutrition.com" }];
    expect(resolveIdentity("ana@appliednutrition.com", armadilha)).toEqual({
      kind: "email",
      email: "ana@appliednutrition.com",
    });
  });

  it("um email por acabar não é nem tablet nem endereço", () => {
    expect(resolveIdentity("ana@", TABLETS).kind).toBe("unknown");
    expect(resolveIdentity("ana@appliednutrition", TABLETS).kind).toBe("unknown");
  });

  it("aguenta a lista ainda por carregar", () => {
    expect(resolveIdentity("Line 3", undefined).kind).toBe("unknown");
    expect(resolveIdentity("ana@appliednutrition.com", undefined).kind).toBe("email");
  });

  it("sem tablets configurados, só entra quem tem endereço", () => {
    expect(resolveIdentity("Line 3", []).kind).toBe("unknown");
  });
});

describe("suggestTablets", () => {
  it("mostra tudo enquanto o campo está vazio", () => {
    expect(suggestTablets("", TABLETS)).toHaveLength(3);
  });

  it("filtra por qualquer pedaço do nome", () => {
    expect(suggestTablets("line", TABLETS).map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(suggestTablets("blend", TABLETS).map((t) => t.id)).toEqual(["t2"]);
  });

  it("não sugere posto nenhum assim que aparece uma arroba", () => {
    // Com a lista aberta por cima, quem escreve um email deixa de ver a linha que
    // lhe diz o que o sistema reconheceu — e o resto do formulário com ela.
    expect(suggestTablets("ana@", TABLETS)).toEqual([]);
    expect(suggestTablets("ana@appliednutrition.com", TABLETS)).toEqual([]);
  });

  it("aguenta a lista ainda por carregar", () => {
    expect(suggestTablets("line", undefined)).toEqual([]);
  });
});

describe("looksLikeEmail", () => {
  it("aceita um endereço completo e recusa o resto", () => {
    expect(looksLikeEmail("ana@appliednutrition.com")).toBe(true);
    expect(looksLikeEmail("ana@appliednutrition")).toBe(false);
    expect(looksLikeEmail("Line 3")).toBe(false);
    expect(looksLikeEmail("a b@c.com")).toBe(false);
  });
});
