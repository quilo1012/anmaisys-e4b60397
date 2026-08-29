import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { navItems } from "@/components/DashboardLayout";
import { defaultCan, type Role } from "@/lib/permissions";

/**
 * O engineer via os planos de preventiva e nao chegava ao ecra que os explica.
 *
 * A matriz dava-lhe `pm.view` desde sempre. Quem o barrava eram duas listas escritas
 * a mao — `allowedRoles` da rota e `roles` da entrada do menu — que ninguem voltou a
 * sincronizar com a matriz depois de a alargar. `ProtectedRoute` exige as duas coisas,
 * por isso bastava uma delas estar desactualizada para o ecra estar fechado.
 *
 * A entrada do menu e a rota tambem discordavam entre si: `production_office_admin`
 * aparecia na barra lateral e era recusado ao clicar. Um item de menu que leva a uma
 * porta fechada e pior do que nenhum item, porque so se descobre depois do clique.
 */

const APP = readFileSync(resolve(__dirname, "..", "App.tsx"), "utf8");

/** As roles do `allowedRoles` da rota com este caminho. */
function rolesDaRota(path: string): Role[] {
  const re = new RegExp(
    `<Route\\s+path="${path}"\\s+element=\\{[\\s\\S]*?<ProtectedRoute([^>]*)>`,
  );
  const m = re.exec(APP);
  expect(m, `a rota ${path} nao foi encontrada no App.tsx`).toBeTruthy();
  const ar = /allowedRoles=\{\[([^\]]*)\]\}/.exec(m![1]);
  expect(ar, `a rota ${path} nao declara allowedRoles`).toBeTruthy();
  return [...ar![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1] as Role);
}

function rolesDoMenu(url: string): Role[] {
  const item = navItems.find((i) => i.url === url);
  expect(item, `${url} nao tem entrada no menu`).toBeTruthy();
  return (item!.roles ?? []) as Role[];
}

const PM_INTELLIGENCE = "/dashboard/pm-intelligence";
const PREVENTIVE = "/dashboard/preventive";

describe("PM Intelligence", () => {
  it("deixa entrar o engineer e o co_engineer", () => {
    const rota = rolesDaRota(PM_INTELLIGENCE);
    expect(rota).toContain("engineer");
    expect(rota).toContain("co_engineer");
  });

  it("mostra-lhes a entrada no menu", () => {
    const menu = rolesDoMenu(PM_INTELLIGENCE);
    expect(menu).toContain("engineer");
    expect(menu).toContain("co_engineer");
  });

  it("nao poe no menu ninguem que a rota va recusar", () => {
    // Foi assim que o production_office_admin ficou com um item que dava erro.
    const rota = rolesDaRota(PM_INTELLIGENCE);
    for (const role of rolesDoMenu(PM_INTELLIGENCE)) {
      expect(rota, `${role} esta no menu mas a rota recusa-o`).toContain(role);
    }
  });
});

describe("o plano de preventiva", () => {
  it("e escrito por quem conhece a maquina, nao so pela gestao", () => {
    expect(defaultCan("engineer", "pm.manage")).toBe(true);
    expect(defaultCan("co_engineer", "pm.manage")).toBe(true);
  });

  it("continua fora do alcance do chao de fabrica", () => {
    expect(defaultCan("operator", "pm.manage")).toBe(false);
    expect(defaultCan("viewer", "pm.manage")).toBe(false);
  });

  it("abre as duas telas de preventiva as mesmas roles", () => {
    // Ver a analise e nao poder abrir a lista onde o plano acaba por viver — ou o
    // contrario — parte o caminho a meio.
    const analise = rolesDaRota(PM_INTELLIGENCE);
    for (const role of rolesDaRota(PREVENTIVE)) {
      expect(analise, `${role} entra em ${PREVENTIVE} e nao em ${PM_INTELLIGENCE}`)
        .toContain(role);
    }
  });
});
