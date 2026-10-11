import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { probesFor, probePath, MISSING_CODE } from "./migrationProbes";

const root = resolve(__dirname, "../..");

describe("probesFor", () => {
  it("encontra uma função chamável", () => {
    const p = probesFor("create or replace function public.foo_bar(p_x uuid)\nreturns text\nas $$ select 'x' $$;", "m.sql");
    expect(p).toEqual([{ kind: "function", name: "foo_bar", migration: "m.sql" }]);
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
