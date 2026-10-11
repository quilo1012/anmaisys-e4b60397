import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyLoginFailure, NOT_ACTIVATED_MESSAGE } from "./loginFailure";

describe("classifyLoginFailure", () => {
  it("uma password recusada é uma tentativa", () => {
    for (const m of ["Invalid login credentials", "invalid_grant", "Invalid login"]) {
      const f = classifyLoginFailure(new Error(m));
      expect(f.kind).toBe("credentials");
      expect(f.countsAgainstLockout).toBe(true);
    }
  });

  it("uma conta por activar NÃO é uma tentativa", () => {
    for (const m of ["Email not confirmed", "email_not_confirmed"]) {
      const f = classifyLoginFailure(new Error(m));
      expect(f.kind).toBe("not_activated");
      expect(f.countsAgainstLockout).toBe(false);
    }
  });

  it("uma falha de rede NÃO é uma tentativa", () => {
    for (const m of ["Failed to fetch", "NetworkError", "Load failed", "timeout", "aborted"]) {
      const f = classifyLoginFailure(new Error(m));
      expect(f.kind).toBe("network");
      expect(f.countsAgainstLockout).toBe(false);
    }
  });

  it("o que não se reconhece não gasta tentativas", () => {
    const f = classifyLoginFailure(new Error("database is starting up"));
    expect(f.kind).toBe("unknown");
    expect(f.countsAgainstLockout).toBe(false);
  });

  it("aguenta o que não é um Error", () => {
    expect(classifyLoginFailure("Email not confirmed").kind).toBe("not_activated");
    expect(classifyLoginFailure(null).kind).toBe("unknown");
    expect(classifyLoginFailure(undefined).countsAgainstLockout).toBe(false);
  });
});

describe("a frase da conta por activar", () => {
  /**
   * O que a tornava pior do que inútil: a pessoa tinha acabado de escrever a password
   * certa e o ecrã mandava-a tentar outra vez, a caminho de um bloqueio de 300s.
   */
  it("diz para parar de tentar e a quem recorrer", () => {
    expect(NOT_ACTIVATED_MESSAGE).toMatch(/supervisor/i);
    expect(NOT_ACTIVATED_MESSAGE).not.toMatch(/try again/i);
  });
});

/**
 * A regra só vale se o `Login` a usar, e a regra anterior foi perdida exactamente
 * assim: a classificação existia e o contador não lhe ligava.
 *
 * Isto lê o código em vez de montar o ecrã — o `Login` traz o supabase, o router e os
 * toasts atrás, e um teste de componente para isto seria mais frágil do que a linha
 * que guarda. Não prova que o ecrã se comporta bem; prova que a chamada que estraga
 * tudo não voltou ao sítio onde estava, que é a regressão que aconteceu mesmo.
 */
describe("o Login conta pela classificação, não pelo catch", () => {
  const fonte = readFileSync(resolve(__dirname, "../pages/Login.tsx"), "utf8");

  it("usa o classificador", () => {
    expect(fonte).toContain("classifyLoginFailure(error)");
  });

  it("só chama recordLoginFailure atrás de countsAgainstLockout", () => {
    const chamadas = [...fonte.matchAll(/recordLoginFailure\(/g)];
    expect(chamadas).toHaveLength(1);
    const antes = fonte.slice(0, chamadas[0].index);
    expect(antes).toContain("failure.countsAgainstLockout");
    // e a alternativa tem de ser uma LEITURA do contador, não outra escrita
    expect(fonte).toMatch(/countsAgainstLockout\s*\?\s*recordLoginFailure\(rlId\)\s*:\s*getLoginLockout\(rlId\)/);
  });

  it("não volta a colar o erro cru ao número de tentativas", () => {
    expect(fonte).not.toMatch(/\$\{reason\}\$\{/);
    expect(fonte).not.toContain("attempt${after.remaining === 1 ? \"\" : \"s\"} remaining");
  });
});
