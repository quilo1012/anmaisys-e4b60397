import { describe, it, expect } from "vitest";
import { badgeRefFromEmail, isEmployeeAccount } from "./employeeAccounts";

describe("badgeRefFromEmail", () => {
  it("reads the badge number back out of the address the badge door invents", () => {
    expect(badgeRefFromEmail("e045@employee.pmsystem.local")).toBe("E045");
    expect(badgeRefFromEmail("  AB123@Employee.PMSystem.local ")).toBe("AB123");
  });

  it("leaves a real address alone", () => {
    expect(badgeRefFromEmail("rosanaquilo@icloud.com")).toBeNull();
    expect(badgeRefFromEmail("e045@employee.pmsystem.local.evil.com")).toBeNull();
    expect(badgeRefFromEmail("@employee.pmsystem.local")).toBeNull();
    expect(badgeRefFromEmail(null)).toBeNull();
  });
});

describe("isEmployeeAccount", () => {
  it("takes the employee role, whatever the login", () => {
    expect(isEmployeeAccount({ role: "employee", email: "ana@example.com" })).toBe(true);
  });

  it("takes a badge login still carrying operator, so it can be moved across", () => {
    expect(isEmployeeAccount({ role: "operator", email: "e151@employee.pmsystem.local" })).toBe(true);
  });

  it("leaves office logins and pending sign-ups on the Staff tab", () => {
    expect(isEmployeeAccount({ role: "operator", email: "line1@appliednutrition.uk" })).toBe(false);
    expect(isEmployeeAccount({ role: "admin", email: "boss@appliednutrition.uk" })).toBe(false);
    expect(isEmployeeAccount({ role: null, email: "new@example.com" })).toBe(false);
  });
});
