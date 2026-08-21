import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, loadModule } from "libpg-query";

/**
 * The package that exists so a person can paste the SQL stopped before the SQL that
 * matters.
 *
 * `docs/apply/` is the whole mechanism by which a migration reaches this database:
 * nothing in this repository applies one, Lovable does, by hand, from a file somebody
 * copies. Its last block is `20260820090000`. Ten migrations have landed since, and the
 * second of them creates `public.scoring_version`.
 *
 * Measured against the live backend on 2026-08-19 with `docs/apply/probe-schema.sh`,
 * which is read-only and uses the publishable key already in `.env`:
 *
 *   scoring_version                       404 PGRST205
 *   scoring_version_severity              404 PGRST205
 *   scoring_version_label                 404 PGRST205
 *   scoring_version_excluded_label        404 PGRST205
 *   scoring_version_excluded_department   404 PGRST205
 *   quality_actions.points_at_creation    400 42703
 *   quality_actions.scoring_version_id    400 42703
 *   quality_options.is_gate               400 42703
 *   quality_actions                       200        (control)
 *   zzz_tabela_que_nao_existe             404        (control)
 *
 * So "Could not find the table 'public.scoring_version' in the schema cache" is not a
 * stale PostgREST cache and not a typo. The table is not there, and the file that would
 * have put it there was never written.
 *
 * This test is the thing that keeps the second half of that sentence from happening
 * again: the package is pinned to `supabase/migrations/`, so a migration added after the
 * package's last block fails here until it is added to the package too.
 */

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const PACKAGE = resolve(root, "docs/apply-passo-3");
const read = (p: string) => readFileSync(p, "utf8");

/**
 * The first migration this package owns.
 *
 * `docs/apply/` covers everything up to and including 20260820090000. Anything stamped
 * after it is this package's to carry, which makes "what belongs here" a fact about the
 * directory rather than a list somebody maintains by hand — the list is exactly what
 * went stale last time.
 */
const AFTER = "20260820090000";

const owned = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && f.split("_")[0] > AFTER)
  .sort();

const consolidated = () => read(resolve(PACKAGE, "APPLY-ALL-IN-ORDER.sql"));

beforeAll(async () => {
  await loadModule();
});

describe("the apply package carries every migration newer than docs/apply/", () => {
  it("finds migrations to carry at all", () => {
    // Without this a wrong path makes every assertion below vacuously true, which is
    // the failure mode of every test that iterates a directory.
    expect(owned.length).toBeGreaterThan(5);
  });

  it("names 20260822090000, the one the error is about", () => {
    expect(owned).toContain("20260822090000_a_score_is_frozen_at_the_scale_of_its_day.sql");
  });

  for (const file of owned) {
    it(`carries ${file}`, () => {
      const body = read(resolve(MIGRATIONS, file));
      // Byte for byte, not "mentions the filename". A package that paraphrases its
      // migrations is a second source of truth for the schema, which is the thing this
      // whole module keeps failing on.
      expect(consolidated()).toContain(body.trimEnd());
    });
  }
});

describe("the consolidated file is safe to hand to a person", () => {
  it("is valid PostgreSQL", async () => {
    // Concatenation can break dollar-quoting in ways no individual file shows, and the
    // person pasting this finds out halfway through a transaction, in production.
    await expect(parse(consolidated())).resolves.toBeDefined();
  });

  it("keeps the migrations in chronological order", () => {
    const sql = consolidated();
    const positions = owned.map((f) => sql.indexOf(read(resolve(MIGRATIONS, f)).trimEnd()));
    expect(positions.every((p) => p >= 0)).toBe(true);
    // 20260822090000 creates the tables 20260822093000 patches a function to read, and
    // 20260827093000 adds a column to a table 20260822090000 creates. Out of order, the
    // paste fails partway and leaves the schema in a state nobody has a name for.
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  /**
   * The other direction, which was open until 19/08/2026.
   *
   * Everything above walks `supabase/migrations/` and asks whether the package carries
   * it — so a migration nobody packaged fails. Nothing asked the reverse, and on main
   * the package shipped BLOCO 18 naming
   * `20260828090000_maintenance_keeps_its_own_list_and_a_hazard_can_cost.sql` while
   * that file was not committed at all. CI stayed green the whole time: `owned` is
   * built from the files that exist, so a file that does not exist is simply never
   * checked, and its absence is invisible to every assertion in this file.
   *
   * A block whose migration is missing is the worse of the two failures. The packaged
   * SQL is what a person pastes into production, and if the repository has no copy,
   * nothing can ever verify what they pasted.
   */
  it("carries no block whose migration is missing from the repository", () => {
    const named = [...consolidated().matchAll(/^-- (20260\d{9}_[a-z0-9_]+\.sql)$/gm)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(5);
    const present = new Set(readdirSync(MIGRATIONS));
    expect(named.filter((f) => !present.has(f))).toEqual([]);
  });

  it("says which objects to probe for afterwards", () => {
    // "It ran without an error" is not the same as "it landed", and the last package
    // learned that the expensive way. The reader is told what to check.
    const readme = read(resolve(PACKAGE, "00-LEIA-PRIMEIRO.md"));
    expect(readme).toMatch(/probe-schema\.sh/);
    expect(readme).toMatch(/scoring_version/);
  });
});
