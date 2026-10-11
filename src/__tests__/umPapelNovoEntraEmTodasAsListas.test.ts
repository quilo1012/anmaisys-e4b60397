import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Constants } from "@/integrations/supabase/types";
import {
  ROLES_ONLY_ADMIN_MAY_TOUCH,
  ROLES_A_MANAGER_MAY_TOUCH,
} from "../../supabase/functions/_shared/managerLimits";

/**
 * Um papel acrescentado ao enum da base tem de entrar em todas as listas que o
 * nomeiam à mão — e até 11/10/2026 nenhuma delas era verificada.
 *
 * O `app_role` vive no Postgres. Fora dele, o mesmo conjunto está escrito à mão em
 * três sítios que nada ligava:
 *
 *   supabase/functions/create-user/index.ts   z.enum([...])
 *   supabase/functions/update-user/index.ts   z.enum([...])
 *   supabase/functions/_shared/managerLimits.ts   quem um manager pode tocar
 *
 * Duas falhas reais, ambas do mesmo feitio — um papel novo no enum, as listas por
 * actualizar:
 *
 * 1. O `production_office_admin` faltava no `ROLES_ONLY_ADMIN_MAY_TOUCH`. Como o
 *    `update-user` deixa um manager pôr palavra-passe nova em qualquer conta não
 *    protegida, e o papel é quase um admin, um manager podia escolher-lhe a
 *    palavra-passe e entrar com ela. O `delete-user` lê a mesma lista.
 * 2. O `production_office_admin` faltava no `z.enum` do `update-user`, por isso o
 *    ecrã oferecia o papel e a função recusava-o.
 *
 * O enum do zod é lido do texto do ficheiro e não importado: os `index.ts` das edge
 * functions importam de `npm:` e `esm.sh`, que o vitest não resolve. O
 * `managerLimits.ts` não importa nada, por isso esse é importado a sério.
 *
 * O `types.ts` é gerado a partir da base, mas é um ficheiro deste repositório e por
 * isso é um recibo, não uma prova — quem prova que ele corresponde à base é a sonda
 * em `mergedIsNotApplied.probe.test.ts`, contra produção. A corrente é
 * base → types.ts → estas listas, e este teste guarda o segundo elo.
 */

const PAPEIS = new Set<string>(Constants.public.Enums.app_role);

/** O `z.enum([...])` do campo `role`, lido do texto da função. */
function enumDoZod(funcao: string): string[] {
  const caminho = resolve(__dirname, "../..", `supabase/functions/${funcao}/index.ts`);
  const fonte = readFileSync(caminho, "utf8");
  const m = fonte.match(/role:\s*z\.enum\(\[([^\]]+)\]/);
  if (!m) throw new Error(`não encontrei o z.enum do papel em ${funcao}`);
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

describe("o enum do papel nas edge functions", () => {
  // As duas aceitam o enum inteiro e é nas guardas que vem a restrição — por isso
  // aqui a comparação é de igualdade, e não de subconjunto.
  it.each(["create-user", "update-user"])("%s aceita exactamente os papéis que a base tem", (fn) => {
    expect([...enumDoZod(fn)].sort()).toEqual([...PAPEIS].sort());
  });
});

describe("até onde chega um manager", () => {
  it("cada papel está de um dos lados, e de um só", () => {
    const protegidos = new Set<string>(ROLES_ONLY_ADMIN_MAY_TOUCH);
    const doManager = new Set<string>(ROLES_A_MANAGER_MAY_TOUCH);

    const emNenhum = [...PAPEIS].filter((r) => !protegidos.has(r) && !doManager.has(r));
    expect(emNenhum, "papel novo no enum sem decisão sobre quem lhe pode tocar").toEqual([]);

    const nosDois = [...PAPEIS].filter((r) => protegidos.has(r) && doManager.has(r));
    expect(nosDois, "papel dos dois lados ao mesmo tempo").toEqual([]);

    // E nenhuma das listas nomeia um papel que a base não tem.
    for (const r of [...protegidos, ...doManager]) expect(PAPEIS.has(r)).toBe(true);
  });

  /**
   * O que torna o esquecimento perigoso em vez de só incompleto: a porta que um
   * papel protegido fecha é a da palavra-passe, e é por aí que se entra como outra
   * pessoa. Se esta linha deixar de ser verdade, a lista voltou a ser decorativa.
   */
  it("um manager não pode escolher a palavra-passe de quem manda mais do que ele", () => {
    const fonte = readFileSync(
      resolve(__dirname, "../..", "supabase/functions/update-user/index.ts"), "utf8");
    expect(fonte).toContain("isProtectedRole(targetRole)");
    expect(fonte.indexOf("isProtectedRole(targetRole)")).toBeLessThan(fonte.indexOf("{ password"));
    expect(ROLES_ONLY_ADMIN_MAY_TOUCH).toContain("production_office_admin");
  });
});
