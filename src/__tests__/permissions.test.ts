import { describe, it, expect } from "vitest";
import { dashboardPathFor, roleDashMap, type Role } from "@/lib/permissions";

describe("dashboardPathFor", () => {
  // These assert the real landing routes in roleDashMap (single source of truth
  // used by SessionRedirect). They were stale after admin/manager were moved to
  // the Control Center and operator to My Production.
  it("admin → control center", () => {
    expect(dashboardPathFor("admin")).toBe("/dashboard/control-center");
  });
  it("manager → control center", () => {
    expect(dashboardPathFor("manager")).toBe("/dashboard/control-center");
  });
  it("engineer → engineer dashboard", () => {
    expect(dashboardPathFor("engineer")).toBe("/dashboard/engineer");
  });
  it("operator → my production", () => {
    expect(dashboardPathFor("operator")).toBe("/dashboard/operator/my-production");
  });
  it("null role → /login", () => {
    expect(dashboardPathFor(null)).toBe("/login");
  });
});

describe("roleDashMap", () => {
  it("covers all known roles with non-empty paths", () => {
    const roles: Role[] = [
      "admin",
      "manager",
      "maintenance_manager",
      "engineer",
      "operator",
      "viewer",
    ];
    for (const r of roles) {
      expect(roleDashMap[r]).toMatch(/^\/dashboard\//);
    }
    expect(Object.keys(roleDashMap).length).toBeGreaterThanOrEqual(5);
  });
});
