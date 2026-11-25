import { describe, it, expect } from "vitest";
import { outsideProduction } from "@/hooks/useHeadcount";
describe("outsideProduction", () => {
  it("hides Warehouse AC1 staff from the roster", () => {
    expect(outsideProduction({ department: "Warehouse AC1" })).toBe(true);
    expect(outsideProduction({ department: "warehouse ac1" })).toBe(true);
  });
  it("keeps production and the regular warehouse", () => {
    expect(outsideProduction({ department: "Production" })).toBe(false);
    expect(outsideProduction({ department: "Warehouse" })).toBe(false);
    expect(outsideProduction({ department: null })).toBe(false);
  });
});
