import { describe, expect, it } from "vitest";
import { OTHER_MACHINES } from "@/lib/timeMotionMatrix";

/**
 * Owner correction, 25/11/2026: the Gel Machine fills 0.60 g gel sachets.
 * The review sheet had it written as "0.6 kg" of "tubs", which is not what
 * the machine makes, so the matrix must not repeat that.
 */
describe("Gel Machine row", () => {
  const gel = OTHER_MACHINES.find((m) => m.name === "Gel Machine");

  it("is listed as 0.60 g gel sachets, not 0.6 kg tubs", () => {
    expect(gel).toBeDefined();
    expect(gel?.rows).toHaveLength(1);
    const row = gel?.rows[0];
    expect(row?.pack).toBe("0.60 g");
    expect(row?.unit).toBe("sachets");
    expect(row?.pack).not.toMatch(/kg/);
    expect(row?.unit).not.toBe("tubs");
  });

  it("keeps the sheet speed, which matches the fill time", () => {
    const row = gel?.rows[0];
    expect(row?.seconds).toBeCloseTo(3600 / (row?.perHour ?? 1), 2);
  });

  it("says where the 0.60 g figure came from", () => {
    expect(gel?.rows[0].basis).toContain("0.60 g gel sachets");
    expect(gel?.rows[0].note).toBeUndefined();
  });
});
