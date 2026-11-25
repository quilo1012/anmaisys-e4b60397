import { describe, it, expect } from "vitest";
import { correctedFillTime } from "@/lib/fillTimeCorrection";

describe("fill time correction", () => {
  it("Line 4 creatine 250 g: 2.9 s at 113.02% becomes 2.57 s", () => {
    expect(correctedFillTime(2.9, 113.02)).toBe(2.57);
  });
  it("Line 1 whey 1.8 kg: 12.3 s at 144.83% becomes 8.49 s", () => {
    expect(correctedFillTime(12.3, 144.83)).toBe(8.49);
  });
  it("at or under 100% nothing changes", () => {
    expect(correctedFillTime(5.2, 100)).toBeNull();
    expect(correctedFillTime(5.2, 87)).toBeNull();
  });
});
