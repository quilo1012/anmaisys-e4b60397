import { describe, it, expect } from "vitest";
import { ACTIVE_ROLES, ALL_ACTIONS, can, dashboardPathFor, roleTitle } from "@/lib/permissions";

/**
 * The invite link and the badge used to make `operator` accounts, and operator logs
 * production and raises maintenance calls. `employee` is the account for somebody whose
 * only business here is answering overtime — so it holds that and nothing else, and a
 * later edit that hands it one more action fails here first.
 */
describe("employee", () => {
  it("can see and answer overtime", () => {
    expect(can("employee", "overtime.respond")).toBe(true);
  });

  it("holds nothing else", () => {
    expect(ALL_ACTIONS.filter((a) => can("employee", a))).toEqual(["overtime.respond"]);
  });

  it("cannot publish overtime asks", () => {
    expect(can("employee", "overtime.manage")).toBe(false);
  });

  it("lands on My Overtime", () => {
    expect(dashboardPathFor("employee")).toBe("/dashboard/my-overtime");
  });

  it("is offered in Create New User, under its own name", () => {
    expect(ACTIVE_ROLES).toContain("employee");
    expect(roleTitle.employee).toBe("Employee");
  });
});
