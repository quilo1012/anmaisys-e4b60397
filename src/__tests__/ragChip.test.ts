import { describe, expect, it } from "vitest";
import { ragLabel } from "@/components/scorecard/RagChip";

describe("ragLabel", () => {
  it("shows a dash for what was never recorded, never a zero and never a colour", () => {
    expect(ragLabel(null)).toBe("—");
  });

  it("passes through the verdict the database gave", () => {
    expect(ragLabel("Red")).toBe("Red");
    expect(ragLabel("Sem dados")).toBe("Sem dados");
  });
});
