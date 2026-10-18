import { describe, it, expect } from "vitest";
import { csvCell, csvText } from "./exportCsv";

describe("csvCell", () => {
  it("leaves a negative number a number, so the column can still be summed", () => {
    expect(csvCell(-4.5)).toBe('"-4.5"');
    expect(csvCell(0)).toBe('"0"');
  });

  it("still neutralises text that would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("-2+3")).toBe('"\'-2+3"');
    expect(csvCell("@SUM(A1)")).toBe('"\'@SUM(A1)"');
  });

  it("neutralises a leading tab or carriage return too", () => {
    expect(csvCell("\t=1+1")).toBe('"\'\t=1+1"');
    expect(csvCell("\r=1+1")).toBe('"\'\r=1+1"');
  });

  it("quotes commas and doubles quotes", () => {
    expect(csvCell('Silva, "Ana"')).toBe('"Silva, ""Ana"""');
  });
});

describe("csvText", () => {
  it("starts with a byte-order mark, so Excel opens accented names as UTF-8", () => {
    const text = csvText(["Name"], [["João"]]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe('"Name"\n"João"');
  });
});
