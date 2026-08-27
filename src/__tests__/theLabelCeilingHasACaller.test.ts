import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  actionPoints, maxLabelPoints, setMaxLabelPoints,
  setSeverityPoints, setLabelPoints, setHazardPoints, setExcludedDepartments,
} from "@/lib/qualityConstants";

/**
 * The SQL applied a ceiling the TypeScript never loaded.
 *
 * `public.action_points_at()` has always ended its label arithmetic with
 *
 *     IF _cap IS NOT NULL THEN _charge := LEAST(_charge, _cap::integer); END IF;
 *
 * reading CAP_LabelPoints out of leader_scorecard_threshold. The TypeScript twin has the
 * machinery for it — `maxLabelPoints()` over a module-level cap — and until now the only
 * callers of `setMaxLabelPoints` in the whole repository were tests. In production it
 * returned Infinity, always.
 *
 * Nothing was wrong yet: the row does not exist, and an absent ceiling means uncapped on
 * both sides. But `qualityConstants` documents inserting that row as how the ceiling gets
 * turned on, so the first person to follow those instructions would have had the database
 * capping and the form not — the same figure computed two ways, disagreeing, with the
 * database's version being the one that gets stored.
 *
 * Two things are pinned here, because either alone would let it come back: that the
 * ceiling actually changes what an action is charged, and that something outside the
 * tests loads it.
 */

const SEVERITY = { low: 1, medium: 2, high: 3, critical: 4 };
const LABELS: Record<string, number> = { "foreign body": 5, "batch code": 2, gmp: 15, paperwork: 5 };

beforeEach(() => {
  setSeverityPoints(SEVERITY);
  setLabelPoints(LABELS);
  setHazardPoints({});
  setExcludedDepartments({});
  setMaxLabelPoints(null);
});

describe("the label ceiling", () => {
  it("is uncapped when no row sets it, which is what the database also does", () => {
    expect(maxLabelPoints()).toBe(Infinity);
    // Foreign Body 5 + GMP 15 + Paperwork 5 = 25, on a scale whose worst grade is 4.
    const accao = {
      domain: "quality", severity: "low" as const, validation_status: "open",
      labels: ["Foreign Body", "GMP", "Paperwork"],
    };
    expect(actionPoints(accao, new Set())).toBe(25);
  });

  it("caps the label total once a row sets it, as LEAST(_charge, _cap) does", () => {
    setMaxLabelPoints(20);
    const accao = {
      domain: "quality", severity: "low" as const, validation_status: "open",
      labels: ["Foreign Body", "GMP", "Paperwork"],
    };
    expect(actionPoints(accao, new Set())).toBe(20);
  });

  it("caps the labels, never the grade — a ceiling is not a discount on Critical", () => {
    // The SQL takes GREATEST(_charge, _grade) AFTER capping _charge, so a ceiling below
    // the top grade must not reduce what a Critical costs. If this ever inverts, lowering
    // a ceiling would quietly cut the price of the worst grade there is.
    setMaxLabelPoints(1);
    const accao = {
      domain: "quality", severity: "critical" as const, validation_status: "open",
      labels: ["Batch code"],
    };
    expect(actionPoints(accao, new Set())).toBe(4);
  });

  it("has a caller outside the tests", () => {
    // The whole defect in one assertion. Before this change the only files naming
    // setMaxLabelPoints were qualityConstants itself and a test.
    const SRC = resolve(__dirname, "..");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((e) => {
        const p = join(d, e);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(e) ? [p] : [];
      });

    const chamadores = walk(SRC)
      .filter((f) => !f.includes("__tests__") && !/\.test\.tsx?$/.test(f))
      .filter((f) => !f.endsWith("lib/qualityConstants.ts"))
      .filter((f) => /setMaxLabelPoints/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1));

    expect(chamadores.length).toBeGreaterThan(0);
  });

  it("is mounted in the app, beside the other scoring parameters", () => {
    // A hook nobody renders is the same as no hook. It belongs with the severity and
    // label syncs, which are mounted once at the top for the same reason.
    const app = readFileSync(resolve(__dirname, "..", "App.tsx"), "utf8");
    expect(app).toMatch(/<LabelPointsCapSync \/>/);
    expect(app).toMatch(/<SeverityPointsSync \/>/);
  });
});
