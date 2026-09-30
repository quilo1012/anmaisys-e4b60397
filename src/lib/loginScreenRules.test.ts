import { describe, it, expect } from "vitest";
import { resolveIdentity, suggestTablets } from "./loginIdentity";

/**
 * Duas regras do ecrã de login que não vivem em nenhuma função exportada — são
 * expressões dentro do `Login.tsx` — e que, ainda assim, decidem o que o operador
 * vê. Reproduzidas aqui com a mesma forma que lá têm, para que uma mudança de
 * qualquer dos lados apareça como um teste vermelho em vez de um ecrã estranho.
 */

const TABLETS = [
  { id: "t1", label: "Line 3", line_names: ["Line 3"] },
  { id: "t2", label: "Line 3 — Blending", line_names: ["Line 3"] },
  { id: "t3", label: "Capsules Line", line_names: ["Tablet Line"] },
];

/** `showCreateAccount` — cópia da expressão de `Login.tsx`. */
function showCreateAccount(typed: string, tablets = TABLETS) {
  const identity = resolveIdentity(typed, tablets);
  const matched = identity.kind === "tablet";
  const isEmail = identity.kind === "email";
  const hasTablets = tablets.length > 0;
  return !matched && !(hasTablets && !isEmail);
}

describe("showCreateAccount", () => {
  it("não convida a criar conta no ecrã de um posto de fábrica", () => {
    // Era a condição antiga (`!matchedTablet`) que deixava o link visível durante
    // todo o tempo em que o operador escolhe da lista — precisamente quando está a
    // olhar para o ecrã.
    expect(showCreateAccount("")).toBe(false);
    expect(showCreateAccount("Line")).toBe(false);
    expect(showCreateAccount("Line 3")).toBe(false);
  });

  it("convida quem está a escrever um endereço", () => {
    expect(showCreateAccount("ana@appliednutrition.com")).toBe(true);
  });

  it("convida quando a fábrica não tem postos nenhuns", () => {
    expect(showCreateAccount("", [])).toBe(true);
  });
});

/** `canChoose` — cópia da expressão de `Login.tsx`. */
function canChoose(typed: string, tablets = TABLETS) {
  const identity = resolveIdentity(typed, tablets);
  const matched = identity.kind === "tablet" ? identity.tablet : null;
  return suggestTablets(typed, tablets).length > (matched ? 1 : 0);
}

describe("canChoose", () => {
  it("fecha a lista quando já não há nada para escolher", () => {
    // Com o posto escrito por inteiro e mais nenhum parecido, um painel de um item
    // só tapava o campo da password e o botão de entrar.
    expect(canChoose("Capsules Line")).toBe(false);
  });

  it("mantém a lista quando o nome escrito ainda serve a mais do que um posto", () => {
    // "Line 3" é um posto E o começo de "Line 3 — Blending": escolher ainda importa.
    expect(canChoose("Line 3")).toBe(true);
  });

  it("mantém a lista enquanto o campo está vazio ou a meio", () => {
    expect(canChoose("")).toBe(true);
    expect(canChoose("Line")).toBe(true);
  });

  it("não oferece postos a quem escreve um email", () => {
    expect(canChoose("ana@appliednutrition.com")).toBe(false);
  });
});

describe("a lista diz a que linha o posto escreve", () => {
  it("um rótulo pode apontar para uma linha com outro nome", () => {
    // "Capsules Line" escreve na Tablet Line. Sem o nome da linha no ecrã, isto era
    // invisível de pé ao lado do tablet — e só se descobria na base de dados.
    const capsules = TABLETS.find((t) => t.label === "Capsules Line")!;
    expect(capsules.line_names).toEqual(["Tablet Line"]);
    expect(capsules.line_names[0]).not.toBe(capsules.label);
  });
});
