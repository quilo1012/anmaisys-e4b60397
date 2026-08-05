import { describe, it, expect, beforeEach } from "vitest";
import { shouldRelock } from "@/lib/adminPinGate";

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
    expect(isUnlocked("workforce")).toBe(false);
  });

  it("opens the whole workforce section at once", () => {
    // One key for the four tabs. They are one screen seen four ways, and asking again
    // on every tab is the friction that makes somebody prop the door open — a PIN
    // typed four times an hour stops being a lock and becomes a habit.
    unlock("workforce");
    expect(isUnlocked("workforce")).toBe(true);
  });

  it("keeps sections that are not tabs of each other apart", () => {
    unlock("workforce");
    expect(isUnlocked("some-other-screen")).toBe(false);
  });

  it("remembers the unlock for the tab, not the machine", () => {
    // sessionStorage, not localStorage: closing the tab locks it again, which is how
    // a door behaves. A setting would survive, and that is the wrong shape for this.
    unlock("workforce");
    expect(sessionStorage.getItem(KEY("workforce"))).toBe("1");
    expect(localStorage.getItem(KEY("workforce"))).toBeNull();
  });

  it("treats anything but the exact flag as locked", () => {
    sessionStorage.setItem(KEY("workforce"), "true");
    expect(isUnlocked("workforce")).toBe(false);
    sessionStorage.setItem(KEY("workforce"), "");
    expect(isUnlocked("workforce")).toBe(false);
  });
});

describe("locking behind you", () => {
  // The unlock used to last until the tab closed, which meant somebody unlocked the
  // board in the morning and walked back in at four without being asked.
  it("stays open while you move between the section's own tabs", () => {
    for (const p of ["/dashboard/headcount", "/dashboard/people", "/dashboard/leave",
                     "/dashboard/attendance", "/dashboard/finance-close"]) {
      expect(shouldRelock("workforce", p)).toBe(false);
    }
  });

  it("locks the moment you go anywhere else", () => {
    expect(shouldRelock("workforce", "/dashboard/work-orders")).toBe(true);
    expect(shouldRelock("workforce", "/dashboard")).toBe(true);
    expect(shouldRelock("workforce", "/users/manage")).toBe(true);
  });

  it("counts a record opened from inside the section as still inside it", () => {
    // Exact matching would lock the section every time somebody opened a row and
    // came back, which is the friction this is trying not to create.
    expect(shouldRelock("workforce", "/dashboard/leave/abc-123")).toBe(false);
  });

  it("is not fooled by a path that merely starts with the same letters", () => {
    expect(shouldRelock("workforce", "/dashboard/headcount-report")).toBe(true);
  });

  it("locks on any move for a section nobody has grouped", () => {
    // The safe default: a screen with no sibling tabs listed has no tab changes to
    // forgive, so every navigation away from it closes the door.
    expect(shouldRelock("something-new", "/dashboard/something-new")).toBe(true);
  });

  it("treats a destination it cannot read as leaving", () => {
    // A lock that stays open because it could not tell where you went is the failure
    // worth avoiding.
    expect(shouldRelock("workforce", null)).toBe(true);
    expect(shouldRelock("workforce", "")).toBe(true);
  });
});
