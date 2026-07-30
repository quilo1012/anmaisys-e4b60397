import { describe, it, expect } from "vitest";
import { leaderTracking, scoreImpactLabel } from "./leaderTracking";

const a = (o: Partial<Parameters<typeof leaderTracking>[0][number]> = {}) => ({
  leader_name: "Gill", shift: "DAY", severity: "low", labels: [], validation_status: "open", ...o,
});

describe("leaderTracking", () => {
  it("counts a rejected action as raised but charges the leader nothing", () => {
    const [row] = leaderTracking([
      a({ severity: "critical", validation_status: "rejected" }),
      a({ severity: "low" }),
    ]);
    expect(row.total).toBe(2);
    expect(row.points).toBe(1); // the Low only — the rejected Critical costs nothing
    expect(row.highCritical).toBe(1); // still visible as raised
  });

  it("only counts paperwork as a demerit once Quality has validated it", () => {
    const [row] = leaderTracking([
      a({ labels: ["Paperwork"], validation_status: "validated" }),
      a({ labels: ["Paperwork"], validation_status: "open" }),
    ]);
    expect(row.paperwork).toBe(1);
    expect(row.paperworkPending).toBe(1);
    expect(row.documentationPenaltyPct).toBe(5);
    expect(scoreImpactLabel(row)).toContain("−5% doc");
  });

  it("reads Compliant only when nothing stands against the leader", () => {
    const [row] = leaderTracking([a({ severity: "critical", validation_status: "rejected" })]);
    expect(row.clean).toBe(true);
    expect(scoreImpactLabel(row)).toBe("Compliant");
  });

  it("puts the leader carrying the most severity first", () => {
    const rows = leaderTracking([
      a({ leader_name: "Ana", severity: "low" }),
      a({ leader_name: "Marcio", severity: "critical" }),
    ]);
    expect(rows.map((r) => r.leader)).toEqual(["Marcio", "Ana"]);
  });

  it("groups an action with no leader rather than dropping it", () => {
    const rows = leaderTracking([a({ leader_name: null }), a({ leader_name: "  " })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].leader).toBe("Unassigned");
    expect(rows[0].total).toBe(2);
  });

  it("lists every shift the actions came from", () => {
    const [row] = leaderTracking([a({ shift: "DAY" }), a({ shift: "night" })]);
    expect(row.shifts).toBe("DAY, NIGHT");
  });
});
