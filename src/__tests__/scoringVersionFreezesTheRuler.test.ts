import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The promise 20260822090000 makes, held to its own text.
 *
 * "Alterar os pesos cria uma nova versao de pontuacao. Accoes ja registadas mantem a
 * pontuacao vigente na data em que foram criadas." Every assertion below is one clause
 * of that sentence, expressed as something the SQL either says or does not.
 *
 * These are structural, not executable — there is no Postgres in this test run. They
 * cannot prove the migration produces the right numbers. What they CAN do is catch the
 * four ways this design gets quietly undone by a later edit, each of which type-checks,
 * runs, and produces a plausible figure:
 *
 *   - a ruler loses its trigger, so editing it stops opening a version;
 *   - `scoring_version_open` starts UPDATEing values in place instead of closing and
 *     opening, which is overwriting history while claiming not to;
 *   - the re-grade path reaches for today's version instead of the action's own, which
 *     re-opens the exact door this migration closes;
 *   - a write policy appears on a version table, so a version becomes editable by hand.
 */

const MIGRATION = "supabase/migrations/20260822090000_a_score_is_frozen_at_the_scale_of_its_day.sql";
const sql = readFileSync(resolve(__dirname, "../..", MIGRATION), "utf8");

/**
 * The three rulers that were still re-scoring history before this migration.
 *
 * The weights are NOT in this list, and their absence is the point: 20260818090000
 * already versions them, and copying them here would create the second source of truth
 * that migration exists to prevent.
 */
const RULERS = [
  "public.quality_severity_points",
  "public.quality_options",
  "public.quality_label_attribution",
];

describe("every ruler opens a version when it changes", () => {
  for (const table of RULERS) {
    it(`${table} has a trigger onto scoring_version_on_ruler_change`, () => {
      const triggers = [...sql.matchAll(/ON\s+(public\.\w+)\s*\n?\s*FOR EACH ROW[^;]*scoring_version_on_ruler_change/g)]
        .map((m) => m[1]);
      // The attribution table may not exist on a given database, so its trigger is
      // created inside a guarded EXECUTE — matched from the statement text either way.
      const guarded = sql.includes(`ON ${table}\n               FOR EACH ROW EXECUTE FUNCTION public.scoring_version_on_ruler_change()`);
      expect(triggers.includes(table) || guarded).toBe(true);
    });
  }
});

describe("a version is closed and a new one opened — never overwritten", () => {
  const open = sql.slice(sql.indexOf("FUNCTION public.scoring_version_open"), sql.indexOf("-- 7. Backfill"));

  it("closes the version in force the day before the new one starts", () => {
    expect(open).toMatch(/UPDATE public\.scoring_version SET valid_to = _today - 1/);
  });

  it("opens the new one by INSERT, so the previous row survives intact", () => {
    expect(open).toMatch(/INSERT INTO public\.scoring_version \(valid_from, opened_by, note\)/);
  });

  it("re-uses a version that nothing has been scored under yet, rather than stacking empties", () => {
    expect(open).toMatch(/valid_to IS NULL AND valid_from >= _today/);
  });

  it("cannot leave two versions in force at once", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS scoring_version_one_in_force[\s\S]*?WHERE valid_to IS NULL/);
  });
});

describe("a re-grade is scored on the action's own ruler, not today's", () => {
  const freeze = sql.slice(sql.indexOf("FUNCTION public.quality_action_freeze_points"), sql.indexOf("DROP TRIGGER IF EXISTS trg_quality_action_freeze_points_ins"));

  it("takes the version already on the row before falling back to anything", () => {
    expect(freeze).toMatch(/_v := coalesce\(NEW\.scoring_version_id,/);
  });

  it("never resolves the update path against current_date", () => {
    // Anchored deliberately. `indexOf` returns -1 when the anchor is gone and
    // `slice(-1)` then hands back one harmless character, so this test passed while
    // the very line it guards had been deleted — a test that cannot fail when its
    // subject disappears is worse than no test at all.
    const at = freeze.indexOf("_v := coalesce(NEW.scoring_version_id");
    expect(at).toBeGreaterThan(-1);
    expect(freeze.slice(at)).not.toMatch(/current_date/);
  });

  it("stamps points_recalculated_at, so a corrected figure is visible as corrected", () => {
    expect(freeze).toMatch(/NEW\.points_recalculated_at := now\(\);/);
  });

  it("dates a new action by its own recorded_at, so a backdated row gets the right ruler", () => {
    expect(freeze).toMatch(/scoring_version_at\(coalesce\(NEW\.recorded_at, now\(\)\)::date\)/);
  });
});

describe("the backfill is not destructive", () => {
  it("starts version 1 at the oldest action, not at today", () => {
    expect(sql).toMatch(/COALESCE\(min\(recorded_at\)::date, current_date\)/);
  });

  it("writes only what is still empty, so a re-run cannot overwrite a frozen figure", () => {
    expect(sql).toMatch(/SET scoring_version_id = public\.scoring_version_at\(a\.recorded_at::date\)\s*\n\s*WHERE a\.scoring_version_id IS NULL;/);
    expect(sql).toMatch(/WHERE a\.points_at_creation IS NULL AND a\.scoring_version_id IS NOT NULL/);
  });

  it("does not touch the dead quality_actions.points column", () => {
    expect(sql).not.toMatch(/SET\s+points\s*=/);
  });

  it("reports how many rows it filled — zero rows is a wrong work order, not a silent success", () => {
    expect(sql).toMatch(/RAISE NOTICE 'points_at_creation preenchido em/);
  });
});

describe("a version cannot be edited by hand", () => {
  const VERSION_TABLES = [
    "public.scoring_version",
    "public.scoring_version_severity",
    "public.scoring_version_label",
    "public.scoring_version_excluded_label",
  ];

  for (const t of VERSION_TABLES) {
    it(`${t} has row level security on`, () => {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${t.replace(".", "\\.")}\\s+ENABLE ROW LEVEL SECURITY`));
    });

    it(`${t} has no INSERT, UPDATE or DELETE policy`, () => {
      const policies = [...sql.matchAll(new RegExp(`ON ${t.replace(".", "\\.")} FOR (\\w+)`, "g"))].map((m) => m[1]);
      // At least one, or an accidentally policy-less table would pass this as "clean".
      expect(policies.length).toBeGreaterThan(0);
      expect(policies.filter((p) => p !== "SELECT")).toEqual([]);
    });
  }
});
