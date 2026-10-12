import { describe, it, expect } from "vitest";
import { suggestEmployeeFor, type LinkableEmployee } from "@/lib/employeeAccounts";

const emp = (over: Partial<LinkableEmployee>): LinkableEmployee => ({
  id: "x", full_name: "Someone", employee_ref: null, email: null, department: null, user_id: null, active: true, ...over,
});

describe("suggestEmployeeFor", () => {
  it("suggests the record whose email is the login's email, ignoring case", () => {
    const list = [emp({ id: "r", full_name: "Rosana Garcia Cardozo", email: "Rosana.Cardozo@x.uk" }), emp({ id: "o" })];
    expect(suggestEmployeeFor({ email: "rosana.cardozo@x.uk" }, list)?.id).toBe("r");
  });

  it("suggests the record whose badge number made the login", () => {
    const list = [emp({ id: "b", employee_ref: "E045" })];
    expect(suggestEmployeeFor({ email: "e045@employee.pmsystem.local" }, list)?.id).toBe("b");
  });

  it("suggests nothing when the record is already somebody's", () => {
    const list = [emp({ id: "r", email: "a@x.uk", user_id: "someone-else" })];
    expect(suggestEmployeeFor({ email: "a@x.uk" }, list)).toBeNull();
  });

  it("suggests nothing when two records claim the same email", () => {
    const list = [emp({ id: "1", email: "a@x.uk" }), emp({ id: "2", email: "a@x.uk" })];
    expect(suggestEmployeeFor({ email: "a@x.uk" }, list)).toBeNull();
  });

  it("never suggests by a name that looks alike", () => {
    const list = [emp({ id: "1", full_name: "Rosana Garcia Cardozo" })];
    expect(suggestEmployeeFor({ email: "rosana@gmail.com" }, list)).toBeNull();
  });

  it("ignores people who have left", () => {
    const list = [emp({ id: "1", email: "a@x.uk", active: false })];
    expect(suggestEmployeeFor({ email: "a@x.uk" }, list)).toBeNull();
  });
});
