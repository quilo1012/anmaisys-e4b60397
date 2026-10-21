import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * F-6. wallboard-lines gates a public, read-only board with WALLBOARD_KEY. The key is
 * low-sensitivity and travels in the query string (a TV browser cannot set a header on a
 * plain page load), but the comparison must still be constant-time so response timing
 * cannot leak the key byte-by-byte.
 *
 * Source check: the timing-leaky `!== WALLBOARD_KEY` must not come back, and a
 * constant-time compare must be in use.
 */

const FN = resolve(__dirname, "../..", "supabase/functions/wallboard-lines/index.ts");

describe("wallboard-lines compares its key in constant time", () => {
  const src = existsSync(FN) ? readFileSync(FN, "utf8") : "";

  it("the function exists", () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it("uses a constant-time comparison for the key", () => {
    expect(src).toMatch(/timingSafeEqual\s*\(\s*presented\s*,\s*WALLBOARD_KEY\s*\)/);
  });

  it("does not use the timing-leaky direct comparison", () => {
    expect(src).not.toMatch(/presented\s*!==\s*WALLBOARD_KEY/);
    expect(src).not.toMatch(/presented\s*===\s*WALLBOARD_KEY/);
  });

  it("still refuses when the key is unset (no silent open mode)", () => {
    expect(src).toMatch(/if\s*\(\s*!WALLBOARD_KEY\s*\)/);
  });
});
