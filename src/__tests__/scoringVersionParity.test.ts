import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { actionPoints, setLabelPoints, setSeverityPoints, setExcludedDepartments } from "@/lib/qualityConstants";

/**
 * `actionPoints()` now has a twin in SQL, and twins drift.
 *
 * 20260822090000 freezes what an action is worth at the scale of its day, and the
 * backfill that writes those frozen figures runs in the database — so the rule had to
 * be expressed a second time, as `public.action_points_at()`. If the two ever disagree,
 * the backfill freezes wrong numbers into history with nothing left to compare them
 * against. That is the single largest risk in the change, and this is what stands
 * against it.
 *
 * WHAT THIS TEST DOES NOT DO, said plainly so nobody reads a green tick as more than it
 * is: it does NOT execute the SQL. There is no Postgres in this test run and no
 * pg-mem in the dependencies, so true parity is unproven here and can only be
 * established against a real database.
 *
 * What it does instead is pin the two halves that are checkable without one:
 *
 *   1. The TypeScript side, as a golden table. These ten rows are the cases the SQL
 *      twin must reproduce. When the twin is verified against a live database, this is
 *      the list to run it over; when somebody edits `actionPoints()`, this fails and
 *      tells them there is a second implementation to go and edit.
 *
 *   2. The SQL side, structurally: that the four guards exist and are in the same
 *      ORDER. Order is part of the rule, not a detail — a rejected safety row must
 *      return 0 for the safety reason, not the rejection reason, or the sentence
 *      printed beside it on the card names the wrong cause.
 */

/**
 * The LAST migration that defines the function, not a named one.
 *
 * It was pinned to 20260822090000, which created `action_points_at`. 20260823090000
 * then replaced it to make a label aggravate rather than substitute — and the test went
 * on happily checking the superseded definition, green, while the live one was
 * unexamined. A parity test validating a dead version of the function is worse than no
 * parity test, because it reports confidence it has not earned.
 *
 * Migration filenames sort chronologically by construction, so the last one that
 * contains the definition is the one in force.
 */
