import { describe, it, expect } from "vitest";
import { woListHref, readLinkedRange } from "./woListLink";

describe("links into the orders list", () => {
  it("carries status, range and type", () => {
    expect(woListHref({ status: "stale", range: "all" })).toBe("/dashboard/work-orders?status=stale&range=all");
    expect(woListHref({ range: "30d", type: "preventive" })).toBe("/dashboard/work-orders?range=30d&type=preventive");
    expect(woListHref({})).toBe("/dashboard/work-orders");
  });
  it("never links a custom range, which needs dates a link does not carry", () => {
    expect(woListHref({ range: "custom" })).toBe("/dashboard/work-orders");
  });
  it("reads only the presets the list knows", () => {
    expect(readLinkedRange("all")).toBe("all");
    expect(readLinkedRange("30d")).toBe("30d");
    expect(readLinkedRange("custom")).toBeNull();
    expect(readLinkedRange("forever")).toBeNull();
    expect(readLinkedRange(null)).toBeNull();
  });
});
