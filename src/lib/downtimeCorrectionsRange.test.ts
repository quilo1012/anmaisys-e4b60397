import { describe, it, expect } from "vitest";
import { correctionInRange, correctionLineLabel } from "@/lib/downtimeCorrectionsRange";

const from = new Date("2026-08-10T00:00:00Z").getTime();
const to = new Date("2026-08-11T00:00:00Z").getTime();

describe("correctionInRange", () => {
  it("keeps a stoppage that started inside the range, however late it was corrected", () => {
    expect(
      correctionInRange({ stopped_at: "2026-08-10T06:47:00Z", line_name: "Line 1" }, from, to),
    ).toBe(true);
  });

  it("drops a stoppage that started outside the range", () => {
    expect(
      correctionInRange({ stopped_at: "2026-08-09T23:59:00Z", line_name: "Line 1" }, from, to),
    ).toBe(false);
    expect(
      correctionInRange({ stopped_at: "2026-08-11T00:01:00Z", line_name: "Line 1" }, from, to),
    ).toBe(false);
  });

  it("matches the line filter on the live line name", () => {
    const row = { stopped_at: "2026-08-10T08:00:00Z", line_name: "Line 3", line_at_time: "Line 1" };
    expect(correctionInRange(row, from, to, "Line 3")).toBe(true);
    expect(correctionInRange(row, from, to, "Line 1")).toBe(false);
  });

  it("falls back to the snapshot line when the order has no live line", () => {
    const row = { stopped_at: "2026-08-10T08:00:00Z", line_name: null, line_at_time: "Line 4" };
    expect(correctionInRange(row, from, to, "Line 4")).toBe(true);
    expect(correctionLineLabel(row)).toBe("Line 4");
    expect(correctionLineLabel({ line_at_time: "removed" })).toBe("—");
  });

  it("ignores a row with no usable stoppage time", () => {
    expect(correctionInRange({}, from, to)).toBe(false);
  });
});
