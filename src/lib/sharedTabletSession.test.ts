import { describe, it, expect } from "vitest";
import { isSharedTabletSession, TABLET_CRED_KEY } from "./sharedTabletSession";

const store = (value: string | null) => ({ getItem: () => value });
const throws = { getItem: () => { throw new Error("blocked"); } };

describe("isSharedTabletSession", () => {
  it("is true when a tablet signed in here", () => {
    expect(isSharedTabletSession(store(JSON.stringify({ accountId: "abc", refresh_token: "t" })))).toBe(true);
  });

  it("is false for a staff login, which clears the key", () => {
    expect(isSharedTabletSession(store(null))).toBe(false);
    expect(isSharedTabletSession(store(""))).toBe(false);
  });

  it("is still a tablet when the stored value is half-written", () => {
    // One place writes this key and two read it. A truncated value is not evidence
    // of a staff login, and treating it as one puts a personal screen on a tablet.
    expect(isSharedTabletSession(store("{not json"))).toBe(true);
  });

  it("answers false when storage cannot be read at all", () => {
    // Private mode, blocked site data. The uncertain case takes the inconvenience of
    // a tablet screen on somebody's phone, never a personal screen on a tablet.
    expect(isSharedTabletSession(throws)).toBe(false);
    expect(isSharedTabletSession(null)).toBe(false);
  });

  it("reads the key the login and the auth context already agree on", () => {
    expect(TABLET_CRED_KEY).toBe("an_tablet_cred");
  });
});
