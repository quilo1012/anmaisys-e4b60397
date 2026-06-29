import { describe, it, expect } from "vitest";
import { dashboardPathFor, roleDashMap, type Role } from "@/lib/permissions";

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
