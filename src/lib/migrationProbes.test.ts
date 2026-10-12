import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { probesFor, probePath, paramNames, probeBody, MISSING_CODE, markReplacements } from "./migrationProbes";

const root = resolve(__dirname, "../..");

describe("probesFor", () => {
  it("encontra uma função chamável", () => {
    const p = probesFor("create or replace function public.foo_bar(p_x uuid)\nreturns text\nas $$ select 'x' $$;", "m.sql");
    expect(p).toEqual([{ kind: "function", name: "foo_bar", args: ["p_x"], migration: "m.sql" }]);
  });

  it("ignora funções de trigger, que não são chamáveis", () => {
    // Sondá-las não prova nada: o PostgREST nunca as expõe.
    const p = probesFor("create or replace function public.on_thing()\nreturns trigger\nas $$ begin return new; end $$;", "m.sql");
    expect(p).toEqual([]);
  });

  it("encontra coluna, tabela e valor de enum", () => {
    const sql = `
      alter table public.daily_allocations add column if not exists overtime_request_id uuid null;
      create table if not exists public.identity_link_attempts (user_id uuid primary key);
      alter type public.app_role add value if not exists 'employee';
    `;
    const p = probesFor(sql, "m.sql");
    expect(p).toContainEqual({ kind: "column", name: "daily_allocations", detail: "overtime_request_id", table: "daily_allocations", migration: "m.sql" });
    expect(p).toContainEqual({ kind: "table", name: "identity_link_attempts", migration: "m.sql" });
    expect(p).toContainEqual({ kind: "enum", name: "app_role", detail: "employee", migration: "m.sql" });
  });

  it("não confunde uma frase sobre uma função com uma função", () => {
    // Os comentários deste projecto falam muito de funções. Um deles a virar sonda
    // faria a verificação acusar coisas que ninguém prometeu criar.
    const sql = `-- create or replace function public.nunca_existiu() faz isto e aquilo
      /* create table public.tambem_nao (x int); */
      select 1;`;
    expect(probesFor(sql, "m.sql")).toEqual([]);
  });

  it("não repete a mesma promessa duas vezes", () => {
    const sql = "create or replace function public.f() returns int as $$ select 1 $$;\n"
              + "create or replace function public.f() returns int as $$ select 2 $$;";
    expect(probesFor(sql, "m.sql")).toHaveLength(1);
  });
});

/**
 * A pergunta tem de ter a forma da função.
 *
 * O PostgREST escolhe a sobrecarga pelos NOMES dos argumentos. Um POST com `{}` pede a
 * sobrecarga sem argumentos e recebe `PGRST202` quando a função tem parâmetros — que é
 * exactamente o que esta sonda lê como "não existe". A 11/10/2026 isso pôs o
 * `link_me_to_employee` numa lista de promessas por cumprir quando estava na base
 * desde sempre.
 */
describe("paramNames", () => {
  it("lê as assinaturas que enganaram a sonda", () => {
    expect(paramNames("p_employee_id uuid")).toEqual(["p_employee_id"]);
    expect(paramNames("p_on_date date, p_starts_at time")).toEqual(["p_on_date", "p_starts_at"]);
    expect(paramNames("")).toEqual([]);
  });

  it("aguenta multi-linha, DEFAULT e modos", () => {
    expect(paramNames("\n  p_a uuid,\n  p_b int default 3\n")).toEqual(["p_a", "p_b"]);
    expect(paramNames("in p_a uuid, variadic p_b text[]")).toEqual(["p_a", "p_b"]);
  });

  it("o corpo da sonda nomeia os argumentos e deixa os valores a null", () => {
    const [probe] = probesFor("create function public.f(p_a uuid, p_b date) returns int as $$ select 1 $$;", "m.sql");
    expect(probeBody(probe)).toEqual({ p_a: null, p_b: null });
    expect(probeBody({ kind: "function", name: "g", migration: "m.sql" })).toEqual({});
  });
});

