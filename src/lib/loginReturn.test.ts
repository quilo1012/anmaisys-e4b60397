import { describe, expect, it } from "vitest";
import { loginPathReturningTo, safeNextPath } from "./loginReturn";

describe("safeNextPath", () => {
  it("follows a path inside the app", () => {
    expect(safeNextPath("/dashboard/my-overtime")).toBe("/dashboard/my-overtime");
    expect(safeNextPath("/dashboard/my-overtime?x=1")).toBe("/dashboard/my-overtime?x=1");
  });

  it("refuses anything that leaves the site", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "evil", "", null, undefined]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });

  it("refuses the auth pages and the root, which would only loop", () => {
    for (const loop of ["/", "/login", "/login?next=/x", "/signup", "/reset-password"]) {
      expect(safeNextPath(loop)).toBeNull();
    }
  });
});

describe("loginPathReturningTo", () => {
  it("carries the page in `next`", () => {
    expect(loginPathReturningTo("/dashboard/my-overtime")).toBe("/login?next=%2Fdashboard%2Fmy-overtime");
  });
  it("is the bare login page when there is nothing worth returning to", () => {
    expect(loginPathReturningTo("/")).toBe("/login");
  });
});
