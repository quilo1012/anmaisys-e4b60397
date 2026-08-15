import { describe, expect, it } from "vitest";
import { sourceFor } from "@/lib/derivedVolume";

describe("sourceFor", () => {
  it("stays derived while the number is the one production gave", () => {
    expect(sourceFor(1000, 1000)).toBe("derivado");
  });

  it("becomes manual the moment somebody changes it", () => {
    expect(sourceFor(1050, 1000)).toBe("manual");
  });

  it("is manual when production had nothing to offer", () => {
    expect(sourceFor(1000, null)).toBe("manual");
  });

  it("is nothing at all while the field is empty", () => {
    expect(sourceFor(null, 1000)).toBeNull();
  });
});
