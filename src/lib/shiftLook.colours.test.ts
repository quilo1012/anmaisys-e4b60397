import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shiftCard, shiftKind } from "@/lib/shiftLook";

describe("Day is blue, Night is purple", () => {
  const css = readFileSync("src/index.css", "utf8");
  const hue = (name: string, from = 0) => {
    const m = new RegExp(`--${name}:\\s*(\\d+)`).exec(css.slice(from));
    return m ? Number(m[1]) : NaN;
  };
  it("light and dark themes use a blue Day hue and a purple Night hue", () => {
    const firstDay = css.indexOf("--shift-day:");
    const darkDay = css.indexOf("--shift-day:", firstDay + 1);
    for (const at of [firstDay, darkDay]) {
      expect(hue("shift-day", at)).toBeGreaterThanOrEqual(200);
      expect(hue("shift-day", at)).toBeLessThanOrEqual(225);
      expect(hue("shift-night", at)).toBeGreaterThanOrEqual(260);
      expect(hue("shift-night", at)).toBeLessThanOrEqual(290);
    }
  });
  it("the two shifts never share a card colour", () => {
    expect(shiftCard("Day")).toContain("shift-day");
    expect(shiftCard("Night")).toContain("shift-night");
    expect(shiftCard("Day")).not.toContain("shift-night");
    expect(shiftCard("Weekend")).toBe("");
    expect(shiftKind("Night")).toBe("night");
  });
});
