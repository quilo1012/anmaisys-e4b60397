/**
 * O `employees.user_id` tem um só caminho de escrita a partir da app: as funções
 * `link_login_to_employee` / `unlink_login_from_employee`.
 *
 * O ecrã de Users escrevia-o com um UPDATE directo, sem nenhuma das regras da função —
 * um login podia ficar com duas pessoas e o `my_employee_id()` escolhia uma ao acaso.
 * Este teste falha se um UPDATE desses voltar a aparecer em qualquer ficheiro de `src/`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "..");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

describe("employees.user_id", () => {
  it("is never written by a direct UPDATE from the app", () => {
    const offenders = walk(SRC).filter((f) => /\.update\(\s*\{\s*user_id\s*:/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it("is linked through the function from the Users screen", () => {
    const body = readFileSync(join(SRC, "components/workforce/LinkEmployeeRecord.tsx"), "utf8");
    expect(body).toContain("useLoginLinkMutations");
  });
});
