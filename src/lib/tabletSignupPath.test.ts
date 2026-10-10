import { describe, it, expect } from "vitest";
import { tabletSignupPath } from "@/lib/signupQr";

describe("tabletSignupPath — the tablet's Create account button", () => {
  it("always says it is a tablet, so the form does not sign the tablet in as the person", () => {
    expect(tabletSignupPath(null)).toBe("/signup?tablet=1");
  });

  it("carries the code only when the caller was given one", () => {
    expect(tabletSignupPath("AN 26/x")).toBe("/signup?tablet=1&code=AN+26%2Fx");
    expect(tabletSignupPath("   ")).toBe("/signup?tablet=1");
  });
});
