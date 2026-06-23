import { describe, it, expect } from "vitest";
import { can, canAny, canAll, type Role, type Action } from "./permissions";

const ROLES: Role[] = ["admin", "manager", "engineer", "operator", "viewer"];

// Expected MATRIX — kept in sync manually with permissions.ts. If someone
// edits permissions.ts without updating this table, the diff fails loudly.
const EXPECTED: Record<Action, Role[]> = {
  "wo.view": ["admin", "manager", "engineer", "operator", "viewer"],
  "wo.create": ["admin", "manager", "operator"],
  "wo.update": ["admin", "manager", "engineer"],
  "wo.delete": ["admin"],
  "wo.close": ["admin", "manager", "engineer"],
  "wo.force": ["admin"],
  "wo.print": ["admin", "manager"],
  "downtime.view": ["admin", "manager", "engineer", "operator", "viewer"],
  "downtime.manage": ["admin", "manager", "engineer"],
  "machines.view": ["admin", "manager", "engineer", "operator", "viewer"],
  "machines.manage": ["admin", "manager"],
  "problems.view": ["admin", "manager", "engineer", "operator", "viewer"],
  "problems.manage": ["admin", "manager"],
  "stock.view": ["admin", "manager", "engineer"],
  "stock.manage": ["admin", "manager"],
  "stock.pricing": ["admin"],
  "users.view": ["admin", "manager"],
  "users.manage": ["admin", "manager"],
  "audit.view": ["admin", "manager"],
  "reports.analytics": ["admin", "manager"],
  "reports.financial": ["admin"],
  "reports.executive": ["admin"],
  "system.clear": ["admin"],
  "system.settings": ["admin"],
};

describe("permissions.can — full role × action matrix", () => {
  for (const action of Object.keys(EXPECTED) as Action[]) {
    for (const role of ROLES) {
      const expected = EXPECTED[action].includes(role);
      it(`${role} ${expected ? "CAN" : "cannot"} ${action}`, () => {
        expect(can(role, action)).toBe(expected);
      });
    }
  }
});

describe("permissions.can — null / undefined role", () => {
  it("returns false for null role", () => {
    expect(can(null, "wo.view")).toBe(false);
  });
  it("returns false for undefined role", () => {
    expect(can(undefined, "wo.view")).toBe(false);
  });
});

describe("permissions.canAny", () => {
  it("returns true when at least one action is allowed", () => {
    expect(canAny("engineer", ["wo.delete", "wo.view"])).toBe(true);
  });
  it("returns false when no action is allowed", () => {
    expect(canAny("operator", ["wo.delete", "wo.force"])).toBe(false);
  });
  it("returns false for null role", () => {
    expect(canAny(null, ["wo.view"])).toBe(false);
  });
});

describe("permissions.canAll", () => {
  it("returns true when every action is allowed", () => {
    expect(canAll("admin", ["wo.delete", "wo.force", "system.clear"])).toBe(true);
  });
  it("returns false when at least one action is denied", () => {
    expect(canAll("manager", ["wo.delete", "wo.view"])).toBe(false);
  });
  it("returns true for empty action list (vacuously true)", () => {
    expect(canAll("operator", [])).toBe(true);
  });
});
