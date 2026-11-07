import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Two branches took BLOCO 152 on the same day (07/11/2026): the engineer's order alert
 * and My Attendance's board hours. GitHub caught it as a conflict only because both
 * touched the same test file name; a block number is how a person tells which paste
 * they have done, so two blocks with one number is a paste skipped or pasted twice.
 *
 * BLOCO 72 was used twice in October, long since pasted, and is left as it is.
 */
const dir = resolve(__dirname, "../../docs/apply-passo-3");
const all = readFileSync(resolve(dir, "APPLY-ALL-IN-ORDER.sql"), "utf8");
const GRANDFATHERED = new Set(["72"]);

const blocks = [...all.matchAll(/^-- BLOCO (\d+[a-z]?)\n-- (\S+\.sql)$/gm)].map((m) => ({ id: m[1], migration: m[2] }));

describe("the paste package's block numbers", () => {
  it("finds the blocks", () => {
    expect(blocks.length).toBeGreaterThan(100);
  });

  it("gives every block its own number", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const b of blocks) {
      if (seen.has(b.id) && !GRANDFATHERED.has(b.id)) clashes.push(`BLOCO ${b.id}: ${seen.get(b.id)} and ${b.migration}`);
      seen.set(b.id, b.migration);
    }
    expect(clashes).toEqual([]);
  });

  it("never puts a migration in two blocks", () => {
    const names = blocks.map((b) => b.migration);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("numbers the blocks in the order they are pasted", () => {
    const n = blocks.map((b) => parseInt(b.id, 10));
    const backwards = n.flatMap((x, i) => (i > 0 && x < n[i - 1] ? [`${n[i - 1]} → ${x}`] : []));
    expect(backwards).toEqual([]);
  });

  // From 135 on, every APLICAR file is its block byte for byte; the older ones were
  // written by hand and some carry several blocks under other headings.
  it("has an APLICAR file that carries the block its name says", () => {
    const wrong = readdirSync(dir)
      .map((f) => f.match(/^APLICAR-(\d+[a-z]?)-.*\.sql$/))
      .filter((m): m is RegExpMatchArray => !!m && parseInt(m[1], 10) >= 135)
      .filter((m) => !new RegExp(`BLOCO ${m[1]}\\b`).test(readFileSync(resolve(dir, m[0]), "utf8")))
      .map((m) => m[0]);
    expect(wrong).toEqual([]);
  });
});
