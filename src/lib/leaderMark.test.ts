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
