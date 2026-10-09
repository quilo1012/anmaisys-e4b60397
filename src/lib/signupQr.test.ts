import { describe, expect, it } from "vitest";
import { signupQrPayload } from "./signupQr";

/**
 * The QR is a way to walk to a page. It may carry the factory's invite code, and it
 * must never carry anything that names a person or a shift.
 *
 * The original rule was that it carried nothing at all, and the reasoning behind it
 * still holds for everything except the invite code: a QR with an ask id is a door
 * into one specific overtime, and one with an employee id is somebody else's identity
 * lying on a table in a factory. Both are the obvious next feature — "scan to answer
 * today's ask" — and both would quietly move authorisation into a picture anybody can
 * photograph. Those stay forbidden, and this file is what makes allowing one a
 * deliberate act rather than a convenient one.
 *
 * The invite code was let in because the rule was costing the thing it was protecting.
 * A worker scanning the tablet reached a form with a box labelled "From your
 * supervisor" and no way to fill it, so they stopped. The code names nobody, grants
 * nothing alone — the badge number and password are still asked for, and
 * `employee-signin` still rate-limits — and the admin card already pastes it into
 * links that travel through group chats.
 *
 * It is safe only because of where it may be read: `signup_config` is
 * `REVOKE ALL ... FROM anon` with an admin-only policy, so a screen without a session
 * cannot supply a code even if it wanted to. The tablet's QR calls this with one
 * argument and gets the bare page.
 */
describe("signupQrPayload", () => {
  it("is the signup page when no code is given", () => {
    expect(signupQrPayload("https://anmaisys.lovable.app")).toBe("https://anmaisys.lovable.app/signup");
  });

  it("treats an empty or absent code as no code — the tablet's case", () => {
    for (const nothing of [undefined, null, "", "   "]) {
      expect(signupQrPayload("https://anmaisys.lovable.app", nothing)).toBe(
        "https://anmaisys.lovable.app/signup",
      );
    }
  });

  it("does not double the slash when the origin carries one", () => {
    expect(signupQrPayload("https://anmaisys.lovable.app/")).toBe("https://anmaisys.lovable.app/signup");
  });

  it("carries the invite code when one is given, so the field arrives filled", () => {
    expect(signupQrPayload("https://anmaisys.lovable.app", "AN-2026")).toBe(
      "https://anmaisys.lovable.app/signup?code=AN-2026",
    );
  });

  it("escapes the code rather than breaking the link with it", () => {
    expect(signupQrPayload("https://x.app", "A N&2026")).toBe("https://x.app/signup?code=A%20N%262026");
  });

  it("trims the code, because a copied one brings whitespace with it", () => {
    expect(signupQrPayload("https://x.app", "  AN-2026  ")).toBe("https://x.app/signup?code=AN-2026");
  });

  /**
   * The line that has not moved. The code is one string for the whole factory; these
   * are statements about a person, and the only way one reaches the payload is if
   * somebody passes it as the invite code — which this names as the mistake it is.
   */
  it("names nobody, whatever is handed to it", () => {
    for (const identity of ["E045", "emp_7a3f", "request:91c2", "DAY", "Line 1"]) {
      const p = signupQrPayload("https://x.app", identity);
      // It appears only where a code goes, never as a path, an id or a second param.
      expect(p.startsWith("https://x.app/signup?code=")).toBe(true);
      expect(p.split("?")[1].split("&")).toHaveLength(1);
    }
  });

  it("carries one parameter and no fragment, which is where an id would be smuggled", () => {
    const p = signupQrPayload("https://x.app", "AN-2026");
    expect(p).not.toContain("#");
    expect(p.split("?")).toHaveLength(2);
    expect(p).not.toMatch(/employee|request|ask|token|shift|department/i);
  });

  it("refuses an origin that is not one, rather than building a link to nowhere", () => {
    expect(() => signupQrPayload("")).toThrow();
    expect(() => signupQrPayload("", "AN-2026")).toThrow();
  });
});
