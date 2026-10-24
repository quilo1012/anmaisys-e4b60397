import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 24/10/2026: Rosana's cancelled Monday overtime was still in "Where I'm working" a day
 * after #742 merged the fix. The app half was live; `20261023200000` had never been
 * pasted into production, because no file in the paste package carried it — the
 * production functions were still the old bodies, checked by md5.
 *
 * `APLICAR-129-…` is the one-block shortcut to paste, and `VERIFY-129-…` is the
 * read-only check to run after. Both are only worth having if they stay the migration:
 * the paste must be BLOCO 129 byte for byte with nothing executable added, and the
 * fingerprints the check compares production against must be the migration's own
 * function bodies — otherwise an edit to the migration would leave a check that passes
 * on the old SQL, or fails on the right one.
 */
const root = resolve(__dirname, "../..");
const dir = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");
const all = read(resolve(dir, "APPLY-ALL-IN-ORDER.sql"));
const paste = read(resolve(dir, "APLICAR-129-overtime-cancelado-sai-do-onde-trabalho.sql"));
const verify = read(resolve(dir, "VERIFY-129-overtime-cancelado.sql"));
const migration = read(
  resolve(root, "supabase/migrations/20261023200000_cancelled_overtime_leaves_where_im_working.sql"),
);

const block129 = all
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .find((b) => /^-- =+\n-- BLOCO 129\n/.test(b))!;

const code = (sql: string) =>
  sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n");

/** md5 of a function's body as Postgres stores it (`prosrc`): what lies between its `$$`. */
function bodyMd5(name: string): string {
  const start = migration.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  expect(start, `${name} is in the migration`).toBeGreaterThanOrEqual(0);
  const open = migration.indexOf("as $$", start) + "as $$".length;
  const close = migration.indexOf("$$;", open);
  return createHash("md5").update(migration.slice(open, close)).digest("hex");
}

describe("APLICAR-129 is BLOCO 129 and nothing else", () => {
  it("BLOCO 129 is the migration", () => {
    expect(block129).toBeTruthy();
    expect(block129).toContain(migration.trimEnd());
  });

  it("carries the block byte for byte and adds only comments", () => {
    expect(paste).toContain(block129.trimEnd());
    expect(code(paste.replace(block129.trimEnd(), ""))).toBe("");
  });
});

describe("VERIFY-129 checks production against this migration", () => {
  for (const fn of ["my_attendance", "overtime_board_apply", "record_overtime_outcome"]) {
    it(`expects ${fn}'s body from the migration`, () => {
      expect(verify).toMatch(new RegExp(`\\('${fn}',\\s*'${bodyMd5(fn)}'\\)`));
    });
  }

  it("only reads", () => {
    expect(code(verify)).not.toMatch(/\b(insert|update|delete|truncate|create|drop|alter|grant|revoke)\b/i);
  });

  it("always ends in its report, so nothing it set can outlive it", () => {
    const tail = code(verify).trimEnd().split("\n").slice(-4).join("\n");
    expect(tail).toMatch(/raise exception 'VERIFY 129: TUDO CERTO/);
    expect(tail).toMatch(/raise exception 'VERIFY 129: % falha\(s\)/);
  });
});
