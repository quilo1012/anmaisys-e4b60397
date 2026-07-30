import { describe, it, expect } from "vitest";
import { buildOpportunities } from "@/components/PreventiveOpportunities";

const NOW = new Date("2026-07-30T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const wo = (o: Partial<Parameters<typeof buildOpportunities>[0][number]> = {}) => ({
  created_at: daysAgo(3), wo_type: "production", machine: "Capper 4",
  description: "capper jam", line_at_time: "Line 3", line_id: "l3", ...o,
});

describe("buildOpportunities", () => {
  it("ignores a problem that happened once", () => {
    expect(buildOpportunities([wo()], NOW)).toEqual([]);
  });

  it("surfaces a problem that came back, and counts this week separately", () => {
    const [line] = buildOpportunities(
      [wo(), wo({ created_at: daysAgo(2) }), wo({ created_at: daysAgo(20) })],
      NOW,
    );
    expect(line.line).toBe("Line 3");
    expect(line.issues[0].count).toBe(3);
    expect(line.issues[0].count7d).toBe(2);
  });

  it("leaves preventive orders out of its own input", () => {
    // Otherwise the module recommends work because its last recommendation was done.
    const rows = [wo(), wo({ created_at: daysAgo(2) }), wo({ wo_type: "preventive" }), wo({ wo_type: "preventive" })];
    const [line] = buildOpportunities(rows, NOW);
    expect(line.issues[0].count).toBe(2);
    expect(line.failures30d).toBe(2);
  });

  it("drops anything older than 30 days", () => {
    expect(buildOpportunities([wo({ created_at: daysAgo(40) }), wo({ created_at: daysAgo(45) })], NOW)).toEqual([]);
  });

  it("keeps lines apart even when the same machine fails on both", () => {
    const rows = [
      wo(), wo({ created_at: daysAgo(2) }),
      wo({ line_at_time: "Line 5" }), wo({ line_at_time: "Line 5", created_at: daysAgo(2) }),
    ];
    expect(buildOpportunities(rows, NOW).map((l) => l.line).sort()).toEqual(["Line 3", "Line 5"]);
  });

  it("skips an order that names neither a machine nor a problem", () => {
    const rows = [wo({ machine: "", description: "" }), wo({ machine: "", description: "" })];
    expect(buildOpportunities(rows, NOW)).toEqual([]);
  });
});
