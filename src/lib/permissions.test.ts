import { describe, it, expect, afterEach } from "vitest";
import {
  can, canAny, canAll, canPrintReport, canForDevice, setPermissionOverrides,
  type Role, type Action,
} from "./permissions";

const ROLES: Role[] = ["admin", "manager", "supervisor", "quality_supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"];

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
  "stock.manage": ["admin", "manager", "supervisor", "maintenance_manager"],
  "stock.pricing": ["admin"],
  "users.view": ["admin", "manager"],
  "users.manage": ["admin", "manager"],
  "audit.view": ["admin", "manager", "supervisor"],
  "reports.analytics": ["admin", "manager", "supervisor"],
  "system.clear": ["admin"],
  "system.settings": ["admin"],
  "production.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"],
  "production.manage": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "production.target.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "production.target.manage": ["admin", "manager", "supervisor", "planner"],
  "production.performance.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "operator"],
  "planner.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "sku.view": ["admin", "production_office_admin"],
  "sku.manage": ["admin", "manager", "supervisor", "planner"],
  "rag.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "rag.manage": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "rag.comment": ["admin", "manager", "supervisor"],
  "scorecard.fill": ["admin", "manager", "quality_supervisor", "production_office_admin"],
  "scorecard.approve": ["admin", "manager", "quality_supervisor"],
  "smarttarget.view": ["admin", "production_office_admin"],
  "quality.view": ["admin", "manager", "supervisor", "quality_supervisor", "engineer", "co_engineer"],
  "quality.manage": ["admin", "manager", "supervisor", "quality_supervisor"],
  "quality.validate": ["admin", "quality_supervisor"],
  "quality.close": ["admin", "manager", "maintenance_manager"],
  "pm.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "pm.manage": ["admin", "manager", "maintenance_manager"],
  "engineers.view": ["admin", "manager", "supervisor", "maintenance_manager"],
  "engineers.manage": ["admin", "manager", "maintenance_manager"],
  "leaders.view": ["admin", "manager", "supervisor"],
  "leaders.manage": ["admin", "manager"],
  "chat.line": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "quality_supervisor"],
  "headcount.view": ["admin"],
  "headcount.manage": ["admin"],
  "attendance.manage": ["admin", "manager", "supervisor", "planner"],
  "downtime.adjust": ["admin", "manager", "supervisor", "maintenance_manager", "engineer", "co_engineer"],
  "downtime.correct": ["admin", "maintenance_manager"],
  "reports.export": ["admin", "manager", "supervisor", "planner"],
  "chat.dm": ["admin", "manager", "supervisor", "operator"],
  "notifications.view": ["admin", "manager", "supervisor", "quality_supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer"],
  "notifications.manage": ["admin", "manager"],
  "intouch.view": ["admin", "manager", "maintenance_manager", "planner"],
  "intouch.manage": ["admin", "maintenance_manager"],
  "controlcenter.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "assets.manage": ["admin", "manager", "maintenance_manager"],
  "dashboard.executive": ["admin", "manager"],
  "dashboard.manager": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "viewer"],
  "dashboard.engineer": ["admin", "manager", "supervisor", "maintenance_manager", "planner", "engineer", "co_engineer"],
  "dashboard.operator": ["admin", "manager", "maintenance_manager", "engineer", "co_engineer", "operator"],
  "reliability.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "suppliers.view": ["admin", "manager", "supervisor", "maintenance_manager", "planner"],
  "permissions.manage": ["admin"],
  "workforce.view": ["admin"],
  "workforce.manage": ["admin"],
  // The five screens that used to be gated by `allowedRoles` alone, now actions the
  // matrix owns. system.hub is admin only by decision — a manager keeps Users and
  // nothing else behind that door.
  "system.hub": ["admin"],
  "system.diagnostics": ["admin"],
  "system.shiftpasswords": ["admin"],
  "chat.settings": ["admin", "manager"],
  "dashboard.warehouse": ["admin"],
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

/**
 * The print gate on the Analytics report.
 *
 * It read `role !== "admin" && (role !== "manager" && role !== "maintenance_manager")`
 * — a fourth authorization model written by hand beside the matrix, and it disagreed
 * with it in both directions: a supervisor who holds `reports.export` was refused with
 * "You don't have permission", and a maintenance_manager who holds neither
 * `reports.export` nor `reports.analytics` was waved through by a branch he can never
 * reach, because the page will not open for him.
 */
