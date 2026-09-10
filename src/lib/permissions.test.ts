import { describe, it, expect, afterEach } from "vitest";
import {
  can, canAny, canAll, canPrintReport, canForDevice, setPermissionOverrides, setIsOwner,
  type Role, type Action,
} from "./permissions";

// Every value of the enum, retired ones included: `supervisor`, `planner`, `viewer`
// and `co_engineer` are asserted to hold nothing at all, which is the whole point of
// retiring them in the matrix rather than deleting them from the enum.
const ROLES: Role[] = ["admin", "manager", "supervisor", "quality_supervisor", "maintenance_manager", "planner", "engineer", "co_engineer", "operator", "viewer", "warehouse", "production_office_admin"];

// Expected MATRIX — kept in sync manually with permissions.ts. If someone
// edits permissions.ts without updating this table, the diff fails loudly.
const EXPECTED: Record<Action, Role[]> = {
  "wo.view": ["admin", "manager", "maintenance_manager", "engineer", "operator", "warehouse", "production_office_admin"],
  "wo.create": ["admin", "manager", "maintenance_manager", "operator", "warehouse", "production_office_admin"],
  "wo.update": ["admin", "manager", "maintenance_manager", "engineer", "production_office_admin"],
  "wo.delete": ["admin"],
  "wo.close": ["admin", "manager", "engineer", "production_office_admin"],
  "wo.force": ["admin", "maintenance_manager"],
  "wo.print": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "downtime.view": ["admin", "manager", "maintenance_manager", "engineer", "operator", "production_office_admin"],
  "downtime.manage": ["admin", "manager", "engineer", "production_office_admin"],
  "machines.view": ["admin", "manager", "maintenance_manager", "engineer", "operator", "warehouse", "production_office_admin"],
  "machines.manage": ["admin", "manager", "production_office_admin"],
  "problems.view": ["admin", "manager", "maintenance_manager", "engineer", "operator", "production_office_admin"],
  "problems.manage": ["admin", "manager", "production_office_admin"],
  "stock.view": ["admin", "manager", "maintenance_manager", "engineer", "warehouse", "production_office_admin"],
  "stock.manage": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "stock.pricing": ["admin"],
  "users.view": ["admin", "manager"],
  "users.manage": ["admin", "manager"],
  "audit.view": ["admin", "manager"],
  "reports.analytics": ["admin", "manager", "production_office_admin"],
  "system.clear": ["admin"],
  "system.settings": ["admin"],
  "system.hub": ["admin"],
  "system.diagnostics": ["admin"],
  "system.shiftpasswords": ["admin"],
  "production.view": ["admin", "manager", "maintenance_manager", "engineer", "operator", "production_office_admin"],
  "production.manage": ["admin", "manager", "maintenance_manager", "operator", "production_office_admin"],
  "production.target.view": ["admin", "manager", "maintenance_manager", "operator", "production_office_admin"],
  "production.target.manage": ["admin", "manager", "production_office_admin"],
  "production.performance.view": ["admin", "manager", "maintenance_manager", "operator", "quality_supervisor", "production_office_admin"],
  "planner.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "sku.view": ["admin", "production_office_admin"],
  "sku.manage": ["admin", "manager", "production_office_admin"],
  "rag.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "rag.manage": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "rag.comment": ["admin", "manager", "production_office_admin"],
  "scorecard.fill": ["admin", "manager", "quality_supervisor", "production_office_admin"],
  "scorecard.approve": ["admin", "manager", "quality_supervisor"],
  "smarttarget.view": ["admin", "production_office_admin"],
  "quality.view": ["admin", "manager", "engineer", "quality_supervisor", "production_office_admin"],
  "quality.manage": ["admin", "manager", "quality_supervisor", "production_office_admin"],
  "workforce.view": ["admin"],
  "workforce.manage": ["admin"],
  "quality.validate": ["admin", "quality_supervisor"],
  "quality.close": ["admin", "manager", "maintenance_manager"],
  "headcount.view": ["admin"],
  "headcount.manage": ["admin"],
  "attendance.manage": ["admin", "manager"],
  "downtime.adjust": ["admin", "manager", "maintenance_manager", "engineer"],
  "downtime.correct": ["admin", "maintenance_manager"],
  "reports.export": ["admin", "manager", "production_office_admin"],
  "pm.view": ["admin", "manager", "maintenance_manager", "engineer", "production_office_admin"],
  "pm.manage": ["admin", "manager", "maintenance_manager", "engineer", "production_office_admin"],
  "engineers.view": ["admin", "manager", "maintenance_manager"],
  "engineers.manage": ["admin", "manager", "maintenance_manager"],
  "leaders.view": ["admin", "manager", "production_office_admin"],
  "leaders.manage": ["admin", "manager", "production_office_admin"],
  "chat.line": ["admin", "manager", "maintenance_manager", "engineer", "operator", "warehouse", "quality_supervisor", "production_office_admin"],
  "chat.dm": ["admin", "manager", "operator"],
  "chat.settings": ["admin", "manager"],
  "notifications.view": ["admin", "manager", "maintenance_manager", "engineer", "operator", "quality_supervisor", "production_office_admin"],
  "notifications.manage": ["admin", "manager"],
  "intouch.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "intouch.manage": ["admin", "maintenance_manager"],
  "controlcenter.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "assets.manage": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "dashboard.executive": ["admin", "manager"],
  "dashboard.manager": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "dashboard.engineer": ["admin", "manager", "maintenance_manager", "engineer"],
  "dashboard.operator": ["admin", "manager", "maintenance_manager", "engineer", "operator"],
  "dashboard.warehouse": ["admin", "warehouse"],
  "reliability.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
  "suppliers.view": ["admin", "manager", "maintenance_manager", "production_office_admin"],
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
    for (const role of ["admin", "manager", "production_office_admin"] as const) {
      expect(canPrintReport(role)).toBe(true);
    }
  });

  it("gives the production office the export, because they build the boards", () => {
    // Six accounts move from admin to production_office_admin. Without this the day
    // the change lands is the day they lose the CSV/Excel/PDF they produce today.
    expect(can("production_office_admin", "reports.analytics")).toBe(true);
    expect(canPrintReport("production_office_admin")).toBe(true);
  });

  it("no longer waves through maintenance_manager, who cannot even open the page", () => {
    expect(canPrintReport("maintenance_manager")).toBe(false);
    expect(can("maintenance_manager", "reports.analytics")).toBe(false);
  });

  it("refuses a retired profile that used to hold the export", () => {
    // supervisor and planner both held reports.export; both are retired and hold nothing.
    expect(canPrintReport("supervisor")).toBe(false);
    expect(canPrintReport("planner")).toBe(false);
  });

  it("refuses when there is no role at all", () => {
    expect(canPrintReport(null)).toBe(false);
    expect(canPrintReport(undefined)).toBe(false);
  });
});