const MIGRATION_DIR = resolve(__dirname, "../..", "supabase/migrations");
const DEFINES = /CREATE OR REPLACE FUNCTION public\.action_points_at/;
const MIGRATION = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .reverse()
  .find((f) => DEFINES.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
if (!MIGRATION) throw new Error("No migration defines public.action_points_at");
const sql = readFileSync(resolve(MIGRATION_DIR, MIGRATION), "utf8");

/** The scale this file reasons in. Low 1 / Medium 2 / High 3 / Critical 4. */
const SEVERITY = { low: 1, medium: 2, high: 3, critical: 4 };
/** Foreign Body priced above every severity; Maintenance priced but not the leader's. */
const LABELS = { "foreign body": 5, "batch code": 2, maintenance: 3, paperwork: 5 };
const EXCLUDED = new Set(["maintenance"]);

beforeEach(() => {
  setSeverityPoints(SEVERITY);
  setLabelPoints(LABELS);
  // The golden table below is about labels and grades, so no department is excluded
  // for it. The department cases set their own, further down.
  setExcludedDepartments({});
});

/**
 * The golden table. Every row is a shape that has actually caused an argument, or that
 * the SQL twin gets wrong if it is written naively.
 */
const CASES: Array<{ name: string; action: Parameters<typeof actionPoints>[0]; points: number }> = [
  {
    name: "safety is counted, never charged — before any other test",
    action: { domain: "safety", severity: "critical", labels: ["Foreign Body"], validation_status: "validated" },
    points: 0,
  },
  {
    name: "a rejected action is void",
    action: { domain: "quality", severity: "critical", labels: ["Foreign Body"], validation_status: "rejected" },
    points: 0,
  },
  {
    name: "every label excluded — not the leader's at all",
    action: { domain: "quality", severity: "critical", labels: ["Maintenance"], validation_status: "open" },
    points: 0,
  },
  {
    name: "no labels still counts, on the severity",
    action: { domain: "quality", severity: "high", labels: [], validation_status: "open" },
    points: 3,
  },
  {
    name: "one priced label beats the severity",
    action: { domain: "quality", severity: "low", labels: ["Foreign Body"], validation_status: "open" },
    points: 5,
  },
  {
    name: "priced labels sum",
    action: { domain: "quality", severity: "low", labels: ["Foreign Body", "Batch code"], validation_status: "open" },
    points: 7,
  },
  {
    name: "the AC-6183 shape: one excluded label, one attributable — and the grade still outranks both",
    action: { domain: "quality", severity: "critical", labels: ["Batch code", "Maintenance"], validation_status: "open" },
    // Batch code charges 2, Maintenance is spared, and Critical is worth 4. Under the
    // replace rule this was 2 — a Critical action charged 2. Under MAX the grade holds.
    points: 4,
  },
  {
    name: "an excluded price leaves nothing behind, so the grade pays in full",
    action: { domain: "quality", severity: "critical", labels: ["Maintenance", "GMP"], validation_status: "open" },
    points: 4,
  },
  {
    name: "unpriced labels leave the severity in charge",
    action: { domain: "quality", severity: "medium", labels: ["GMP"], validation_status: "open" },
    points: 2,
  },
  {
    name: "no grade and no priced label scores 0",
    action: { domain: "quality", severity: null, labels: ["GMP"], validation_status: "open" },
    points: 0,
  },
  {
    name: "labels are matched lowercased and trimmed, exactly as the SQL keys them",
    action: { domain: "quality", severity: "low", labels: ["  FOREIGN BODY  "], validation_status: "open" },
    points: 5,
  },
  {
    name: "the grade wins when it outranks the labels — a cheap label cannot soften a Critical",
    action: { domain: "quality", severity: "critical", labels: ["Batch code"], validation_status: "open" },
    points: 4,
  },
  {
    name: "the labels win when they outrank the grade",
    action: { domain: "quality", severity: "medium", labels: ["Foreign Body"], validation_status: "open" },
    points: 5,
  },
  {
    name: "equal on both sides is the same number either way",
    action: { domain: "quality", severity: "medium", labels: ["Batch code"], validation_status: "open" },
    points: 2,
  },
];

describe("the golden table the SQL twin must reproduce", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(actionPoints(c.action, EXCLUDED)).toBe(c.points);
    });
  }
});

/**
 * The department half of the golden table, kept separate because it needs its own
 * module state — the exclusion set is pushed in rather than passed as an argument.
 *
 * Same contract as the table above: these are the rows the SQL twin must reproduce
 * when somebody runs it against a live database.
 */
describe("the golden table, with a department that is not the leader's", () => {
  const DEPT_CASES: Array<{ name: string; action: Parameters<typeof actionPoints>[0]; points: number }> = [
    {
      name: "an excluded department pays nothing, whatever the grade says",
      action: { domain: "quality", severity: "critical", labels: [], validation_status: "open", department: "Maintenance" },
      points: 0,
    },
    {
      name: "an excluded department pays nothing, whatever the labels are priced at",
      action: { domain: "quality", severity: "low", labels: ["Foreign Body"], validation_status: "open", department: "Maintenance" },
      points: 0,
    },
    {
      name: "a department that counts changes nothing about the arithmetic",
      action: { domain: "quality", severity: "low", labels: ["Foreign Body"], validation_status: "open", department: "Production" },
      points: 5,
    },
    {
      name: "a blank department still counts — an empty field removes nobody's deviation",
      action: { domain: "quality", severity: "high", labels: [], validation_status: "open", department: null },
      points: 3,
    },
    {
      name: "matched trimmed and case-folded, exactly as the snapshot keys it",
      action: { domain: "quality", severity: "critical", labels: [], validation_status: "open", department: "  MAINTENANCE " },
      points: 0,
    },
    {
      name: "a department the list has never heard of counts, rather than failing closed",
      action: { domain: "quality", severity: "medium", labels: [], validation_status: "open", department: "Hygiene" },
      points: 2,
    },
  ];

  for (const c of DEPT_CASES) {
    it(c.name, () => {
      setExcludedDepartments({ Maintenance: false, Production: true });
      expect(actionPoints(c.action, EXCLUDED)).toBe(c.points);
    });
  }
});

