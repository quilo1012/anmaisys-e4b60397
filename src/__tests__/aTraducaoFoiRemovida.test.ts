import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * A tradução por IA foi removida a 15/11/2026.
 *
 * A `translate-message` dependia da conta da Anthropic, que ficou sem créditos, e o dono
 * decidiu não os comprar. Sem créditos, cada "Check English", cada "Translate" no chat e
 * cada Enter na pesquisa de peças no telemóvel dava um 502 no Root Diagnostics — três às
 * 15:29 do mesmo dia. Foi apagada a função e foram tirados os quatro usos:
 *
 *  - relatório do engenheiro: "Check English" e o polimento ao fechar a ordem — o
 *    relatório é gravado como foi escrito, e o ecrã pede-o em inglês;
 *  - relatório de turno: as notas são impressas como foram escritas;
 *  - Stock: a pesquisa "em português" (botão e Enter no telemóvel);
 *  - mensagens privadas: o botão "Translate" (o "Convert to text" fica).
 *
 * Este teste falha se alguém voltar a chamar a função a partir da app sem a ter trazido
 * de volta — o que daria um 404 em cada clique, e o mesmo ruído no Root Diagnostics.
 */

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("a tradução por IA foi removida", () => {
  it("a função translate-message já não existe", () => {
    expect(existsSync(join(ROOT, "supabase/functions/translate-message"))).toBe(false);
  });

  it("nenhum ecrã da app a chama", () => {
    // O nome entre aspas é uma chamada; num comentário a explicar a remoção não é.
    const callers = sourceFiles(SRC).filter((f) => /["'`]translate-message["'`]/.test(readFileSync(f, "utf8")));
    expect(callers.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it("o relatório do engenheiro pede o texto em inglês e grava-o como foi escrito", () => {
    const src = readFileSync(join(SRC, "pages/dashboard/EngineerDashboard.tsx"), "utf8");
    expect(src).toMatch(/Write the report in English/);
    expect(src).not.toMatch(/Check English/);
    expect(src).not.toMatch(/polishToEnglish/);
  });
});
