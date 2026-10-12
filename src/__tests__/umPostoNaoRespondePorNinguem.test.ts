import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { can } from "@/lib/permissions";

/**
 * Um tablet é um sítio, não uma pessoa — e tinha "My Overtime" no menu.
 *
 * As contas `operator` são contas de LINHA: vivem em `operator_line_accounts`, e o
 * `tablet-signin` recebe um `account_id`, não um nome. Um turno inteiro entra na mesma
 * conta. Tudo o que fica a jusante das horas extra pergunta quem somos pelo
 * `my_employee_id()`, que lê `employees.user_id = auth.uid()` — por isso o turno
 * inteiro respondia como quem quer que estivesse ligado àquela conta: uma linha só,
 * reescrita a cada resposta.
 *
 * A base já o recusa desde a migração 20261009090000, que desliga os funcionários
 * presos a contas de linha e põe uma guarda no `link_me_to_employee`. O menu era a
 * última porta visível para um caminho que a base já não aceita, e o ecrã que se
 * chegava por ela não podia funcionar.
 *
 * Quem tem de responder a horas extra numa conta sua tem o papel `employee`, que
 * existe exactamente para isso e continua na lista.
 */
describe("horas extra numa conta de linha", () => {
  it("um operator não responde a horas extra", () => {
    expect(can("operator", "overtime.respond")).toBe(false);
  });

  it("um employee responde", () => {
    expect(can("employee", "overtime.respond")).toBe(true);
  });

  /**
   * Tirar do menu e deixar na matriz dava um ecrã escondido mas alcançável pelo URL.
   * As duas listas são escritas à mão e têm de dizer o mesmo.
   */
  it("o menu e a matriz dizem o mesmo", () => {
    const nav = readFileSync(resolve(__dirname, "../components/DashboardLayout.tsx"), "utf8");
    const linha = nav.split("\n").find((l) => l.includes('url: "/dashboard/my-overtime"'));
    expect(linha, "a entrada do menu desapareceu").toBeDefined();
    expect(linha).not.toMatch(/"operator"/);
    expect(linha).toMatch(/"employee"/);
  });
});
