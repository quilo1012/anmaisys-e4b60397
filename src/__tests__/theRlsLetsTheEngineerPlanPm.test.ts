import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCan, type Role } from "@/lib/permissions";

/**
 * A RLS nao le a matriz de permissoes, por isso tem de dizer o mesmo a mao.
 *
 * O ecra de Permissoes e a matriz em `permissions.ts` decidem que botoes aparecem.
 * O Postgres decide o que e gravado, e as policies de `pm_schedules` e `pm_tasks`
 * estavam cravadas em admin/manager/maintenance_manager. Dar `pm.manage` ao engineer
 * so no frontend punha-lhe o botao "Create plan" a vista e um erro de RLS no clique
 * — pior do que nao ter botao nenhum, porque parece uma avaria e nao uma permissao.
 *
 * Este teste le as migracoes pela ordem em que sao aplicadas, resolve a ultima
 * definicao viva de cada policy (um DROP mata-a, um CREATE seguinte substitui-a) e
 * exige que as duas listas digam o mesmo.
 *
 * `production_office_admin` nao aparece nas policies "manageable by mgmt": tem policy
 * propria, `office_admin all`, criada em bloco para dezenas de tabelas de uma vez. Por
 * isso e verificado a parte, e nao pela igualdade com a matriz.
 */

const DIR = resolve(__dirname, "../..", "supabase/migrations");
const SQL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .join("\n");

/**
 * As policies de escrita (`FOR ALL`) vivas nesta tabela, depois de aplicar por ordem
 * cada DROP e cada CREATE que as migracoes fazem — o ultimo a falar e que manda.
 */
function policyDeEscrita(tabela: string): string {
  const evento = new RegExp(
    `DROP POLICY IF EXISTS "([^"]+)" ON public\\.${tabela}\\b` +
    `|CREATE POLICY "([^"]+)"\\s+ON public\\.${tabela}\\s+FOR ALL[\\s\\S]*?;`,
    "g",
  );
  const vivas = new Map<string, string>();
  for (const m of SQL.matchAll(evento)) {
    if (m[1]) vivas.delete(m[1]);
    else vivas.set(m[2], m[0]);
  }
  // `office_admin all` e criada em bloco para dezenas de tabelas e tem regra propria.
  const mgmt = [...vivas.entries()].filter(([n]) => !n.startsWith("office_admin"));
  expect(mgmt.length, `${tabela} nao tem policy de escrita viva`).toBeGreaterThan(0);
  return mgmt.map(([, sql]) => sql).join("\n");
}

/** As roles nomeadas em `has_role(auth.uid(),'X'::app_role)` dentro da policy. */
function rolesNomeadas(sql: string): Role[] {
  return [...new Set([...sql.matchAll(/has_role\(auth\.uid\(\),\s*'(\w+)'::app_role\)/g)]
    .map((m) => m[1] as Role))];
}

const TABELAS = ["pm_schedules", "pm_tasks"];

describe("a RLS da preventiva", () => {
  for (const t of TABELAS) {
    it(`deixa o engineer escrever em ${t}`, () => {
      const roles = rolesNomeadas(policyDeEscrita(t));
      expect(roles).toContain("engineer");
      expect(roles).toContain("co_engineer");
    });

    it(`nao alarga ${t} a quem a matriz nao da pm.manage`, () => {
      for (const role of rolesNomeadas(policyDeEscrita(t))) {
        expect(defaultCan(role, "pm.manage"), `a RLS de ${t} nomeia ${role}`).toBe(true);
      }
    });

    it(`mantem o chao de fabrica fora de ${t}`, () => {
      const roles = rolesNomeadas(policyDeEscrita(t));
      expect(roles).not.toContain("operator");
      expect(roles).not.toContain("viewer");
    });
  }
});
