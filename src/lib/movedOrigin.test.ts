import { describe, expect, it } from "vitest";
import { arrivedFromSupersededOrigin, movedOriginNotice, MOVED_ORIGIN_MESSAGE } from "./movedOrigin";

describe("arriving through the redirect from the old address", () => {
  it("recognises a hop from the superseded host", () => {
    expect(arrivedFromSupersededOrigin("https://anmaisys.lovable.app/", "anpmsystem.co.uk")).toBe(true);
    // strict-origin-when-cross-origin sends the origin alone; a full path works too.
    expect(arrivedFromSupersededOrigin("https://anmaisys.lovable.app/dashboard/work-orders", "anpmsystem.co.uk")).toBe(true);
  });

  it("says nothing to someone who simply arrived", () => {
    // The whole risk of this notice: telling a first-time user on a new phone that
    // their sign-in is on another address, which is false and unhelpful.
    expect(arrivedFromSupersededOrigin("", "anpmsystem.co.uk")).toBe(false);
    expect(arrivedFromSupersededOrigin(undefined, "anpmsystem.co.uk")).toBe(false);
    expect(arrivedFromSupersededOrigin("https://www.google.com/", "anpmsystem.co.uk")).toBe(false);
    expect(arrivedFromSupersededOrigin("https://anpmsystem.co.uk/login", "anpmsystem.co.uk")).toBe(false);
  });

  it("stays quiet while the page is still being served from the old host", () => {
    // Nothing has moved for this page yet, so there is nothing to explain.
    expect(arrivedFromSupersededOrigin("https://anmaisys.lovable.app/", "anmaisys.lovable.app")).toBe(false);
  });

  it("does not throw on a referrer that is not a URL", () => {
    expect(arrivedFromSupersededOrigin("not a url", "anpmsystem.co.uk")).toBe(false);
  });

  it("returns the message only when the arrival is proven", () => {
    expect(movedOriginNotice("https://anmaisys.lovable.app/", "anpmsystem.co.uk")).toBe(MOVED_ORIGIN_MESSAGE);
    expect(movedOriginNotice("", "anpmsystem.co.uk")).toBeNull();
  });
});
