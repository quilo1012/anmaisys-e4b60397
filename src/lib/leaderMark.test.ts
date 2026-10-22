import { describe, expect, it } from "vitest";
import { claimsLeadership, isTeamLeader } from "./leaderMark";

describe("isTeamLeader", () => {
  it("reads the job off position, where #393 put it", () => {
    // Everton Eduardo: position Team Leader, department Production.
    expect(isTeamLeader({ position: "Team Leader", department: "Production" })).toBe(true);
  });
  it("falls back to department for a record with no position", () => {
    expect(isTeamLeader({ position: null, department: "Team Leader" })).toBe(true);
  });
  it("does not make a supervisor or an operative a line leader", () => {
    expect(isTeamLeader({ position: "Supervisor", department: "Production" })).toBe(false);
    expect(isTeamLeader({ position: "Production Operative", department: "Production" })).toBe(false);
    expect(isTeamLeader(null)).toBe(false);
  });
});

describe("claimsLeadership", () => {
  const base = { teamLeader: true, areaId: "l1", status: "assigned" as const, columnTaken: false };
  it("a Team Leader on a line nobody leads takes it", () => {
    expect(claimsLeadership(base)).toBe(true);
  });
  it("on overtime too", () => {
    expect(claimsLeadership({ ...base, status: "overtime" })).toBe(true);
  });
  it("not a line somebody already leads", () => {
    expect(claimsLeadership({ ...base, columnTaken: true })).toBe(false);
  });
  it("not without a line, nor when away", () => {
    expect(claimsLeadership({ ...base, areaId: null })).toBe(false);
    expect(claimsLeadership({ ...base, status: "holiday" })).toBe(false);
  });
  it("not somebody who is not a Team Leader", () => {
    expect(claimsLeadership({ ...base, teamLeader: false })).toBe(false);
  });
});

import { lineLeadersByArea } from "./leaderMark";
describe("lineLeadersByArea", () => {
  const day = { onDate: "2026-10-22", shift: "Day" };
  const row = (o: Record<string, unknown>) => ({ employee_id: "e1", area_id: "l1", status: "assigned", on_date: "2026-10-22", shift: "Day", is_leader: false, ...o }) as any;
  it("a Team Leader not designated shows no LEAD", () => {
    expect(lineLeadersByArea([row({ is_leader: false })], day).size).toBe(0);
  });
  it("a designated leader shows LEAD on the correct line and shift", () => {
    const m = lineLeadersByArea([row({ is_leader: true }), row({ employee_id: "e2", area_id: "l2" })], day);
    expect(m.get("l1")).toEqual({ leaderIds: ["e1"], conflict: false });
    expect(m.has("l2")).toBe(false);
  });
  it("Day and Night are independent", () => {
    const rows = [row({ is_leader: true }), row({ employee_id: "e2", shift: "Night", is_leader: true })];
    expect(lineLeadersByArea(rows, day).get("l1")?.leaderIds).toEqual(["e1"]);
    expect(lineLeadersByArea(rows, { ...day, shift: "Night" }).get("l1")?.leaderIds).toEqual(["e2"]);
  });
  it("no designation means no LEAD", () => {
    expect(lineLeadersByArea([row({}), row({ employee_id: "e2" })], day).get("l1")).toBeUndefined();
  });
  it("two designations on one line and shift are a conflict", () => {
    const m = lineLeadersByArea([row({ is_leader: true }), row({ employee_id: "e2", is_leader: true })], day);
    expect(m.get("l1")).toEqual({ leaderIds: ["e1", "e2"], conflict: true });
  });
});
