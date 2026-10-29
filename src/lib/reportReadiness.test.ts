import { describe, it, expect } from "vitest";
import { reportBlocker } from "@/lib/reportReadiness";

describe("reportBlocker", () => {
  it("lets the report through only when every read succeeded", () => {
    expect(reportBlocker([{ what: "the quality actions", status: "success" }, { what: "the plan", status: "success" }])).toBeNull();
  });

  it("blocks on a failed read, and names it", () => {
    expect(reportBlocker([{ what: "the quality actions", status: "error" }])).toMatch(/quality actions could not be read/);
  });

  it("blocks while a read is still loading — an empty list then is not an empty period", () => {
    expect(reportBlocker([{ what: "the production sessions", status: "pending" }])).toMatch(/still loading/);
  });

  it("reports the failure before the wait when both are true", () => {
    expect(reportBlocker([
      { what: "a", status: "pending" },
      { what: "b", status: "error" },
    ])).toMatch(/b could not be read/);
  });
});
