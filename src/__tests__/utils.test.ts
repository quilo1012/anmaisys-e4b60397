import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins simple strings with spaces", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });
  it("ignores undefined / null / false", () => {
    expect(cn("foo", undefined, "bar")).toBe("foo bar");
    expect(cn("foo", null, false, "bar")).toBe("foo bar");
  });
  it("merges conflicting tailwind classes (twMerge)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("supports conditional object syntax (clsx)", () => {
    expect(cn("foo", { bar: true, baz: false })).toBe("foo bar");
  });
});
