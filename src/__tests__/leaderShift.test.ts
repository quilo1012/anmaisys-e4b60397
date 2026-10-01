import { describe, expect, it } from "vitest";
import { leadersForShift, observedShifts } from "@/lib/leaderShift";

/**
 * The register (`line_leaders.shift`) said BOTH for leaders who only ever work nights,
 * so the Night selector listed 17 names of which one was a night leader. History wins;
 * the register only speaks for someone with no sessions yet.
 */
const leaders = [
  { name: "Cainan", shift: "BOTH" },
  { name: "Muriel", shift: "DAY" },
  { name: "New Guy", shift: "NIGHT" },
  { name: "Fresh Both", shift: "BOTH" },
  { name: "Blank", shift: null },
];
const observed = observedShifts([
  { leader_name: "CAINAN", shift: "NIGHT" },
  { leader_name: "  muriel ", shift: "DAY" },
  { leader_name: "", shift: "DAY" },
  { leader_name: null, shift: "NIGHT" },
]);
const names = (s: "all" | "DAY" | "NIGHT") => leadersForShift(leaders, observed, s).map((l) => l.name);

describe("leadersForShift", () => {
  it("lets history beat the register: a BOTH who only works nights is not in Day", () => {
    expect(names("DAY")).not.toContain("Cainan");
    expect(names("NIGHT")).toContain("Cainan");
  });

  it("falls back to the register for a leader with no sessions at all", () => {
    expect(names("NIGHT")).toContain("New Guy");
    expect(names("DAY")).not.toContain("New Guy");
  });

  it("shows a BOTH or blank register with no history on both shifts", () => {
    for (const s of ["DAY", "NIGHT"] as const) {
      expect(names(s)).toContain("Fresh Both");
      expect(names(s)).toContain("Blank");
    }
  });

  it("returns everyone, in order, for all shifts", () => {
    expect(names("all")).toEqual(leaders.map((l) => l.name));
  });

  it("matches names ignoring case and surrounding spaces", () => {
    expect(names("DAY")).toContain("Muriel");
    expect(names("NIGHT")).not.toContain("Muriel");
  });
});
