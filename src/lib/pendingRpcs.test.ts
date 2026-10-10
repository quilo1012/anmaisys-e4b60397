import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isPendingRpc, PENDING_RPCS } from "./pendingRpcs";

const root = resolve(__dirname, "../..");

/**
 * A lista só vale enquanto for verdade duas vezes: alguma coisa tem alternativa, e a
 * alternativa está nomeada. Estes testes guardam a segunda metade — a primeira é
 * revisão humana, e é por isso que o campo `fallback` existe em texto.
 */
describe("isPendingRpc", () => {
  it("reconhece as funções declaradas pela mensagem do PostgREST", () => {
    expect(isPendingRpc(
      "Could not find the function public.signup_invite_for_tablet without parameters in the schema cache",
    )).toBe(true);
    expect(isPendingRpc(
      "Could not find the function public.link_me_by_employee_ref(p_ref) in the schema cache",
    )).toBe(true);
  });

  /**
   * A direcção que apanha coisas.
   *
   * Uma função que falta e à qual nada recorre é exactamente a deriva que este registo
   * existe para apanhar. Silenciar por código — qualquer PGRST202 — matava as duas.
   */
  it("não reconhece uma função que ninguém declarou", () => {
    expect(isPendingRpc(
      "Could not find the function public.alguma_coisa_que_ninguem_declarou in the schema cache",
    )).toBe(false);
    expect(isPendingRpc("Could not find the function public.answer_overtime in the schema cache")).toBe(false);
  });

  it("aguenta mensagem ausente", () => {
    for (const nada of [null, undefined, ""]) expect(isPendingRpc(nada)).toBe(false);
  });
});

describe("a lista mantém-se honesta", () => {
  it("cada entrada nomeia o bloco e o que o ecrã mostra em vez disso", () => {
    expect(PENDING_RPCS.length).toBeGreaterThan(0);
    for (const p of PENDING_RPCS) {
      expect(p.name).toMatch(/^[a-z0-9_]+$/);
      expect(p.block).toMatch(/BLOCO \d+/);
      expect(p.fallback.length).toBeGreaterThan(40);
    }
  });

  /**
   * O que torna isto uma lista do que está pendente e não do que já esteve.
   *
   * Cada função declarada tem de existir numa migração do repositório — senão a
   * entrada é sobre uma função que nunca foi escrita. E o teste que prende o pacote de
   * colagem garante o resto: a migração tem de estar lá para o bloco poder ser colado.
   */
  it("cada função declarada existe mesmo numa migração por aplicar", () => {
    const dir = resolve(root, "supabase/migrations");
    const todas = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(resolve(dir, f), "utf8"))
      .join("\n");
    for (const p of PENDING_RPCS) {
      expect(todas).toContain(`function public.${p.name}`);
    }
  });
});
