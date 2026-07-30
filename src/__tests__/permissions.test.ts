import { describe, it, expect } from "vitest";
import { can, dashboardPathFor, roleDashMap, type Role } from "@/lib/permissions";

describe("dashboardPathFor", () => {
  it("admin → manager dashboard", () => {
    expect(dashboardPathFor("admin")).toBe("/dashboard/manager");
  });
  it("manager → manager dashboard", () => {
    expect(dashboardPathFor("manager")).toBe("/dashboard/manager");
  });
  it("engineer → engineer dashboard", () => {
    expect(dashboardPathFor("engineer")).toBe("/dashboard/engineer");
  });
  it("operator → operator dashboard", () => {
    expect(dashboardPathFor("operator")).toBe("/dashboard/operator");
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

describe("quality verdict and closure", () => {
  // These mirror enforce_quality_validation in the database. If the two ever drift,
  // the screen offers a control the trigger refuses and the user gets a raw Postgres
  // exception — which is exactly what these tests exist to stop.
  it("lets only Quality and an admin rule on a deviation", () => {
    expect(can("quality_supervisor", "quality.validate")).toBe(true);
    expect(can("admin", "quality.validate")).toBe(true);
    for (const role of ["manager", "supervisor", "production_office_admin", "engineer", "operator"] as const) {
      expect(can(role, "quality.validate")).toBe(false);
    }
  });

  it("lets only a manager or an admin approve the closure", () => {
    for (const role of ["admin", "manager", "maintenance_manager"] as const) {
      expect(can(role, "quality.close")).toBe(true);
    }
    for (const role of ["quality_supervisor", "supervisor", "engineer", "operator"] as const) {
      expect(can(role, "quality.close")).toBe(false);
    }
  });

  it("keeps the two apart — nobody should hold both by accident", () => {
    expect(can("quality_supervisor", "quality.close")).toBe(false);
    expect(can("manager", "quality.validate")).toBe(false);
  });
});
