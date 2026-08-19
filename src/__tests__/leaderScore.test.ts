import { describe, it, expect, afterEach } from "vitest";
import { computeLeaderScore, displayScore, rankLeadersByScore, DEFAULT_WEIGHTS } from "@/lib/leaderScore";
import { setLabelPoints } from "@/lib/qualityConstants";

const noActions: never[] = [];

/** Label prices are module state — leave the next test the unpriced default. */
afterEach(() => setLabelPoints({}));

/** These cases are about the score maths, not attribution — nothing is excluded. */
const NOTHING_EXCLUDED = new Set<string>();

describe("computeLeaderScore", () => {
  it("production is attainment, capped at 100", () => {
    const over = computeLeaderScore({ actual: 130, target: 100, avgOEE: null, actions: noActions, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(over.production.value).toBe(100);
    const under = computeLeaderScore({ actual: 80, target: 100, avgOEE: null, actions: noActions, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(under.production.value).toBe(80);
  });

  it("falls back to OEE when nothing was planned", () => {
    const r = computeLeaderScore({ actual: 0, target: 0, avgOEE: 72, actions: noActions, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(r.production.value).toBe(72);
    expect(r.production.basis).toMatch(/no target/i);
  });

  it("every action that stands costs quality points, whatever its verdict so far", () => {
    // An action raised against the shift is a quality event while it is open. A
    // leader with an open action reading 100% is the number nobody believes twice.
    const open = [{ severity: "critical", validation_status: "open" }];
    expect(computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: open, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() }).quality.value).toBe(96);

    const investigating = [{ severity: "high", validation_status: "under_investigation" }];
    expect(computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: investigating, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() }).quality.value).toBe(97);

    const validated = [{ severity: "critical", validation_status: "validated" }];
    expect(computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: validated, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() }).quality.value).toBe(96);
  });

  it("a rejected action is void — Quality looked and said it was not real", () => {
    const rejected = [{ severity: "critical", validation_status: "rejected" }];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: rejected, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(r.quality.value).toBe(100);
    expect(r.quality.basis).toMatch(/rejected/i);
  });

  it("documentation loses 5 per validated paperwork action, and nothing for the rest", () => {
    const actions = [
      { severity: "low", labels: ["Paperwork"], validation_status: "validated" },
      { severity: "low", labels: ["Paperwork"], validation_status: "validated" },
      { severity: "low", labels: ["Paperwork"], validation_status: "open" },
      { severity: "low", labels: ["Label"], validation_status: "validated" },
    ];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(r.documentation.value).toBe(90);
  });

  it("the documentation penalty is the price Quality put on the Paperwork label", () => {
    // One price, set once in Lists & scoring. The 5% is what an unpriced label falls
    // back to, not a second number living beside the first.
    const actions = [
      { severity: null, labels: ["Paperwork"], validation_status: "validated" },
      { severity: null, labels: ["Paperwork"], validation_status: "validated" },
    ];
    const input = { actual: 100, target: 100, avgOEE: null, actions, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() };

    setLabelPoints({ Paperwork: 10 });
    expect(computeLeaderScore(input).documentation.value).toBe(80);

    // Unpriced is not free: it means "no price set", and the old rule stands.
    setLabelPoints({ Paperwork: 0 });
    expect(computeLeaderScore(input).documentation.value).toBe(90);
  });

  it("a validated paperwork error is charged once, by the documentation block that owns it", () => {
    // It used to be charged twice: quality points AND the demerit. The two components
    // then moved together on one error, and pricing the label moved both at once.
    const validated = [{ severity: "critical", labels: ["Paperwork"], validation_status: "validated" }];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: validated, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(r.quality.value).toBe(100);
    expect(r.documentation.value).toBe(95);
    expect(r.quality.basis).toMatch(/documentation/i);
  });

  it("an unjudged paperwork action is still a quality event, because nothing else has charged it", () => {
    // Only the validated ones move to the demerit. Letting an open one out of quality
    // too would mean a raised action is charged nowhere until somebody signs it off.
    const open = [{ severity: "critical", labels: ["Paperwork"], validation_status: "open" }];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: open, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(r.quality.value).toBe(96);
    // ...and documentation is UNMEASURED, not 100. This assertion used to read 100,
    // which was the bug: "no validated paperwork error" was true of a pillar nobody
    // had ruled on, and it paid out a full quarter of the final score for the
    // difference. See the documentation block in leaderScoreSafetyCeiling.test.ts.
    expect(r.documentation.value).toBeNull();
  });

  it("weights the three components", () => {
    // Severity null → 0 quality points, so quality stays 100 and only documentation
    // moves: 100 production, 100 quality, 90 documentation at 40/35/25 → 97.5
    const actions = [
      { severity: null, labels: ["Paperwork"], validation_status: "validated" },
      { severity: null, labels: ["Paperwork"], validation_status: "validated" },
    ];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() }, DEFAULT_WEIGHTS);
    expect(r.final!).toBeCloseTo(97.5, 5);
  });

  it("drops a component with no data and shares its weight, instead of scoring it zero", () => {
    // No target and no OEE: production cannot be measured. A leader with a clean
    // quality and documentation record must not be dragged to 60 by an absent plan.
    const r = computeLeaderScore({ actual: 0, target: 0, avgOEE: null, actions: noActions, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(r.production.value).toBeNull();
    expect(r.final).toBe(100);
    expect(r.applied.production_pct).toBe(0);
    expect(r.applied.quality_pct + r.applied.documentation_pct).toBe(100);
  });
});

