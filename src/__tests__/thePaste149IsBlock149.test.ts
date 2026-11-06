import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACTIVE_ROLES, defaultCan } from "@/lib/permissions";

/**
 * Smart Target, Q32–Q40: the line's target is made before the shift by the edge
 * function smart-target-ahead and read on the tablet. `20261105190000` is BLOCO 149;
 * `APLICAR-149-…` is the one-block paste and `VERIFY-149-…` the read-only check.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-149-alvo-antes-do-turno.sql"));
const verify = read(resolve(dir, "VERIFY-149-alvo-antes-do-turno.sql"));
const migration = read(resolve(root, "supabase/migrations/20261105190000_smart_target_ahead.sql"));
const config = read(resolve(root, "supabase/config.toml"));

const block149 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 149\n/.test(b))!;

const code = (sql: string) =>
  sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("APLICAR-149 is BLOCO 149 and nothing else", () => {
  it("BLOCO 149 is the migration, and the last block", () => {
    expect(block149).toBeTruthy();
    expect(block149).toContain(migration.trimEnd());
    expect(all.trimEnd().endsWith(migration.trimEnd())).toBe(true);
  });

  it("carries the block byte for byte and adds only comments", () => {
    expect(paste).toContain(block149.trimEnd());
    expect(code(paste.replace(block149.trimEnd(), ""))).toBe("");
  });
});

describe("the target made before the shift", () => {
  it("the tablet's read uses the same roles as the MATRIX default", () => {
    const roles = [...code(migration).matchAll(/'smarttarget\.line_target',\s*array\[([^\]]*)\]/g)].map((m) =>
      m[1].split(",").map((r) => r.trim().replace(/'/g, "")),
    );
    expect(roles).toHaveLength(1);
    expect(roles[0].sort()).toEqual(ACTIVE_ROLES.filter((r) => defaultCan(r, "smarttarget.line_target")).sort());
  });

  it("never gives a held-back line's numbers to the tablet", () => {
    expect(code(migration)).toMatch(/case when f\.shown then f\.expected_total end/);
    expect(code(migration)).toMatch(/case when f\.shown then f\.jobs else '\[\]'::jsonb end/);
  });

  it("decides the source from who called, never from the row", () => {
    expect(code(migration)).toMatch(/case when v_server then 'ahead' else 'page' end/);
    expect(code(migration)).not.toMatch(/r->>'source'/);
  });

  it("keeps anon out of every function it creates or replaces", () => {
    for (const fn of ["save_smart_target_forecasts", "save_smart_target_queue", "smart_target_line_targets"]) {
      expect(code(migration)).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
    }
  });

  it("the cron calls a function the gateway lets through without a user token", () => {
    expect(code(migration)).toMatch(/ybtrzqzliepknpzqdajx\.supabase\.co\/functions\/v1\/smart-target-ahead/);
    expect(config).toMatch(/\[functions\.smart-target-ahead\]\nverify_jwt = false/);
  });

  it("VERIFY-149 checks the cron, the secret and anon", () => {
    expect(verify).toMatch(/cron\.job/);
    expect(verify).toMatch(/CRON_SECRET/);
    expect(verify).toMatch(/has_function_privilege\('anon', 'public\.smart_target_line_targets/);
  });
});
