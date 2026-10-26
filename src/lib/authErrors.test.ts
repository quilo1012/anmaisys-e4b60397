import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BADGE_RESET_MESSAGE,
  friendlySendLinkError,
  friendlyUpdatePasswordError,
  isBadgeEmail,
  isRecoverySessionMissing,
  recoveryLinkHasError,
} from "./authErrors";

describe("authErrors", () => {
  it("recognises the address badge accounts are created with", () => {
    expect(isBadgeEmail("E045@employee.pmsystem.local")).toBe(true);
    expect(isBadgeEmail("  e045@EMPLOYEE.PMSYSTEM.LOCAL ")).toBe(true);
    expect(isBadgeEmail("ana@appliednutrition.uk")).toBe(false);
    expect(BADGE_RESET_MESSAGE).toBe("Badge accounts can't reset by email — ask your supervisor.");
  });

  it("never shows Supabase's own text for a rate limit", () => {
    const msg = friendlySendLinkError({
      status: 429,
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 53 seconds.",
    });
    expect(msg).toMatch(/too many requests/i);
    expect(msg).not.toMatch(/security purposes/i);
  });

  it("tells a network failure apart from everything else", () => {
    expect(friendlySendLinkError({ name: "AuthRetryableFetchError", message: "Failed to fetch" })).toMatch(/connection/i);
    expect(friendlySendLinkError({ message: "Something odd" })).toMatch(/couldn't send the link/i);
  });

  it("explains password refusals in plain words", () => {
    expect(friendlyUpdatePasswordError({ code: "same_password", message: "x" })).toMatch(/haven't used before/i);
    expect(friendlyUpdatePasswordError({ code: "weak_password", message: "x" })).toMatch(/too easy/i);
    expect(friendlyUpdatePasswordError({ message: "boom" })).toMatch(/couldn't update/i);
  });

  it("knows when the recovery session is gone", () => {
    expect(isRecoverySessionMissing({ name: "AuthSessionMissingError", message: "Auth session missing!" })).toBe(true);
    expect(isRecoverySessionMissing({ message: "weak" })).toBe(false);
  });

  it("finds the reason Supabase puts in a dead link, in the query or the hash", () => {
    expect(recoveryLinkHasError("?error=access_denied&error_code=otp_expired", "")).toBe(true);
    expect(recoveryLinkHasError("", "#error=access_denied&error_code=otp_expired")).toBe(true);
    expect(recoveryLinkHasError("?code=abc", "")).toBe(false);
    expect(recoveryLinkHasError("", "#access_token=x&type=recovery")).toBe(false);
  });
});

/**
 * Login is read as text, like loginFailure.test.ts does: mounting it brings supabase,
 * the router and the tablets along, and what needs guarding here is a handful of lines.
 */
describe("Login: one error in one place, and a field that suits a phone", () => {
  const fonte = readFileSync(resolve(__dirname, "../pages/Login.tsx"), "utf8");

  it("shows failures in the form only, not again in a toast", () => {
    expect(fonte).not.toMatch(/toast\(\{[^}]*variant:\s*"destructive"/);
  });

  it("does not put the raw Supabase reason on the screen", () => {
    expect(fonte).not.toMatch(/:\s*reason;/);
  });

  it("turns off capitalisation and autocorrect on the identifier", () => {
    const inicio = fonte.indexOf('id="identifier"');
    expect(inicio).toBeGreaterThan(-1);
    // The input's props, up to the end of the tag ("/>").
    const campo = fonte.slice(inicio, fonte.indexOf("/>", inicio));
    expect(campo).toContain('autoCapitalize="none"');
    expect(campo).toContain('autoCorrect="off"');
  });

  it("hands what was typed to the reset page in router state, not the address", () => {
    expect(fonte).toContain('navigate("/reset-password", { state: { identifier: identifier.trim() } })');
    expect(fonte).not.toMatch(/reset-password\?/);
  });
});