describe("displayScore", () => {
  it("rounds down, so a deduction can never round back to full marks", () => {
    // One Low action: quality 99, the other two 100 → 99.7 weighted. Shown as 100%
    // it read as a clean period with an action open on the board.
    const actions = [{ severity: "low", validation_status: "open" }];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(r.final).toBeCloseTo(99.7, 1);
    expect(displayScore(r.final)).toBe(99);
  });

  it("leaves a genuine 100 alone", () => {
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: [], excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>() });
    expect(displayScore(r.final)).toBe(100);
  });
});

describe("rankLeadersByScore", () => {
  const rows = [
    { leader: "Ana", score: 74 },
    { leader: "Bruno", score: 91 },
    { leader: "Carla", score: 83 },
  ];

  it("ranks by score, best first", () => {
    const rank = rankLeadersByScore(rows);
    expect(rank.get("Bruno")).toBe(1);
    expect(rank.get("Carla")).toBe(2);
    expect(rank.get("Ana")).toBe(3);
  });

  /**
   * The regression this exists for.
   *
   * The Leader Performance table hands 🥇🥈🥉 to rows 0, 1 and 2 of whatever order the
   * table is currently in, and every one of its eleven columns is sortable. Sorting by
   * "Open Actions" descending gave the gold medal to the leader with the most open
   * actions; sorting by "Doc errors" gave it to whoever had made the most paperwork
   * errors. A medal is a statement about a person, so it cannot be a property of a row
   * index.
   */
  it("is the same rank whatever order the rows arrive in", () => {
    const forwards = rankLeadersByScore(rows);
    const backwards = rankLeadersByScore([...rows].reverse());
    const byName = rankLeadersByScore([...rows].sort((a, b) => a.leader.localeCompare(b.leader)));
    for (const name of ["Ana", "Bruno", "Carla"]) {
      expect(backwards.get(name)).toBe(forwards.get(name));
      expect(byName.get(name)).toBe(forwards.get(name));
    }
  });

  it("leaves a leader with nothing measurable unranked, rather than last", () => {
    const rank = rankLeadersByScore([...rows, { leader: "Dinis", score: null }]);
    expect(rank.get("Dinis")).toBeNull();
    // And an unranked leader must not push anybody down the list.
    expect(rank.get("Ana")).toBe(3);
  });

  it("shares a rank between equal scores, and skips the one they used up", () => {
    // Two leaders on 91 are both first. Nobody is second; the next is third.
    const rank = rankLeadersByScore([
      { leader: "Ana", score: 91 },
      { leader: "Bruno", score: 91 },
      { leader: "Carla", score: 70 },
    ]);
    expect(rank.get("Ana")).toBe(1);
    expect(rank.get("Bruno")).toBe(1);
    expect(rank.get("Carla")).toBe(3);
  });

  it("ranks nobody when nobody has a score", () => {
    const rank = rankLeadersByScore([{ leader: "Ana", score: null }, { leader: "Bruno", score: null }]);
    expect(rank.get("Ana")).toBeNull();
    expect(rank.get("Bruno")).toBeNull();
  });
});

/**
 * A verdict on pending paperwork is a TRANSFER, and the card is allowed to say so.
 *
 * The Documentation section used to offer "a verdict on them would cost up to −4%",
 * which is not a smaller version of the truth — it is the wrong sign. While an error is
 * unjudged the quality pillar is charging its severity points AND the documentation
 * pillar is unscored, so its 25% is being carried by production and quality. Validating
 * it hands the charge to documentation at the label's price and quality gives the points
 * back, which on ordinary numbers leaves the leader BETTER off.
 *
 * A leader who read that box learned that leaving paperwork unjudged protects their
 * score. It does the opposite, and Quality is the one who cannot act on it.
 *
 * These cases exist so the sentence the card now prints — "a verdict is a transfer, not
 * a new penalty" — cannot quietly stop being true. If a re-pricing ever makes a verdict
 * genuinely cost, this fails and the copy has to be rewritten with it.
 */
describe("what a verdict on pending paperwork actually does", () => {
  const twoPaperwork = (validation: string) => {
    setLabelPoints({ Paperwork: 2 });
    return computeLeaderScore(
      {
        actual: 100, target: 100, avgOEE: null,
        actions: [
          { severity: "low", labels: ["Paperwork"], validation_status: validation, domain: "quality" },
          { severity: "low", labels: ["Paperwork"], validation_status: validation, domain: "quality" },
        ] as never,
        excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>(),
      },
      DEFAULT_WEIGHTS,
    );
  };

  it("charges the open error in quality, and leaves documentation unscored", () => {
    const open = twoPaperwork("open");
    expect(open.quality.value).toBe(96);
    expect(open.documentation.value).toBeNull();
    expect(open.applied.documentation_pct).toBe(0);
  });

  it("hands the charge to documentation and gives the quality points back", () => {
    const validated = twoPaperwork("validated");
    expect(validated.quality.value).toBe(100);
    expect(validated.documentation.value).toBe(96);
  });

  it("does not lower the final score — the card may not call it a cost", () => {
    // 98 → 99 on these numbers. The assertion is the DIRECTION, not the pair: a
    // re-priced label moves both figures and the claim on the card is only that a
    // verdict is not a penalty.
    expect(displayScore(twoPaperwork("validated").final)!)
      .toBeGreaterThanOrEqual(displayScore(twoPaperwork("open").final)!);
  });
});
