import { describe, it, expect } from "vitest";
import { dueDaysOf } from "@/hooks/useHeadcount";
import { worksOn } from "@/hooks/useWorkforce";

// 13/10/2026 é uma terça. O board desse dia tinha o crew Fri–Mon em "Not placed yet".
const tuesday = new Date("2026-10-13T12:00:00");
const saturday = new Date("2026-10-17T12:00:00");
const due = (group: string, pattern: { days: number[] } | null, d: Date) => {
  const days = dueDaysOf(group, pattern);
  return !days || worksOn(days, d);
};

describe("who is due in, when nobody gave the person a pattern", () => {
  it("a Fri–Mon crew is not due on a Tuesday", () => {
    expect(due("Weekend", null, tuesday)).toBe(false);
    expect(due("Warehouse Weekend", null, tuesday)).toBe(false);
  });
  it("and is due on a Saturday", () => {
    expect(due("Weekend", null, saturday)).toBe(true);
  });
  it("a crew that does not name its days stays due every day", () => {
    expect(due("B", null, tuesday)).toBe(true);
    expect(due("Night", null, saturday)).toBe(true);
  });
  it("a pattern on file still wins over the crew", () => {
    expect(due("Weekend", { days: [2, 3, 4] }, tuesday)).toBe(true);
  });
});
