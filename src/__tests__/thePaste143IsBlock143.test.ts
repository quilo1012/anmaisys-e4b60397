import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Audit 2026-11-02, DB-001: production showed v_leader_weekly_scorecard with
 * security_invoker off and SELECT granted to anon, so the public key read the leaders'
 * weekly scores as the view's owner, past every RLS policy underneath. The cause is
 * 20261001203000: `CREATE OR REPLACE VIEW … AS` with no WITH clause resets the view's
 * options, and security_invoker went with them. `20261104090000` puts it back and takes
 * anon off the view. `APLICAR-143-…` is the one-block paste and `VERIFY-143-…` the
 * read-only check.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const migrations = resolve(root, "supabase/migrations");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-143-vista-do-scorecard-le-como-quem-pergunta.sql"));
const verify = read(resolve(dir, "VERIFY-143-vista-do-scorecard.sql"));
const migration = read(resolve(migrations, "20261104090000_the_weekly_scorecard_view_reads_as_its_reader.sql"));

const block143 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 143\n/.test(b))!;

const code = (sql: string) =>
  sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("APLICAR-143 is BLOCO 143 and nothing else", () => {
  it("BLOCO 143 is the migration", () => {
    expect(block143).toBeTruthy();
    expect(block143).toContain(migration.trimEnd());
  });

  it("carries the block byte for byte and adds only comments", () => {
    expect(paste).toContain(block143.trimEnd());
    expect(code(paste.replace(block143.trimEnd(), ""))).toBe("");
  });

  it("VERIFY-143 reads the option and the grant the migration sets", () => {
    expect(verify).toMatch(/security_invoker/);
    expect(verify).toMatch(/has_table_privilege\('anon', 'public\.v_leader_weekly_scorecard'::regclass, 'SELECT'\)/);
  });
});

describe("the weekly scorecard view answers as the person asking", () => {
  it("sets security_invoker without rewriting the definition", () => {
    expect(code(migration)).toMatch(/alter view public\.v_leader_weekly_scorecard set \(security_invoker = true\);/i);
    expect(code(migration)).not.toMatch(/create or replace view/i);
  });

  it("takes anon off the view", () => {
    expect(code(migration)).toMatch(/revoke all on public\.v_leader_weekly_scorecard from anon;/i);
  });

  it("a view replaced from now on says how it runs, or it runs as its owner", () => {
    // CREATE OR REPLACE VIEW without WITH (security_invoker …) drops the option it had.
    const late = readdirSync(migrations).filter((f) => f.endsWith(".sql") && f >= "20261104090000");
    for (const f of late) {
      const sql = code(read(resolve(migrations, f)));
      for (const m of sql.matchAll(/create or replace view\b[^;']*?\bas\b/gi)) {
        expect(m[0], `${f}: ${m[0]}`).toMatch(/security_invoker/i);
      }
    }
  });
});
