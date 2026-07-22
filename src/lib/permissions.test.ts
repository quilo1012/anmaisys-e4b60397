import { describe, it, expect } from "vitest";
import { can, canAny, canAll, type Role, type Action } from "./permissions";

const ROLES: Role[] = ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"];

// Expected MATRIX — kept in sync manually with permissions.ts. If someone
// edits permissions.ts without updating this table, the diff fails loudly.
const EXPECTED: Record<Action, Role[]> = {
  "wo.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"],
  "wo.create": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "wo.update": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "wo.delete": ["admin"],
  "wo.close": ["admin", "manager", "supervisor", "engineer", "co_engineer"],
  "wo.force": ["admin"],
  "wo.print": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "downtime.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"],
  "downtime.manage": ["admin", "manager", "supervisor", "engineer", "co_engineer"],
  "machines.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"],
  "machines.manage": ["admin", "manager", "supervisor"],
  "problems.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"],
  "problems.manage": ["admin", "manager", "supervisor"],
  "stock.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "stock.manage": ["admin", "manager", "supervisor"],
  "stock.pricing": ["admin"],
  "users.view": ["admin", "manager"],
  "users.manage": ["admin", "manager"],
  "audit.view": ["admin", "manager", "supervisor"],
  "reports.analytics": ["admin", "manager", "supervisor"],
  "reports.financial": ["admin"],
  "reports.executive": ["admin"],
  "system.clear": ["admin"],
  "system.settings": ["admin"],
  "production.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"],
  "production.manage": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "production.target.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "production.target.manage": ["admin", "manager", "supervisor", "planner"],
  "production.performance.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "planner.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "planner.manage": ["admin", "manager", "planner"],
  "sku.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "sku.manage": ["admin", "manager", "planner"],
  "rag.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "rag.manage": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "rag.comment": ["admin", "manager", "supervisor", "planner"],
  "smarttarget.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "quality.view": ["admin", "manager", "supervisor", "engineer", "co_engineer"],
  "quality.manage": ["admin", "manager", "supervisor"],
  "pm.view": ["admin", "manager", "supervisor", "maintenance_manager", "engineer", "co_engineer"],
  "pm.manage": ["admin", "manager", "maintenance_manager"],
  "engineers.view": ["admin", "manager", "supervisor", "maintenance_manager"],
  "engineers.manage": ["admin", "manager", "maintenance_manager"],
  "leaders.view": ["admin", "manager", "supervisor"],
  "leaders.manage": ["admin", "manager"],
  // Chat is intentionally disabled app-wide (see "Desabilitou opção de chat");
  // both matrix rows are empty, so no role passes.
  "chat.line": [],
  "chat.dm": [],
  "notifications.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"],
  "notifications.manage": ["admin", "manager"],
  "intouch.view": ["admin", "manager", "maintenance_manager", "planner"],
  "intouch.manage": ["admin", "maintenance_manager"],
  "controlcenter.view": ["admin", "manager", "supervisor", "maintenance_manager"],
  "assets.manage": ["admin", "manager", "maintenance_manager"],
  "dashboard.executive": ["admin", "manager"],
  "dashboard.manager": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "viewer"],
  "dashboard.engineer": ["admin", "engineer", "co_engineer"],
  "dashboard.operator": ["admin", "operator"],
  "permissions.manage": ["admin"],
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
