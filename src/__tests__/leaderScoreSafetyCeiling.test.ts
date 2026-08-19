import { describe, it, expect, afterEach } from "vitest";
import { computeLeaderScore, GATE_CAP } from "@/lib/leaderScore";
import { setLabelPoints } from "@/lib/qualityConstants";

afterEach(() => setLabelPoints({}));

const NOTHING_EXCLUDED = new Set<string>();

/** A perfect week on the two pillars this score can measure without any actions. */
const perfect = (actions: Array<Record<string, unknown>> = []) =>
  computeLeaderScore({
    actual: 100, target: 100, avgOEE: null,
    actions: actions as never, excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>(),
  });

const safety = (kind: string) => ({ domain: "safety", safety_kind: kind, severity: null, validation_status: "open" });

/**
 * Health & Safety is a CEILING on this score, never a weight — the rule migration
 * 20260818090000 opens with, and the one thing the whole scorecard module exists to
 * keep true: "if H&S were a fourth weight, a lost-time injury would cost some number
 * of points and a good volume week could buy them back. It cannot."
 *
 * A weight of 25% would have priced an injury at 25 points, and the leader in the
 * screenshot that prompted this — Production 100, Quality 92 — would have scored 72
 * for a week somebody was hurt in. A ceiling is applied after the weighted sum and can
 * only ever lower it, so no arithmetic here can turn an injury into a good week.
 */
describe("the H&S ceiling", () => {
  it("does not touch a period with no safety occurrence", () => {
    const r = perfect();
    expect(r.final).toBe(100);
    expect(r.cap).toBeNull();
  });

  it("caps a lost-time injury, however good the rest of the week was", () => {
    const r = perfect([safety("lost_time_injury")]);
    expect(r.final).toBe(GATE_CAP);
    expect(r.cap?.reason).toMatch(/lost-time injury/i);
  });

  it("caps a reportable accident the same way", () => {
    const r = perfect([safety("reportable_accident")]);
    expect(r.final).toBe(GATE_CAP);
    expect(r.cap?.reason).toMatch(/reportable accident/i);
  });

  it("names both when both happened, rather than only the first found", () => {
    const r = perfect([safety("lost_time_injury"), safety("reportable_accident")]);
    expect(r.cap?.reason).toMatch(/lost-time injury/i);
    expect(r.cap?.reason).toMatch(/reportable accident/i);
  });

  it("leaves first aid, near misses and toolbox talks uncapped", () => {
    // Reporting is the behaviour we want. A ceiling on a near miss would teach the
    // team to stop filing them, which is the one inversion this domain exists to
    // prevent — see actionPoints(), which prices every safety row at 0 for the
    // same reason.
    for (const kind of ["first_aid", "near_miss", "safety_observation", "toolbox_talk", "ppe_breach"]) {
      const r = perfect([safety(kind)]);
      expect(r.final, kind).toBe(100);
      expect(r.cap, kind).toBeNull();
    }
  });

  it("ignores an occurrence Quality rejected — it did not happen", () => {
    const r = perfect([{ ...safety("lost_time_injury"), validation_status: "rejected" }]);
    expect(r.final).toBe(100);
    expect(r.cap).toBeNull();
  });

  it("only ever lowers: a week already below the ceiling keeps its own score", () => {
    setLabelPoints({ gmp: 40 });
    const r = computeLeaderScore({
      actual: 0, target: 100, avgOEE: null,
      actions: [
        { severity: null, labels: ["GMP"], validation_status: "open" },
        safety("lost_time_injury"),
      ] as never,
      excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>(),
    });
    // Production 0, Quality 60 — the weighted sum is already under 49, and a ceiling
    // that raised it would be a floor.
    expect(r.final).toBeLessThan(GATE_CAP);
    expect(r.cap?.applied).toBe(false);
  });
});

/**
 * Documentation used to read 100% while paperwork errors sat waiting on a verdict.
 *
 * "No validated paperwork error" was true and read as a compliment. The pillar had not
 * been measured — Quality had not ruled yet — and a 100% nobody measured is worse than
 * no number, especially in the block that decides a quarter of the final score.
 *
 * Null is the same answer `productionScore` already gives a period with no target: the
 * component drops out and its weight is shared among the ones that could be measured,
 * rather than counting as a free full mark.
 */
