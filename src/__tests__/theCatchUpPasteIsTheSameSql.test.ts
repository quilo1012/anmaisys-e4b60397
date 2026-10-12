import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The catch-up paste carries blocks, never its own version of them.
 *
 * `APLICAR-78-a-91-sem-83-84.sql` exists so the twelve blocks production was missing on
 * 12/10 go in with one paste. A copy is a second source of truth the moment either side
 * is edited, so every block in it must still appear, byte for byte, in the package.
 */
const dir = resolve(__dirname, "../..", "docs/apply-passo-3");
const all = readFileSync(resolve(dir, "APPLY-ALL-IN-ORDER.sql"), "utf8");
const catchUp = readFileSync(resolve(dir, "APLICAR-78-a-91-sem-83-84.sql"), "utf8");

const blocks = catchUp
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .filter((b) => /^-- =+\n-- BLOCO \d+\n/.test(b));

describe("the catch-up paste", () => {
  it("carries the twelve blocks, without 83 and 84", () => {
    const names = blocks.map((b) => Number(b.match(/-- BLOCO (\d+)/)![1]));
    expect(names).toEqual([78, 79, 80, 81, 82, 85, 86, 87, 88, 89, 90, 91]);
  });

  for (const b of blocks) {
    const name = b.match(/-- BLOCO \d+/)![0];
    it(`${name} is the package's own text`, () => {
      expect(all).toContain(b.trimEnd());
    });
  }
});
