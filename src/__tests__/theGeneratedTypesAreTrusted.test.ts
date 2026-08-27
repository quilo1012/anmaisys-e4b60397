import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * `.from("table" as any)` was written 45 times, and not one of those tables was missing.
 *
 * The cast came with a comment on every occurrence — "table not in generated types yet" —
 * and it was true when each was written. It stopped being true at some point nobody
 * noticed, because a cast that is no longer needed does not fail; it just quietly keeps
 * turning off the check it was added to work around.
 *
 * Checked against `types.ts` before removing them: 45 casts, 18 files, and **zero**
 * tables genuinely absent from the generated types. Removing all 45 left `tsc --noEmit`
 * clean, which is the proof that none of them were load-bearing — and dropped eslint
 * from 931 errors to 901.
 *
 * What that cast actually costs, while it sits there: `.from("products" as any)` makes
 * the whole chain after it `any`, so a column that does not exist, a filter on the wrong
 * name and a typo in an `.eq()` all compile. That is the same class of defect as the
 * audit's screens-that-return-nothing, one layer up.
 *
 * This fails if one comes back. If a table genuinely is missing from the types — a
 * migration applied to the database but not yet regenerated — the honest fix is to
 * regenerate them, and the second-best is to add the name here with the reason.
 */

const SRC = resolve(__dirname, "..");
const TYPES = resolve(SRC, "integrations/supabase/types.ts");

/**
 * Tables allowed to be cast because the generated types genuinely do not know them yet.
 * Empty, and it should stay that way. Adding a name here is a note that the types are
 * behind, not a licence.
 */
const ATRASADAS: string[] = [];

function ficheiros(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return ficheiros(p);
    return /\.tsx?$/.test(e) ? [p] : [];
  });
}

/** Every table name the generated types declare. */
function tabelasConhecidas(): Set<string> {
  const t = readFileSync(TYPES, "utf8");
  const bloco = t.slice(t.indexOf("Tables: {"), t.indexOf("\n      Functions: {"));
  return new Set([...bloco.matchAll(/^      ([a-z0-9_]+): \{$/gm)].map((m) => m[1]));
}

describe("the generated Supabase types", () => {
  const conhecidas = tabelasConhecidas();
  // Tests excluded, and this file is the reason: the pattern it looks for appears in
  // its own comment above, and the first run of this test failed on itself. A test that
  // reads source has to say which source.
  const todos = ficheiros(SRC)
    .filter((f) => f !== TYPES)
    .filter((f) => !f.includes("__tests__") && !/\.test\.tsx?$/.test(f));

  it("declares the tables this app reads", () => {
    // Guards the parser: an empty set would make every assertion below vacuous.
    expect(conhecidas.size).toBeGreaterThan(100);
    expect(conhecidas.has("work_orders")).toBe(true);
  });

  it("is never cast away for a table it already knows", () => {
    const infractores: string[] = [];
    for (const f of todos) {
      const conteudo = readFileSync(f, "utf8");
      for (const m of conteudo.matchAll(/\.from\(\s*"([a-z0-9_]+)"\s+as\s+any\s*\)/g)) {
        const tabela = m[1];
        if (conhecidas.has(tabela) && !ATRASADAS.includes(tabela)) {
          infractores.push(`${f.slice(SRC.length + 1)} casts away "${tabela}", which types.ts declares`);
        }
      }
    }
    expect(infractores).toEqual([]);
  });

  it("has an empty catch-up list, or a reason for every name on it", () => {
    // If this list ever fills up, the types are behind the database and regenerating
    // them is the actual job. The test exists so that is a decision, not a drift.
    for (const t of ATRASADAS) {
      expect(conhecidas.has(t), `"${t}" is in the catch-up list but types.ts knows it`).toBe(false);
    }
  });
});
