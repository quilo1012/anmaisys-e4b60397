import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_ROLES, dashboardPathFor, roleDashMap } from "@/lib/permissions";

/**
 * Entrar e ser devolvido ao ecrã de entrada.
 *
 * O `Index` é a porta da frente — recebe quem acabou de entrar e reencaminha. Tinha
 * uma lista de papéis escrita à mão e um `else` final para `/login`, e três papéis não
 * estavam na lista: `employee`, `quality_supervisor` e `production_office_admin`. Quem
 * tinha um deles entrava, chegava ali e voltava ao princípio. Do lado de lá lia-se
 * como "a password não funcionou".
 *
 * É a mesma avaria da noite de 11/10/2026 pela terceira vez: um papel acrescentado ao
 * enum e uma lista à mão que ninguém comparou com ele. Ver
 * `umPapelNovoEntraEmTodasAsListas` para as outras duas.
 */
describe("para onde vai cada papel", () => {
  it("nenhum papel é devolvido ao ecrã de entrada", () => {
    const devolvidos = ALL_ROLES.filter((r) => dashboardPathFor(r) === "/login");
    expect(devolvidos, "papel sem quadro próprio: entra e volta ao princípio").toEqual([]);
  });

  it("cada destino é uma rota do dashboard", () => {
    for (const r of ALL_ROLES) expect(roleDashMap[r]).toMatch(/^\/dashboard\//);
  });

  it("sem papel ainda é o ecrã de entrada", () => {
    expect(dashboardPathFor(null)).toBe("/login");
    expect(dashboardPathFor(undefined)).toBe("/login");
  });
});

/**
 * O `roleDashMap` é `Record<Role, string>`, por isso o compilador já obriga a que um
 * papel novo tenha destino — mas só de quem o lê. Uma página com lista própria
 * contorna essa protecção em silêncio, que é exactamente o que aconteceu.
 */
describe("a porta da frente não guarda a sua própria lista", () => {
  const fonte = readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf8");

  it("usa o dashboardPathFor", () => {
    expect(fonte).toContain("dashboardPathFor");
  });

  it("não compara papéis à mão", () => {
    expect(fonte).not.toMatch(/role\s*===\s*["']/);
  });
});