describe("canPrintReport", () => {
  it("lets through exactly the roles the matrix grants reports.export to", () => {
    for (const role of ["admin", "manager", "supervisor", "planner"] as const) {
      expect(canPrintReport(role)).toBe(true);
    }
  });

  it("refuses the supervisor's old refusal — he holds the permission", () => {
    expect(canPrintReport("supervisor")).toBe(true);
  });

  it("no longer waves through maintenance_manager, who cannot even open the page", () => {
    expect(canPrintReport("maintenance_manager")).toBe(false);
    expect(can("maintenance_manager", "reports.analytics")).toBe(false);
  });

  it("refuses a role that can read the report but was never granted the export", () => {
    // production_office_admin opens Analytics and does not export it.
    expect(can("production_office_admin", "reports.analytics")).toBe(true);
    expect(canPrintReport("production_office_admin")).toBe(false);
  });

  it("refuses when there is no role at all", () => {
    expect(canPrintReport(null)).toBe(false);
    expect(canPrintReport(undefined)).toBe(false);
  });
});

/**
 * The lock the admin could close on themselves.
 *
 * `ProtectedRoute` writes the rule down in its own comment — "admin always passes (no
 * self-lockout)" — and implements it, so a route never turns an admin away. `can()`
 * did not implement it, and `can()` is what the navigation reads.
 *
 * The Permissions Matrix guards on WHO is editing (`if (!isAdmin) return`) and not on
 * WHICH role is being edited, and it draws a cell for every role in `ALL_ROLES`. So an
 * admin can click their own `reports.analytics` off, save it into
 * `role_permission_overrides`, and the sidebar — which filters on
 * `canForDevice(role, item.action, device)` — drops Reports out of their menu. The
 * screen stays reachable by typing the URL, because the route still waves the admin
 * through. The promise held in one layer and broke in the one above it, which is the
 * worst of both: the entry disappears and nothing explains why.
 *
 * So the rule moves down to `can()`, where the rest of the app reads it. Overrides go
 * on working for every other role, in both directions — taking away and granting — and
 * per-device visibility is untouched: hiding Reports on the tablet is a decision about
 * a small screen, not a lock, and desktop still shows everything the role can reach.
 */
describe("no self-lockout", () => {
  afterEach(() => setPermissionOverrides({}));

  it("keeps the admin's access when an override tries to take it away", () => {
    setPermissionOverrides({ "admin:reports.analytics": false });
    expect(can("admin", "reports.analytics")).toBe(true);
  });

  it("keeps it in the navigation too, which is where the entry went missing", () => {
    setPermissionOverrides({ "admin:reports.analytics": false });
    expect(canForDevice("admin", "reports.analytics", "desktop")).toBe(true);
  });

  it("holds for every action, not just the one that was reported", () => {
    setPermissionOverrides({ "admin:wo.view": false, "admin:quality.view": false });
    expect(can("admin", "wo.view")).toBe(true);
    expect(can("admin", "quality.view")).toBe(true);
  });

  it("still lets an override take an action away from any other role", () => {
    setPermissionOverrides({ "supervisor:reports.analytics": false });
    expect(can("supervisor", "reports.analytics")).toBe(false);
  });

  it("still lets an override grant an action a role does not have by default", () => {
    expect(can("operator", "reports.analytics")).toBe(false);
    setPermissionOverrides({ "operator:reports.analytics": true });
    expect(can("operator", "reports.analytics")).toBe(true);
  });
});

describe("scorecard actions", () => {
  it("lets the roles that run the weekly review fill a week", () => {
    expect(can("manager", "scorecard.fill")).toBe(true);
    expect(can("quality_supervisor", "scorecard.fill")).toBe(true);
    expect(can("production_office_admin", "scorecard.fill")).toBe(true);
  });

  it("keeps approval narrower than filling", () => {
    // Quem preenche nao aprova por inerencia: aprovar um Fail e um acto de gestao.
    expect(can("production_office_admin", "scorecard.approve")).toBe(false);
    expect(can("manager", "scorecard.approve")).toBe(true);
  });

  it("keeps operators out of both", () => {
    expect(can("operator", "scorecard.fill")).toBe(false);
    expect(can("operator", "scorecard.approve")).toBe(false);
  });
});
