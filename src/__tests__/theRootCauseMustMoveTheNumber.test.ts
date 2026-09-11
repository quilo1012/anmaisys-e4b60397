/**
 * The root cause was stored, audited — and changed no number.
 *
 * `root_cause_area` shipped in 20260911075414 and did nothing for two independent
 * reasons, both read off the live base on 2026-09-11:
 *
 *   1. It was NULL on all 182 actions. The SafetyCulture sync (84 of them) never writes
 *      it, and the only other way to fill it was a person opening one action at a time.
 *   2. `trg_quality_action_freeze_points_upd` did not list it in its WHEN clause, so
 *      setting it never re-priced the action. `points_at_creation` — the only figure a
 *      scorecard reads — stayed where it was while the screen's live preview showed 0.
 *
 * (2) is the dangerous one: it fails looking like success. The save works, the preview
 * moves, and the frozen number behind the card does not. Nothing errors, and the only
 * way to notice is to compare two numbers nobody displays side by side.
 *
 * These are the properties that make the field real. Each one, if lost, restores the
 * silence rather than an error — which is why they are asserted against the migration
 * text itself and not only against behaviour.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  actionPoints,
  effectiveRootCause,
  pointsBreakdown,
  setLabelPoints,
  setRootCauseAttribution,
  DERIVED_ROOT_CAUSE,
} from "@/lib/qualityConstants";

const MIGRATION_DIR = resolve(__dirname, "..", "..", "supabase/migrations");

const migration = () => {
  const file = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => /default_root_cause_from_label/.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
  if (!file) throw new Error("No migration defines default_root_cause_from_label");
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
};

describe("the re-pricing trigger", () => {
  const sql = migration();

  it("re-prices when the root cause changes", () => {
    // THE assertion of this file. Without `root_cause_area` in the WHEN clause the whole
    // feature is inert and says nothing about being inert.
    const when = sql.slice(sql.indexOf("CREATE TRIGGER trg_quality_action_freeze_points_upd"));
    const clause = when.slice(when.indexOf("WHEN ("), when.indexOf("EXECUTE FUNCTION"));
    expect(clause).toMatch(/old\.root_cause_area\s+IS DISTINCT FROM new\.root_cause_area/);

    // And still re-prices on everything it re-priced before. A WHEN clause is a list it
    // is easy to rewrite rather than extend.
    for (const field of ["severity", "labels", "validation_status", "domain"]) {
      expect(clause).toContain(`old.${field}`);
    }
  });
});

describe("the Maintenance label declares its root cause", () => {
  const sql = migration();

  it("runs after the guard and before the re-pricing, by name", () => {
    // Trigger order is alphabetical and nothing else enforces this. Sorting BEFORE the
    // guard would throw "Only Quality may set the root cause of an action." at a line
    // leader for ticking a label; sorting AFTER the freeze would set the field too late
    // to change the price.
    const names = ["trg_a_quality_root_cause_guard", "trg_b_quality_root_cause_default",
                   "trg_quality_action_freeze_points_upd"];
    expect([...names].sort()).toEqual(names);
    expect(sql).toContain("CREATE TRIGGER trg_b_quality_root_cause_default");
  });

  it("fills the blank and never overwrites an answer", () => {
    // Quality overruling the default is the case this must not break: an explicit
    // `Production` on a machine fault puts the charge back on the leader, deliberately.
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.default_root_cause_from_label"));
    expect(body).toMatch(/IF NEW\.root_cause_area IS NOT NULL THEN RETURN NEW; END IF;/);
  });

  it("back-fills only rows nobody has answered", () => {
    const backfill = sql.slice(sql.lastIndexOf("UPDATE public.quality_actions"));
    expect(backfill).toContain("root_cause_area IS NULL");
  });
});

describe("what the screen previews", () => {
  afterEach(() => {
    setLabelPoints({});
    setRootCauseAttribution({});
  });

  /** What the seed migration writes into `quality_options` for kind `root_cause`. */
  const seed = () => setRootCauseAttribution({
    Production: true, Quality: true, Maintenance: false, Warehouse: false,
    Engineering: false, Supplier: false, External: false,
  });

  /** "The ceiling in the women's restroom requires repair" — GMP · Maintenance, 5 points. */
  const CEILING = { domain: "quality", severity: "low", labels: ["GMP", "Maintenance"] };

  it("charges nothing for a machine fault with a priced label beside it", () => {
    setLabelPoints({ GMP: 5, Maintenance: 0 });
    seed();
    // The label rule alone charges this 5: `countsAgainstLeader` needs only ONE
    // attributable label, deliberately, and `GMP` is one. The derived root cause is what
    // takes it off — before any label is priced.
    expect(actionPoints(CEILING, new Set(["maintenance"]))).toBe(0);
  });

  it("says so in words rather than showing a bare zero", () => {
    setLabelPoints({ GMP: 5, Maintenance: 0 });
    seed();
    const b = pointsBreakdown(CEILING, new Set(["maintenance"]));
    expect(b.basis).toBe("not_leaders_root_cause");
    expect(b.explanation).toContain(DERIVED_ROOT_CAUSE);
    // The 5 that was taken off is shown struck through, not dropped. A total that has
    // quietly had something removed is indistinguishable from one that never had it.
    expect(b.spared.map((s) => s.label)).toContain("GMP");
    expect(b.charged).toHaveLength(0);
  });

  it("gives the points back when Quality says it was Production", () => {
    setLabelPoints({ GMP: 5, Maintenance: 0 });
    seed();
    expect(actionPoints({ ...CEILING, root_cause_area: "Production" }, new Set(["maintenance"]))).toBe(5);
  });

  it("leaves an action without the label exactly where it was", () => {
    setLabelPoints({ GMP: 5 });
    seed();
    expect(effectiveRootCause({ labels: ["GMP"] })).toBeNull();
    expect(actionPoints({ domain: "quality", severity: "low", labels: ["GMP"] }, new Set())).toBe(5);
  });

  it("does not touch the labels, so a gate still fires", () => {
    // A foreign body caps the period at CAP_Gate whoever was at fault — BRC, and the
    // reason the gate is computed over `labels` and never over the points. This asserts
    // the input that gate test reads is unchanged by the derivation.
    const fb = { domain: "quality", severity: "low", labels: ["Foreign Body", "Maintenance"] };
    setLabelPoints({ "Foreign Body": 3, Maintenance: 0 });
    seed();
    expect(actionPoints(fb, new Set(["maintenance"]))).toBe(0);
    expect(fb.labels).toContain("Foreign Body");
  });
});
