/**
 * Todo o objecto de base de dados que a app lê tem de existir numa migração.
 *
 * Esta classe de falha já aconteceu duas vezes neste módulo, e da segunda ninguém
 * reparou durante um dia: `v_timemoto_coverage`, `fn_board_clock_status` e
 * `v_board_clock_status` foram aplicadas directamente a produção pelo MCP, o Lote 2A
 * foi entregue a lê-las, a suite ficou verde, e **nenhuma das três existia no
 * repositório**. Em produção funcionava. Numa base nova — uma branch de preview, um
 * ambiente novo, um `supabase db reset` — o `useClockCoverage` apanhava um erro de
 * relação inexistente e as três telas diziam para sempre que a cobertura não podia ser
 * lida. Que é, com ironia, o modo de falha que o 2A existe para tornar visível.
 *
 * O `theApplyPackageStopsWhereTheErrorStarts` já guarda o caminho seguinte — que uma
 * migração escrita vai também para o pacote. Não guarda este: uma migração que nunca
 * foi escrita não está em `supabase/migrations/` e portanto não é iterada por ninguém.
 * A direcção aqui é a oposta e é a que faltava: parte-se do que o **código** lê, e
 * exige-se que o SQL o crie.
 *
 * Deliberadamente lê o código em vez de ter uma lista à mão. Uma lista a actualizar à
 * mão é a terceira cópia do mesmo facto, e o que este ficheiro existe para impedir.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = resolve(root, "src");
const MIGRATIONS = resolve(root, "supabase/migrations");

/** Só o que a app pode ler e a geração de tipos não cobre: vistas e funções nossas. */
const FROM_VIEW = /\.from\(\s*["'](v_[a-z0-9_]+)["']\s*\)/g;
const RPC_FN = /\.rpc\(\s*["'](fn_[a-z0-9_]+)["']\s*\)/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Ficheiros de produção. Os testes fingem a base e não contam como quem a lê. */
const sourceFiles = walk(SRC).filter((p) => !/\.test\.tsx?$/.test(p) && !/__tests__/.test(p));

function referenced(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles) {
    const body = readFileSync(file, "utf8");
    for (const re of [FROM_VIEW, RPC_FN]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) {
        const where = found.get(m[1]) ?? [];
        where.push(file.replace(root + "/", ""));
        found.set(m[1], where);
      }
    }
  }
  return found;
}

const allMigrationSql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(MIGRATIONS, f), "utf8"))
  .join("\n");

/**
 * Procura a criação, não a menção.
 *
 * Um objecto nomeado num comentário, ou só concedido com um GRANT, continua a não
 * existir numa base nova — e um GRANT sobre o que não existe é um erro, não uma
 * criação.
 */
function isCreatedByAMigration(name: string): boolean {
  const kind = name.startsWith("fn_") ? "FUNCTION" : "VIEW";
  const re = new RegExp(
    `CREATE\\s+(OR\\s+REPLACE\\s+)?(MATERIALIZED\\s+)?${kind}\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(public\\.)?${name}\\b`,
    "i",
  );
  return re.test(allMigrationSql);
}

describe("o que a app lê existe numa migração", () => {
  const found = referenced();

  it("encontra objectos para verificar", () => {
    // Sem isto uma regex partida faz passar tudo, que é como este género de teste
    // costuma falhar em silêncio.
    expect(found.size).toBeGreaterThan(2);
  });

  it("conhece as três peças que faltaram da primeira vez", () => {
    // Fixa o caso real que motivou o ficheiro. Se alguém apagar as referências ou
    // renomear as vistas, isto cai e obriga a reler o porquê antes de o actualizar.
    expect([...found.keys()]).toContain("v_timemoto_coverage");
    expect([...found.keys()]).toContain("v_board_clock_status");
  });

  for (const [name, files] of referenced()) {
    it(`${name} é criada por uma migração`, () => {
      expect(
        isCreatedByAMigration(name),
        `${name} é lida em ${files.join(", ")} e nenhuma migração a cria. ` +
          "Existe na base porque alguém a aplicou à mão; numa base nova a app parte. " +
          "Escreve a migração com CREATE OR REPLACE — em produção é no-op.",
      ).toBe(true);
    });
  }
});
