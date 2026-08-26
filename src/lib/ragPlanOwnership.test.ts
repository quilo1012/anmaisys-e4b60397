import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { planAfterPlannerSync } from "./ragPlanOwnership";

/**
 * Written against the old rule first — `v.plan || existing?.plan_qty || 0` — where the
 * Planner's total won whenever it was non-zero. Measured before the fix: three of the
 * six cases below fail on it — the two that matter (an agreed plan overwritten by a
 * disagreeing Planner, and rounding drift written back as the plan) and the negative.
 * The other three pass by accident, because falsy zero happened to fall through to the
 * value the rule below reaches on purpose.
 */
describe("planAfterPlannerSync — the board owns the plan, the Planner seeds it", () => {
  it("keeps the agreed plan when the Planner disagrees", () => {
    // The reported symptom: 8.250 agreed on the board, 2.500 left on the session's
    // SKUs, and pressing Sync moved the board to 2.500.
    expect(planAfterPlannerSync(2500, 8250)).toBe(8250);
  });

  it("keeps the agreed plan when the Planner has nothing at all", () => {
    // A session with no items, or no session for that line/shift, summed to zero and
    // the old rule fell through to the existing value by accident. Now it is the rule.
    expect(planAfterPlannerSync(0, 8250)).toBe(8250);
  });

  it("seeds a cell nobody has planned yet", () => {
    expect(planAfterPlannerSync(4311, 0)).toBe(4311);
    expect(planAfterPlannerSync(4311, null)).toBe(4311);
    expect(planAfterPlannerSync(4311, undefined)).toBe(4311);
  });

  it("does not let rounding drift walk the plan", () => {
    // trg_sync_items_target_from_rag rounds each item, so the items sum back to
    // 12.229 for a plan of 12.231 across seven SKUs. Under the old rule every press
    // of Sync wrote the drifted total back. Measured: 10.000/3 SKUs → 9.999,
    // 12.231/12 SKUs → 12.228.
    expect(planAfterPlannerSync(12229, 12231)).toBe(12231);
    expect(planAfterPlannerSync(9999, 10000)).toBe(10000);
  });

  it("is zero when neither side has a plan", () => {
    expect(planAfterPlannerSync(0, 0)).toBe(0);
    expect(planAfterPlannerSync(null, null)).toBe(0);
  });

  it("treats junk and negatives as no plan rather than writing them to the board", () => {
    expect(planAfterPlannerSync(NaN, 5000)).toBe(5000);
    expect(planAfterPlannerSync(-10, 0)).toBe(0);
    expect(planAfterPlannerSync(4311, -10)).toBe(4311);
  });
});

/**
 * The other half of the same bug, and the half that lives in SQL.
 *
 * `trg_sync_items_target_from_rag` was `AFTER UPDATE OF plan_qty`. A plan typed into a
 * cell that had no row yet is an INSERT, so it never reached `production_items` — the
 * Planner kept whatever it had, and the next Sync fed that back. The first plan set for
 * a line/shift was precisely the one that never propagated.
 */
describe("trg_sync_items_target_from_rag fires on the insert too", () => {
  const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

  /** The last CREATE TRIGGER for this name wins in the database, so read it that way. */
  const effectiveTrigger = () => {
    const hits = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .flatMap((f) => {
        const sql = readFileSync(resolve(MIGRATIONS, f), "utf8");
        return [
          ...sql.matchAll(
            /CREATE TRIGGER trg_sync_items_target_from_rag\s+([\s\S]*?)ON public\.rag_weekly_entries/g,
          ),
        ].map((m) => m[1]);
      });
    return hits[hits.length - 1];
  };

  it("finds the trigger at all", () => {
    expect(effectiveTrigger()).toBeDefined();
  });

  it("covers INSERT, not only UPDATE", () => {
    expect(effectiveTrigger()).toMatch(/AFTER INSERT OR UPDATE OF plan_qty/);
  });
});
