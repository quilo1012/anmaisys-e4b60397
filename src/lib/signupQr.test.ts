import { describe, expect, it } from "vitest";
import { signupQrPayload } from "./signupQr";

/**
 * The QR is a way to walk to a page, and it must never become more than that.
 *
 * The whole safety of this flow rests on the code carrying nothing: scan it and you
 * reach the registration form, where the badge number, the password and the invite
 * code are still asked for, and where `employee-signin` still rate-limits. A QR that
 * carried an ask id would be a door into one specific overtime; one that carried an
 * employee id would be somebody else's identity lying on a table in a factory.
 *
 * Neither is hypothetical: both are the obvious next feature — "scan to answer
 * today's ask" — and both would quietly move authorisation into a picture anybody can
 * photograph. This test is the thing that makes that a deliberate act rather than a
 * convenient one.
 */
describe("signupQrPayload", () => {
  it("is the signup page and nothing else", () => {
    expect(signupQrPayload("https://anmaisys.lovable.app")).toBe("https://anmaisys.lovable.app/signup");
  });

  it("does not double the slash when the origin carries one", () => {
    expect(signupQrPayload("https://anmaisys.lovable.app/")).toBe("https://anmaisys.lovable.app/signup");
  });

  it("carries no query and no fragment, which is where an id would be smuggled", () => {
    const p = signupQrPayload("https://anmaisys.lovable.app");
    expect(p).not.toContain("?");
    expect(p).not.toContain("#");
  });

  it("names nobody and nothing", () => {
    const p = signupQrPayload("https://anmaisys.lovable.app").toLowerCase();
    for (const forbidden of [
      "ask", "request", "employee", "employee_ref", "shift", "department", "token", "code",
    ]) {
      expect(p).not.toContain(forbidden);
    }
  });

  it("refuses an origin that is not one, rather than building a link to nowhere", () => {
    expect(() => signupQrPayload("")).toThrow();
  });
});
