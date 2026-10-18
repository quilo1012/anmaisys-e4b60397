import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The catch-up paste carries blocks, never its own version of them.
 *
 * `APLICAR-78-a-89.sql` exists so the blocks production was still missing on 18/10 go in
 * with one paste. A copy is a second source of truth the moment either side is edited,
 * so every block in it must still appear, byte for byte, in the package.
 *
 * It stops at 89 on purpose. The paste it replaced ran to 91, and by 18/10 its BLOCO 90
 * had become dangerous: 90 and 94 both `create or replace` my_attendance, 94 was already
 * applied, and pasting 90 again would have put the older body back without an error.
 */
const dir = resolve(__dirname, "../..", "docs/apply-passo-3");
const all = readFileSync(resolve(dir, "APPLY-ALL-IN-ORDER.sql"), "utf8");
const catchUp = readFileSync(resolve(dir, "APLICAR-78-a-89.sql"), "utf8");

const blocks = catchUp
  .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
  .filter((b) => /^-- =+\n-- BLOCO \d+\n/.test(b));

describe("the catch-up paste", () => {
  it("carries the ten blocks, without 83 and 84 and nothing past 89", () => {
    const names = blocks.map((b) => Number(b.match(/-- BLOCO (\d+)/)![1]));
    expect(names).toEqual([78, 79, 80, 81, 82, 85, 86, 87, 88, 89]);
  });

  // The catch-up runs after later blocks are already in. Any function, view or policy
  // it shares with a later block would be rolled back to the older body by the paste.
  it("defines nothing a later block also defines", () => {
    const defs = (sql: string) =>
      new Set(
        [...sql.toLowerCase().matchAll(/create (?:or replace )?(?:function|view) (?:public\.)?([a-z_]+)|create policy ("[^"]+" on (?:public\.)?[a-z_]+)/g)]
          .map((m) => (m[1] ?? m[2]).replace("public.", "")),
      );
    const last = Math.max(...blocks.map((b) => Number(b.match(/-- BLOCO (\d+)/)![1])));
    const later = all
      .split(/\n(?=-- =+\n-- BLOCO \d+\n)/)
      .filter((b) => Number(b.match(/^-- =+\n-- BLOCO (\d+)\n/)?.[1] ?? 0) > last)
      .join("\n");
    const mine = defs(catchUp);
    const clash = [...defs(later)].filter((d) => mine.has(d));
    expect(clash).toEqual([]);
  });

  for (const b of blocks) {
    const name = b.match(/-- BLOCO \d+/)![0];
    it(`${name} is the package's own text`, () => {
      expect(all).toContain(b.trimEnd());
    });
  }
});
