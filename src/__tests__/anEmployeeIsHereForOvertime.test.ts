import { describe, it, expect, afterEach } from "vitest";
import {
  ACTIVE_ROLES, ALL_ACTIONS, EMPLOYEE_CEILING, can, dashboardPathFor, roleHolds, roleMayHold,
  roleTitle, setPermissionOverrides,
} from "@/lib/permissions";

/**
 * The invite link and the badge used to make `operator` accounts, and operator logs
 * production and raises maintenance calls. `employee` is the account for somebody whose
 * business here is their own overtime, their own attendance and their own conversations
 * (Messages, since 19/10: RLS shows each person only the conversations they are in) —
 * so it holds those three and nothing else, and a later edit that hands it one more
 * action fails here first.
 */
describe("employee", () => {
  afterEach(() => setPermissionOverrides({}));

  it("can see and answer overtime", () => {
    expect(can("employee", "overtime.respond")).toBe(true);
  });

  it("can see their own attendance", () => {
    expect(can("employee", "attendance.view_own")).toBe(true);
  });

  it("can open their own conversations", () => {
    expect(can("employee", "chat.dm")).toBe(true);
  });

  it("cannot create groups", () => {
    expect(can("employee", "chat.groups.manage")).toBe(false);
  });

  it("holds nothing else", () => {
    expect(ALL_ACTIONS.filter((a) => can("employee", a)).sort())
      .toEqual(["attendance.view_own", "chat.dm", "overtime.respond"]);
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

/**
 * One tick on the Permissions screen used to open the company to every badge login:
 * the grant brought back the menu row and `has_action` honoured it in the database.
 * The ceiling makes such a grant do nothing — for the employee, and only the employee.
 */
describe("the employee ceiling", () => {
  afterEach(() => setPermissionOverrides({}));

  const COMPANY_WIDE = [
    "headcount.view", "workforce.view", "workforce.manage", "attendance.manage",
    "overtime.manage", "reports.analytics", "users.view", "chat.groups.manage",
  ] as const;

  it("ignores a Permissions-screen grant of anything company-wide", () => {
    setPermissionOverrides(Object.fromEntries(COMPANY_WIDE.map((a) => [`employee:${a}`, true])));
    for (const a of COMPANY_WIDE) {
      expect(can("employee", a), a).toBe(false);
      expect(roleHolds("employee", a), a).toBe(false);
    }
  });

  it("still lets the Permissions screen take an action away", () => {
    setPermissionOverrides({ "employee:attendance.view_own": false });
    expect(can("employee", "attendance.view_own")).toBe(false);
  });

  it("is exactly the three self-service actions", () => {
    expect([...EMPLOYEE_CEILING].sort()).toEqual(["attendance.view_own", "chat.dm", "overtime.respond"]);
  });

  it("does not touch any other role's grants", () => {
    // The office admin is granted headcount on the Permissions screen in production;
    // the ceiling must leave that exactly as it was.
    setPermissionOverrides({ "production_office_admin:headcount.view": true, "manager:workforce.view": true });
    expect(can("production_office_admin", "headcount.view")).toBe(true);
    expect(can("manager", "workforce.view")).toBe(true);
    expect(roleMayHold("manager", "workforce.view")).toBe(true);
    expect(can("admin", "workforce.view")).toBe(true);
  });
});