describe("action_points_at() keeps the guards, and keeps them in order", () => {
  /** The function body alone — the file also discusses these rules in prose. */
  const body = sql.slice(sql.indexOf("FUNCTION public.action_points_at"), sql.indexOf("COMMENT ON FUNCTION public.action_points_at"));

  /**
   * A canary, not a constraint. The lookup above always finds the live definition, so
   * the suite keeps testing the right function on its own; this line exists so that
   * MOVING the definition is noticed rather than absorbed silently. If it fails, the
   * fix is to update the name here AND to re-read the golden table above against the
   * new rule — which is the review this failure is asking for.
   */
  it("is read from the migration that is actually in force", () => {
    expect(MIGRATION).toBe("20260827090000_a_department_can_be_someone_elses.sql");
  });

  it("returns 0 for safety before it looks at anything else", () => {
    const safety = body.indexOf("_domain = 'safety'");
    const rejected = body.indexOf("_validation_status = 'rejected'");
    expect(safety).toBeGreaterThan(-1);
    expect(rejected).toBeGreaterThan(safety);
  });

  it("applies attribution before it prices anything", () => {
    const attribution = body.indexOf("scoring_version_excluded_label");
    const price = body.indexOf("scoring_version_label");
    expect(attribution).toBeGreaterThan(-1);
    expect(price).toBeGreaterThan(attribution);
  });

  /**
   * The department veto sits between the rejection guard and the labels, and the
   * position is the rule rather than a preference.
   *
   * Above the labels because it is the broader claim: the action belongs to somebody
   * else entirely, so there is nothing for a label to price. Below safety and
   * rejection because those two are about whether the action is chargeable AT ALL,
   * and the sentence printed beside a rejected Maintenance row has to name the
   * rejection — Quality looked and said it did not happen — not the department.
   */
  it("vetoes on the department after rejection and before the labels", () => {
    const rejected = body.indexOf("_validation_status = 'rejected'");
    const department = body.indexOf("scoring_version_excluded_department");
    const labels = body.indexOf("scoring_version_excluded_label");
    expect(department).toBeGreaterThan(rejected);
    expect(labels).toBeGreaterThan(department);
  });

  it("lets a blank department through rather than treating it as excluded", () => {
    expect(body).toMatch(/btrim\(coalesce\(_department, ''\)\) <> ''/);
  });

  it("matches the department trimmed and case-folded, as the snapshot stores it", () => {
    expect(body).toMatch(/lower\(btrim\(_department\)\)/);
  });

  it("takes the greater of the two — a label raises a charge, never lowers it", () => {
    expect(body).toMatch(/GREATEST\(_charge, coalesce\(_grade, 0\)\)/);
    // And never the other rule. `||` in plpgsql is string concatenation, but the shape
    // that matters is the early return the replace rule needed.
    expect(body).not.toMatch(/IF _charge > 0 THEN RETURN _charge/);
  });

  it("caps the label total, and resolves the cap at the action's own version", () => {
    expect(body).toMatch(/LEAST\(_charge, _cap/);
    // Not current_date: raising the ceiling in November must not change a July action.
    const capBlock = body.slice(body.indexOf("CAP_LabelPoints"));
    expect(capBlock).not.toMatch(/current_date/);
  });

  it("treats an absent ceiling as uncapped rather than as zero", () => {
    expect(body).toMatch(/IF _cap IS NOT NULL THEN/);
  });

  it("keys labels lowercased and trimmed, as the TypeScript does", () => {
    expect(body).toMatch(/lower\(trim\(/);
  });

  it("reads the dated snapshot, never the live tables", () => {
    expect(body).not.toMatch(/quality_severity_points|quality_options|quality_label_attribution/);
  });
});
