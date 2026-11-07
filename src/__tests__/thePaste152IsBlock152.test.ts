import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Q5: a new order reaches the engineers' phones, and the alert's roads are open. */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-152-ordem-nova-toca-o-engenheiro.sql"));
const migration = read(resolve(root, "supabase/migrations/20261107090000_new_wo_reaches_engineers_phones.sql"));
const block = all.split(/\n(?=-- =+\n-- BLOCO \d+\n)/).find((b) => /^-- =+\n-- BLOCO 152\n/.test(b))!;
const code = (sql: string) => sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

describe("BLOCO 152", () => {
  it("is the migration, and the paste carries it and adds only comments", () => {
    expect(block).toContain(migration.trimEnd());
    expect(paste).toContain(block.trimEnd());
    expect(code(paste.replace(block.trimEnd(), ""))).toBe("");
  });

  it("adds work_orders to realtime only when it is missing", () => {
    expect(code(migration)).toMatch(/if not exists \(\s*select 1 from pg_publication_tables[\s\S]*tablename = 'work_orders'[\s\S]*alter publication supabase_realtime add table public\.work_orders;/);
  });

  it("swaps only the old project's function address, keeping each function's own body", () => {
    expect(code(migration)).toMatch(/execute replace\(pg_get_functiondef\(f\.oid\),\s*'https:\/\/ybtrzqzliepknpzqdajx\.supabase\.co\/functions\/v1\/',\s*'https:\/\/apblxaaktftinstoidvp\.supabase\.co\/functions\/v1\/'\)/);
  });

  it("rings engineers for an open order, never for a warehouse one, and never refuses the order", () => {
    const c = code(migration);
    expect(c).toMatch(/when \(new\.status = 'open' and coalesce\(new\.wo_type, 'production'\) <> 'warehouse_service'\)/);
    expect(c).toMatch(/where ur\.role = 'engineer'/);
    expect(c).toMatch(/exception when others then\s+raise warning/);
    expect(c).toMatch(/revoke all on function public\.wo_new_alert_engineers\(\) from public, anon, authenticated;/);
  });

  it("writes the kind the service worker turns into a lasting, buzzing notification", () => {
    expect(code(migration)).toMatch(/'wo_new'/);
    expect(read(resolve(root, "public/sw.js"))).toMatch(/startsWith\("wo_new:"\)/);
  });
});