/**
 * Who holds the key when a permission is taken away.
 *
 * The admin role used to pass every check unconditionally, which made the Permissions
 * Matrix lie: it drew an editable cell for admin, saved the override, and then `can()`
 * ignored it. The rule now sits on an ACCOUNT instead of a role — whoever is in
 * `public.app_owner` passes everything, and that is the only break-glass left. The
 * admin role is resolved by the matrix and its overrides like any other, so what the
 * Permissions page shows is what an admin actually reaches.
 *
 * Per-device visibility is untouched: hiding Reports on the tablet is a decision about
 * a small screen, not a lock, and desktop still shows everything the role can reach.
 */
describe("the owner is the only account that always passes", () => {
  afterEach(() => { setPermissionOverrides({}); setIsOwner(false); });

  it("lets the owner through an action their role does not have", () => {
    expect(can("operator", "system.clear")).toBe(false);
    setIsOwner(true);
    expect(can("operator", "system.clear")).toBe(true);
  });

  it("lets the owner through even before the role has resolved", () => {
    setIsOwner(true);
    expect(can(null, "system.hub")).toBe(true);
  });

  it("carries into the navigation, so nothing can hide a screen from the owner", () => {
    setPermissionOverrides({ "admin:reports.analytics": false });
    setIsOwner(true);
    expect(canForDevice("admin", "reports.analytics", "desktop")).toBe(true);
  });

  it("no longer waves the admin role through an override that denies it", () => {
    setPermissionOverrides({ "admin:reports.analytics": false });
    expect(can("admin", "reports.analytics")).toBe(false);
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

describe("preventive maintenance planning for the engineer", () => {
  it("lets an engineer write a PM plan, not just read one", () => {
    // O engineer ja via os planos; quem os cria e quem os corrige e ele.
    expect(can("engineer", "pm.view")).toBe(true);
    expect(can("engineer", "pm.manage")).toBe(true);
    // co_engineer is a retired value and holds nothing; ProtectedRoute reads it as
    // engineer before it asks the matrix, so an account still carrying it still plans.
    expect(can("co_engineer", "pm.manage")).toBe(false);
  });

  it("keeps the shop floor out of PM planning", () => {
    expect(can("operator", "pm.manage")).toBe(false);
    expect(can("viewer", "pm.manage")).toBe(false);
  });
});
