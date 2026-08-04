import { describe, it, expect, beforeEach } from "vitest";

/**
 * The rules the PIN gate holds, kept honest here because the component itself is a
 * network call and a form.
 *
 * The point of the gate is not who may open Attendance and Finance Close — both are
 * already admin-only. It is the laptop left unlocked in the office, on screens that
 * name every employee beside their hours, their sickness and what they are owed.
 */
const KEY = (screen: string) => `pin-ok:${screen}`;
const isUnlocked = (screen: string) => sessionStorage.getItem(KEY(screen)) === "1";
const unlock = (screen: string) => sessionStorage.setItem(KEY(screen), "1");

describe("admin pin gate", () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

  it("starts locked", () => {
    expect(isUnlocked("attendance")).toBe(false);
    expect(isUnlocked("finance-close")).toBe(false);
  });

  it("unlocking one screen does not unlock the other", () => {
    // Separate keys on purpose: opening the hours does not open the pay run.
    unlock("attendance");
    expect(isUnlocked("attendance")).toBe(true);
    expect(isUnlocked("finance-close")).toBe(false);
  });

  it("remembers the unlock for the tab, not the machine", () => {
    // sessionStorage, not localStorage: closing the tab locks it again, which is how
    // a door behaves. A setting would survive, and that is the wrong shape for this.
    unlock("finance-close");
    expect(sessionStorage.getItem(KEY("finance-close"))).toBe("1");
    expect(localStorage.getItem(KEY("finance-close"))).toBeNull();
  });

  it("treats anything but the exact flag as locked", () => {
    sessionStorage.setItem(KEY("attendance"), "true");
    expect(isUnlocked("attendance")).toBe(false);
    sessionStorage.setItem(KEY("attendance"), "");
    expect(isUnlocked("attendance")).toBe(false);
  });
});
