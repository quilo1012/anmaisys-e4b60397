import { describe, expect, it } from "vitest";
import { isRootAccount, ROOT_EMAIL } from "./rootAccount";

describe("who is told about Root Diagnostics", () => {
  it("the root login, as admin, whatever the case of the email", () => {
    expect(isRootAccount("admin", ROOT_EMAIL)).toBe(true);
    expect(isRootAccount("admin", ` ${ROOT_EMAIL.toUpperCase()} `)).toBe(true);
  });

  it("not another admin", () => {
    expect(isRootAccount("admin", "someone.else@appliednutrition.uk")).toBe(false);
  });

  it("not the root email under another role, nor a login with no email", () => {
    expect(isRootAccount("manager", ROOT_EMAIL)).toBe(false);
    expect(isRootAccount("admin", null)).toBe(false);
    expect(isRootAccount(null, ROOT_EMAIL)).toBe(false);
  });
});
