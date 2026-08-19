import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, loadModule } from "libpg-query";

/**
 * Every migration in this repository is fed to PostgreSQL's own parser.
 *
 * Nothing here ever read SQL. Migrations are not applied by this repository — they are
 * pasted into the project's editor chat and applied by hand to production — so a syntax
 * error is not caught by a build, a test, or a deploy. It is caught by the database, in
 * production, halfway through a transaction, by whoever is doing the pasting. Every
 * migration in this module shipped with the author's word for it that the SQL was valid.
 *
 * This is that word, checked. `libpg-query` is PostgreSQL's real parser, and the version
 * is pinned to the major the project actually runs (17.6 — confirmed from the Supabase
 * project listing). The version matters and is not cosmetic: PostgreSQL 13's parser
 * rejects `NULLS NOT DISTINCT`, which is valid from 15 and which 20260815140000 uses. A
 * mismatched parser reports a defect in a migration that has been applied and working
 * for weeks, and one false alarm is enough to teach people to ignore this test.
 *
 * WHAT IT DOES NOT DO, so a green tick is not read as more than it is:
 *
 *   - It parses STATEMENTS. The body of a plpgsql function or a DO block is a string
 *     literal to the SQL parser, so what is inside it is not checked here. The plpgsql
 *     parser is only published for PostgreSQL 13, which cannot read this repository's
 *     modern syntax — taking it would trade a real gap for a false one.
 *   - Syntax is not semantics. A table that does not exist, a column misspelled, a
 *     function called with the wrong argument types — all parse.
 *
 * What it does catch is the whole class of failure that has no other net: an unbalanced
 * dollar-quote, a missing comma in a 220-line view, a mis-typed CREATE TRIGGER.
 */

const DIR = resolve(__dirname, "../..", "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

beforeAll(async () => {
  await loadModule();
});

describe("every migration is valid PostgreSQL", () => {
  it("finds migrations to check at all", () => {
    // Without this, a wrong path would make the suite below vacuously green — the
    // failure mode of every test that iterates over a directory.
    expect(FILES.length).toBeGreaterThan(50);
  });

  for (const file of FILES) {
    it(file, async () => {
      const sql = readFileSync(resolve(DIR, file), "utf8");
      const result = await parse(sql);

      /**
       * A migration may legitimately contain no statements at all.
       *
       * 20260804160000 is entirely comments: it records a data correction that was
       * applied directly to production, so the file is the audit trail rather than the
       * instruction. That is a real convention here and not an empty file left behind.
       *
       * So the count is only asserted where there is SQL to count. Dropping the
       * assertion altogether would have been easier and would have given up the thing
       * it is for — catching a migration whose statements were commented out during
       * debugging and never restored, which parses perfectly and does nothing.
       */
      const hasSql = sql
        .split("\n")
        .some((l) => l.trim() !== "" && !l.trim().startsWith("--"));

      if (hasSql) expect(result.stmts.length).toBeGreaterThan(0);
      else expect(result.stmts.length).toBe(0);
    });
  }
});
