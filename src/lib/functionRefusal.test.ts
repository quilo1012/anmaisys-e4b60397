import { describe, it, expect } from "vitest";
import { refusalMessage } from "./functionRefusal";

/**
 * `supabase.functions.invoke` only reports an `error` for HTTP 400 and up. An edge
 * function that answers 200 with `{success: false}` is, to the client, a success —
 * `onSuccess` runs, and the toast is green.
 *
 * `intouch-sync-production` does exactly that when the sync flag is off, and the flag
 * has been off since 29/07, when that write path erased an operator's production. So
 * the button in the operator's screen reported a sync that never happened, every
 * single time it was pressed.
 */
describe("refusalMessage", () => {
  it("reads the refusal the sync sends when the flag is off", () => {
    const msg = refusalMessage({
      success: false,
      skipped: true,
      reason: "intouch_current_shift_sync_disabled",
    });
    expect(msg).toBeTruthy();
    expect(msg!.toLowerCase()).toMatch(/turned off|disabled/);
  });

  it("refuses to stay quiet about a reason it does not recognise", () => {
    // The failure mode to avoid is a new refusal reason being added server-side and
    // the client going on showing green because it only knew the old one.
    const msg = refusalMessage({ success: false, reason: "some_new_guard" });
    expect(msg).toBeTruthy();
    expect(msg).toContain("some_new_guard");
  });

  it("still speaks up when the refusal carries no reason at all", () => {
    expect(refusalMessage({ success: false })).toBeTruthy();
  });

  it("lets a real success through", () => {
    expect(refusalMessage({ success: true, items: 4 })).toBeNull();
  });

  it("says nothing about bodies that do not use this convention", () => {
    // Most functions return their payload and signal failure with a status code.
    // Absence of `success` is not a refusal.
    expect(refusalMessage({ items: 4 })).toBeNull();
    expect(refusalMessage(null)).toBeNull();
    expect(refusalMessage(undefined)).toBeNull();
  });
});
