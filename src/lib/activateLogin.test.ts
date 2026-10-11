import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { activateLogin, ACTIVATE_RPC } from "./activateLogin";

const ok = () => vi.fn(async () => ({ error: null }));

describe("activateLogin", () => {
  it("chama a RPC com o endereço que a conta já tem", async () => {
    const rpc = ok();
    const erro = await activateLogin(rpc, { id: "u1", email: "  Rosana@Example.COM " });
    expect(erro).toBeNull();
    expect(rpc).toHaveBeenCalledWith(ACTIVATE_RPC, {
      _user_id: "u1",
      _new_email: "rosana@example.com",
    });
  });

  /**
   * A direcção perigosa. Mandar string vazia reescrevia a conta para um endereço que
   * não é de ninguém, e aí ninguém mais entrava nela.
   */
  it("recusa-se a tocar numa conta sem endereço", async () => {
    const rpc = ok();
    for (const email of ["", "   ", null, undefined]) {
      expect(await activateLogin(rpc, { id: "u1", email })).toMatch(/no email/i);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("devolve a mensagem da base em vez de a engolir", async () => {
    const rpc = vi.fn(async () => ({ error: { message: "Only admins or managers may update operator emails" } }));
    expect(await activateLogin(rpc, { id: "u1", email: "a@b.cc" }))
      .toBe("Only admins or managers may update operator emails");
  });
});

/**
 * O que torna isto frágil, dito em voz alta.
 *
 * O botão depende de uma linha DENTRO do corpo de uma função que não foi escrita para
 * ele. Se alguém tirar essa linha, o botão passa a não fazer nada e ninguém dá por
 * isso — é o género de avaria silenciosa que só aparece quando um operador não entra.
 * Por isso a migração é lida aqui.
 */
describe("a migração em que o botão se apoia", () => {
  const fonte = (() => {
    const dir = resolve(__dirname, "../..", "supabase/migrations");
    return readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(resolve(dir, f), "utf8")).join("\n");
  })();

  it("continua a confirmar o endereço", () => {
    expect(fonte).toContain(`FUNCTION public.${ACTIVATE_RPC}`);
    expect(fonte).toMatch(/email_confirmed_at\s*=\s*COALESCE\(email_confirmed_at,\s*now\(\)\)/);
  });

  it("continua a exigir admin ou manager", () => {
    expect(fonte).toMatch(/has_role\(auth\.uid\(\),\s*'admin'\)\s*OR\s*public\.has_role\(auth\.uid\(\),\s*'manager'\)/);
  });
});
