import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * No row-level policy, as the migrations leave it, reads its own table.
 *
 * BLOCO 102's "dm_insert_reply" checked `exists (select … from public.direct_messages)`
 * inside a policy ON direct_messages. Production refused every message sent in the
 * chat with `42P17 infinite recursion detected in policy` — and the local test database
 * did not, so the migration's own test passed. Only the shape of the SQL is reliable
 * evidence, so the shape is what is checked: the last definition of each policy must
 * not select from or join the table it guards. A rule that needs the table asks a
 * SECURITY DEFINER function instead (see 20261019095000).
 */
const DIR = resolve(__dirname, "../..", "supabase/migrations");

function finalPolicies() {
  const last = new Map<string, { file: string; table: string; body: string }>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(DIR, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/create\s+policy\s+("[^"]+"|\S+)\s+on\s+(?:public\.)?(\w+)([\s\S]*?);/gi)) {
      const [, name, table, body] = m;
      last.set(`${table}.${name.replace(/"/g, "")}`, { file, table, body });
    }
  }
  return last;
}

describe("row-level policies", () => {
  const all = finalPolicies();

  it("are found at all", () => {
    expect(all.size).toBeGreaterThan(100);
  });

  it("never read the table they guard", () => {
    const offenders = [...all]
      .filter(([, p]) => new RegExp(`\\b(from|join)\\s+(public\\.)?${p.table}\\b`, "i").test(p.body))
      .map(([key, p]) => `${key} (${p.file})`);
    expect(offenders).toEqual([]);
  });
});
