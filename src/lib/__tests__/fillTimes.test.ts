import { describe, it, expect } from "vitest";
import { fillTimes, secondsPerUnit } from "@/lib/fillTimes";

const cyc = (line: 1|2|3|4|5|6, sku: string, s: number) => ({ line, sku, cycleSeconds: s, idealPerHour: 3600 / s, source: "t" }) as never;

describe("fill time", () => {
  it("is run minutes × 60 ÷ units", () => {
    expect(secondsPerUnit(445, 10177)).toBeCloseTo(2.62, 2);
  });
  it("ignores shifts with no run or no units", () => {
    expect(secondsPerUnit(0, 100)).toBeNull();
    expect(secondsPerUnit(60, 0)).toBeNull();
  });
  it("takes the median per line and product and compares with iTouch", () => {
    const rows = fillTimes(
      [1, 2, 3, 4, 5].map((i) => ({ line: "Line 4", sku: "ab1", quantity: 1000, runMinutes: 40 + i })),
      [cyc(4, "AB1", 2)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].medianSeconds).toBeCloseTo(2.58, 2);
    expect(rows[0].vsItouch).toBeCloseTo(0.29, 2);
    expect(rows[0].flag).toBeNull();
  });
  it("flags products with fewer than 5 shifts", () => {
    const rows = fillTimes([{ line: 1, sku: "X", quantity: 100, runMinutes: 10 }], []);
    expect(rows[0].flag).toBe("few_shifts");
  });
  it("flags real more than 50% away from iTouch", () => {
    const rows = fillTimes(Array(5).fill({ line: 2, sku: "Y", quantity: 100, runMinutes: 10 }), [cyc(2, "Y", 3)]);
    expect(rows[0].flag).toBe("far_from_itouch");
  });
});