describe("probePath", () => {
  const onde = { app_role: { table: "user_roles", column: "role" } };

  it("constrói o caminho de cada forma", () => {
    expect(probePath({ kind: "function", name: "f", migration: "m" }, onde)).toBe("rpc/f");
    expect(probePath({ kind: "column", name: "t", detail: "c", table: "t", migration: "m" }, onde)).toBe("t?select=c&limit=1");
    expect(probePath({ kind: "table", name: "t", migration: "m" }, onde)).toBe("t?select=*&limit=1");
    expect(probePath({ kind: "enum", name: "app_role", detail: "employee", migration: "m" }, onde))
      .toBe("user_roles?role=eq.employee&limit=1");
  });

  it("recusa inventar um caminho para um enum sem tabela declarada", () => {
    expect(probePath({ kind: "enum", name: "desconhecido", detail: "v", migration: "m" }, onde)).toBeNull();
  });
});

describe("os códigos de ausência", () => {
  it("são os que o backend devolveu de facto", () => {
    // Observados contra esta produção, cada um com um controlo inventado que respondeu
    // igual: 11/10/2026.
    expect(MISSING_CODE.function).toBe("PGRST202");
    expect(MISSING_CODE.column).toBe("42703");
    expect(MISSING_CODE.enum).toBe("22P02");
    expect(MISSING_CODE.table).toBe("PGRST205");
  });
});

describe("contra as migrações reais do repositório", () => {
  it("extrai promessas das migrações por aplicar", () => {
    const dir = resolve(root, "supabase/migrations");
    const pendentes = readdirSync(dir).filter((f) => f.endsWith(".sql") && f.split("_")[0] > "20261007090000");
    expect(pendentes.length).toBeGreaterThan(0);

    const todas = pendentes.flatMap((f) => probesFor(readFileSync(resolve(dir, f), "utf8"), f));
    // As três que esta sessão verificou à mão têm de estar lá.
    expect(todas).toContainEqual(expect.objectContaining({ kind: "column", detail: "overtime_request_id" }));
    expect(todas).toContainEqual(expect.objectContaining({ kind: "function", name: "link_me_by_employee_ref" }));
    expect(todas).toContainEqual(expect.objectContaining({ kind: "enum", detail: "employee" }));
  });
});

/**
 * O que a sonda não pode saber, e tem de dizer que não sabe.
 *
 * Um `create or replace` sobre uma função que já existia promete um CORPO novo, não
 * uma função nova. A assinatura não muda, por isso o PostgREST responde igual com o
 * corpo novo ou com o antigo.
 *
 * A 11/10/2026 isto custou caro: `admin_update_auth_email` deu `401 42501`, foi lido
 * como "existe e já faz o que falta", e um botão foi construído em cima dela. O corpo
 * estava partido desde Julho e nunca tinha corrido, porque a função nunca tivera um
 * chamador.
 */
describe("markReplacements", () => {
  const criar = (n: string) => `create or replace function public.${n}(p_x uuid) returns int as $$ select 1 $$;`;

  it("marca a segunda definição e não a primeira", () => {
    const historico = [
      { file: "0001_a.sql", sql: criar("foo") },
      { file: "0002_b.sql", sql: criar("foo") },
    ];
    const marcados = markReplacements(
      [...probesFor(criar("foo"), "0001_a.sql"), ...probesFor(criar("foo"), "0002_b.sql")],
      historico,
    );
    expect(marcados[0].replacesExisting).toBeUndefined();
    expect(marcados[1].replacesExisting).toBe(true);
  });

  /**
   * A razão de receber o histórico TODO e não só as migrações pendentes: a primeira
   * definição pode ser de meses antes da janela que a sonda cobre, e foi exactamente
   * esse o caso.
   */
  it("vê a primeira definição mesmo fora da janela sondada", () => {
    const historico = [
      { file: "0001_julho.sql", sql: criar("admin_update_auth_email") },
      { file: "9999_outubro.sql", sql: criar("admin_update_auth_email") },
    ];
    const [p] = markReplacements(probesFor(criar("admin_update_auth_email"), "9999_outubro.sql"), historico);
    expect(p.replacesExisting).toBe(true);
  });

  it("não marca colunas, tabelas nem enums", () => {
    const sql = "alter table public.t add column if not exists c text;";
    const [p] = markReplacements(probesFor(sql, "0001_a.sql"), [{ file: "0001_a.sql", sql }]);
    expect(p.replacesExisting).toBeUndefined();
  });

  it("uma função mesmo nova não é marcada", () => {
    const historico = [{ file: "0001_a.sql", sql: criar("nova") }];
    const [p] = markReplacements(probesFor(criar("nova"), "0001_a.sql"), historico);
    expect(p.replacesExisting).toBeUndefined();
  });
});
