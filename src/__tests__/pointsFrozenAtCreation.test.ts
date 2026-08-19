import { describe, it, expect, beforeEach } from "vitest";
import {
  actionPoints, livePoints, pointsBreakdown, sumActionPoints,
  setLabelPoints, setSeverityPoints,
} from "@/lib/qualityConstants";
import { computeLeaderScore } from "@/lib/leaderScore";

/**
 * The acceptance criterion for the freeze, executable rather than argued.
 *
 * "Criar uma accao com Critical = 20; alterar Critical para 30; o score do periodo da
 * accao original permanece calculado com 20." Written against this system's own scale,
 * which is Low 1 / Medium 2 / High 3 / Critical 4 — the 20 and 30 in the specification
 * belong to a scale this factory does not use, and rebasing the tests to match a number
 * in a document rather than the number on the screen would be testing the document.
 *
 * The frozen figure arrives on the row from the database (`points_at_creation`, from
 * 20260822090000). Nothing in TypeScript computes it, and nothing in TypeScript should:
 * these tests set it the way a query would.
 */

const EXCLUDED = new Set(["maintenance"]);

beforeEach(() => {
  setSeverityPoints({ low: 1, medium: 2, high: 3, critical: 4 });
  setLabelPoints({ "foreign body": 5, "batch code": 2, maintenance: 3 });
});

describe("changing the scale does not re-score what is already logged", () => {
  /** Logged when Critical was worth 4, and frozen at 4. */
  const JULY = { domain: "quality", severity: "critical", labels: [], validation_status: "validated", points_at_creation: 4 };

  it("keeps the figure it was logged with when Critical is re-weighted", () => {
    expect(actionPoints(JULY, EXCLUDED)).toBe(4);
    setSeverityPoints({ low: 1, medium: 2, high: 3, critical: 8 });
    expect(actionPoints(JULY, EXCLUDED)).toBe(4);
  });

  it("keeps it when a label is re-priced, too — the other ruler that used to rewrite history", () => {
    const withLabel = { ...JULY, labels: ["Foreign Body"], points_at_creation: 5 };
    setLabelPoints({ "foreign body": 40 });
    expect(actionPoints(withLabel, EXCLUDED)).toBe(5);
  });

  it("keeps it when a label stops being the leader's, which re-scored history as well", () => {
    const withLabel = { ...JULY, labels: ["Batch code"], points_at_creation: 2 };
    expect(actionPoints(withLabel, new Set(["batch code"]))).toBe(2);
  });

  it("the period's quality score is unmoved by the re-weighting", () => {
    const score = () => computeLeaderScore(
      { actual: 100, target: 100, avgOEE: null, actions: [JULY], excludedLabels: EXCLUDED, gateLabels: new Set<string>() },
    ).quality.value;
    expect(score()).toBe(96);                       // 100 less the 4 it was logged at
    setSeverityPoints({ low: 1, medium: 2, high: 3, critical: 8 });
    expect(score()).toBe(96);                       // and NOT 92
  });

  it("a rollup over mixed rows sums the frozen figures, not today's", () => {
    const rows = [
      { ...JULY, points_at_creation: 4 },
      { ...JULY, severity: "low", points_at_creation: 1 },
    ];
    setSeverityPoints({ low: 9, medium: 9, high: 9, critical: 9 });
    expect(sumActionPoints(rows, EXCLUDED)).toBe(5);
  });
});

