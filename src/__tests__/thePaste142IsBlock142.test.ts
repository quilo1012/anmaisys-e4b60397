import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Audit 2026-11-02, SEC-002: the invite code was checked only in the browser, and a POST
 * to /auth/v1/signup with `self_signup: "true"` got the automatic role without one.
 * `20261103100000` makes handle_new_user check the code the page now sends.
 * `APLICAR-142-…` is the one-block paste and `VERIFY-142-…` the read-only check; both are
 * worth having only while they are the migration.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-142-registo-exige-o-codigo.sql"));
const verify = read(resolve(dir, "VERIFY-142-registo-com-codigo.sql"));
const migration = read(resolve(root, "supabase/migrations/20261103100000_a_self_signup_carries_its_invite_code.sql"));
const signUpPage = read(resolve(root, "src/pages/SignUp.tsx"));

const block142 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 142\n/.test(b))!;

const code = (sql: string) =>
  sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

/** What Postgres stores as prosrc: the text between the dollar quotes. */
const prosrc = () => {
  const start = migration.indexOf("as $function$") + "as $function$".length;
  return migration.slice(start, migration.indexOf("$function$;", start));
};

describe("APLICAR-142 is BLOCO 142 and nothing else", () => {
  it("BLOCO 142 is the migration", () => {
    expect(block142).toBeTruthy();
    expect(block142).toContain(migration.trimEnd());
  });

  it("carries the block byte for byte and adds only comments", () => {
    expect(paste).toContain(block142.trimEnd());
    expect(code(paste.replace(block142.trimEnd(), ""))).toBe("");
  });

  it("VERIFY-142 checks the body this migration creates", () => {
    const md5 = createHash("md5").update(prosrc()).digest("hex");
    expect(verify).toContain(md5);
  });
});

describe("a self sign-up needs a code the database accepts", () => {
  it("replaces handle_new_user and nothing else", () => {
    const fns = [...migration.matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1]);
    expect(fns).toEqual(["handle_new_user"]);
  });

  it("grants the automatic role only through check_invite_code", () => {
    expect(migration).toMatch(/code_ok boolean := public\.check_invite_code\(coalesce\(new\.raw_user_meta_data->>'invite_code', ''\)\)/);
    expect(migration).toMatch(/granted := case when is_self and code_ok then auto_role end;/);
    expect(migration).toMatch(/elsif granted is not null then\s+insert into public\.user_roles \(user_id, role\) values \(new\.id, granted\)/);
  });

  it("the sign-up page sends the code it checked", () => {
    expect(signUpPage).toMatch(/data: \{ name: name\.trim\(\), self_signup: "true", invite_code: code\.trim\(\) \}/);
  });
});