describe("documentation only scores what was judged", () => {
  const paperwork = (validation_status: string) =>
    ({ severity: null, labels: ["Paperwork"], validation_status });

  it("is unmeasured while a paperwork action awaits a verdict", () => {
    const r = perfect([paperwork("open")]);
    expect(r.documentation.value).toBeNull();
    expect(r.documentation.basis).toMatch(/awaiting a verdict/i);
  });

  it("is unmeasured while one is under investigation", () => {
    const r = perfect([paperwork("under_investigation")]);
    expect(r.documentation.value).toBeNull();
  });

  it("drops its weight rather than counting as zero", () => {
    const r = perfect([paperwork("open")]);
    expect(r.applied.documentation_pct).toBe(0);
    // Production 40 and Quality 35 rescaled to 100 between them.
    expect(r.applied.production_pct + r.applied.quality_pct).toBe(100);
  });

  it("scores 100 when a paperwork action was judged and cleared", () => {
    const r = perfect([paperwork("rejected")]);
    expect(r.documentation.value).toBe(100);
  });

  it("scores 100 when there was no paperwork action at all", () => {
    // Nothing pending, nothing found — a measured clean period, not an unmeasured one.
    const r = perfect([{ severity: null, labels: ["GMP"], validation_status: "open" }]);
    expect(r.documentation.value).toBe(100);
  });

  it("charges the validated error, as it always did", () => {
    setLabelPoints({ paperwork: 5 });
    const r = perfect([paperwork("validated")]);
    expect(r.documentation.value).toBe(95);
  });

  it("does not let one pending error hide an already validated one", () => {
    // A verdict exists in this period. The pillar has been measured; the pending row
    // is a separate question and must not erase the error somebody already signed.
    setLabelPoints({ paperwork: 5 });
    const r = perfect([paperwork("validated"), paperwork("open")]);
    expect(r.documentation.value).toBe(95);
  });
});

/**
 * A safety row is not "not attributable to the leader".
 *
 * The quality basis subtracts everything `standsAgainstLeader` rejects and calls the
 * whole remainder not attributable. That test rejects a safety row FIRST, before it
 * looks at labels or department — so a period with six near misses printed "6 not
 * attributable to the leader", which says somebody else's fault about six occurrences
 * that were nobody's fault and are not scored by design.
 *
 * The sentence was true while safety rows could not reach this function: `safety_kind`
 * was missing from every select and `domain` from the tablet's projection, so nothing
 * ever took that branch on real data. Fixing the fetch is what put the wrong words on
 * the screen — see theCeilingCannotSeeTheInjury.test.ts.
 */
describe("what the quality basis calls a safety row", () => {
  const withSafety = () => computeLeaderScore({
    actual: 100, target: 100, avgOEE: null,
    actions: [
      { severity: "high", validation_status: "open", domain: "quality" },
      safety("near_miss"), safety("near_miss"), safety("toolbox_talk"),
    ] as never,
    excludedLabels: NOTHING_EXCLUDED, gateLabels: new Set<string>(),
  });

  it("does not call it somebody else's fault", () => {
    expect(withSafety().quality.basis).not.toMatch(/not attributable/i);
  });

  it("names them as safety, and says they are not scored here", () => {
    const basis = withSafety().quality.basis;
    expect(basis).toMatch(/3 safety/i);
    expect(basis).toMatch(/health & safety|not scored/i);
  });

  it("still says not attributable when something genuinely is not theirs", () => {
    const r = computeLeaderScore({
      actual: 100, target: 100, avgOEE: null,
      actions: [
        { severity: "high", validation_status: "open", domain: "quality" },
        { severity: "high", validation_status: "open", domain: "quality", labels: ["Maintenance"] },
        safety("near_miss"),
      ] as never,
      // Lowercased: `countsAgainstLeader` normalises the action's labels before the
      // lookup, so the excluded set has to be in the same case the hook stores it in.
      excludedLabels: new Set(["maintenance"]), gateLabels: new Set<string>(),
    });
    expect(r.quality.basis).toMatch(/1 not attributable/i);
    expect(r.quality.basis).toMatch(/1 safety/i);
  });
});