describe("a row with no frozen figure is scored live, exactly as before", () => {
  const CASES = [
    { name: "the column is absent — a base where the migration has not run", action: { domain: "quality", severity: "high", labels: [], validation_status: "open" } },
    { name: "the column is null — a row the backfill has not reached", action: { domain: "quality", severity: "high", labels: [], validation_status: "open", points_at_creation: null } },
  ];
  for (const c of CASES) {
    it(c.name, () => {
      expect(actionPoints(c.action, EXCLUDED)).toBe(3);
      setSeverityPoints({ low: 1, medium: 2, high: 7, critical: 4 });
      expect(actionPoints(c.action, EXCLUDED)).toBe(7);
    });
  }

  it("a frozen zero is a figure, not an absence", () => {
    // The trap a `points_at_creation || live` fallback walks straight into: 0 is falsy,
    // so every action frozen at nothing would quietly re-price itself against today.
    //
    // The scenario is real and it is the whole reason attribution was frozen alongside
    // the prices. In July this was Maintenance's, so it charged the leader 0. Somebody
    // has since decided Maintenance IS the leader's. Today's charge is therefore the
    // Critical grade — 4 — because the label's 3 cannot lower it. The action still cost
    // 0 in July, and July's report has to keep saying so.
    //
    // Deliberately NOT written with a safety row: safety is worth 0 live as well, so the
    // assertion would hold under the broken implementation too. It did, in the first
    // version of this test, and proved nothing.
    const july = { domain: "quality", severity: "critical", labels: ["Maintenance"], validation_status: "validated", points_at_creation: 0 };
    expect(livePoints(july, new Set())).toBe(4);
    expect(actionPoints(july, new Set())).toBe(0);
  });
});

describe("the card never explains a total it is not showing", () => {
  it("says both figures when the scale has moved since", () => {
    const action = { domain: "quality", severity: "critical", labels: ["Foreign Body"], validation_status: "open", points_at_creation: 5 };
    setLabelPoints({ "foreign body": 40 });
    const b = pointsBreakdown(action, EXCLUDED);
    expect(b.points).toBe(5);
    expect(b.basis).toBe("frozen");
    expect(b.explanation).toContain("5 points");
    expect(b.explanation).toContain("40");
    expect(livePoints(action, EXCLUDED)).toBe(40);
  });

  it("keeps the ordinary explanation when the scale has not moved", () => {
    const action = { domain: "quality", severity: "low", labels: ["Foreign Body"], validation_status: "open", points_at_creation: 5 };
    const b = pointsBreakdown(action, EXCLUDED);
    expect(b.basis).toBe("labels");
    expect(b.explanation).toBe("5 points — Foreign Body 5.");
  });

  it("still tells the three zeroes apart when nothing is frozen", () => {
    expect(pointsBreakdown({ domain: "safety", severity: "high", labels: [], validation_status: "open" }, EXCLUDED).basis).toBe("safety");
    expect(pointsBreakdown({ domain: "quality", severity: "high", labels: [], validation_status: "rejected" }, EXCLUDED).basis).toBe("rejected");
    expect(pointsBreakdown({ domain: "quality", severity: "high", labels: ["Maintenance"], validation_status: "open" }, EXCLUDED).basis).toBe("not_leaders");
  });
});

describe("a period that spans two versions of the scale says so", () => {
  const at = (v: number | null) => ({
    domain: "quality", severity: "high", labels: [], validation_status: "open",
    points_at_creation: 3, scoring_version_id: v,
  });
  const period = (actions: Parameters<typeof computeLeaderScore>[0]["actions"]) =>
    computeLeaderScore({
      actual: 100, target: 100, avgOEE: null, actions,
      excludedLabels: EXCLUDED, gateLabels: new Set<string>(),
    });

  it("says nothing when every action was scored on the same ruler", () => {
    expect(period([at(1), at(1)]).scales).toBeNull();
  });

  it("says nothing on a database that freezes nothing", () => {
    // Every row on a base where 20260822090000 has not run. Absent is not mixed.
    expect(period([at(null), at(null)]).scales).toBeNull();
  });

  it("names the count when a period straddles a re-pricing", () => {
    const s = period([at(1), at(2)]).scales;
    expect(s).toContain("2 scoring versions");
    expect(s).toContain("in force on its own date");
  });

  it("ignores rows that score nothing, so the notice cannot fire on a period that is not mixed", () => {
    // A rejected action and a safety row are worth 0 whatever ruler they were frozen
    // against, so the version they carry moves no figure on this card. A warning that
    // fires when nothing is wrong is a warning people learn to close.
    const s = period([
      at(1),
      { ...at(2), validation_status: "rejected" },
      { ...at(3), domain: "safety" },
    ]).scales;
    expect(s).toBeNull();
  });
});
