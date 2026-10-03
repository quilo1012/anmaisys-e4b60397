import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A plan read short is an efficiency read high.
 *
 * `rag_weekly_entries` is the DENOMINATOR of every attainment figure in this app — the
 * leader scorecard's Production pillar, Production Performance, Shift History, the
 * report summary. PostgREST caps an unbounded select at 1000 rows and says nothing
 * about it, and the table passed that cap during 2026: 1068 rows. So a read over a
 * year came back 68 targets short, the full period's output was divided by a partial
 * period's plan, and the screen printed 80.9% where the truth was 76.4%.
 *
 * Four and a half points, in the flattering direction, on the figure people are
 * appraised on. And with no ORDER BY, the thousand that came back were whichever the
 * server felt like, so the number moved between refreshes.
 *
 * Analytics had been paged, with a comment saying exactly this. Its three siblings had
 * not. That is what this file is for: the rule was known and written down in one place
 * while three copies of the same read went without it.
 *
 * THE RULE: a read of this table that spans a RANGE of dates must be paged. A read
 * pinned to one day — `.eq("entry_date", …)` — is a handful of rows and needs nothing,
 * and nor is a range the screen fixes at one week. The exceptions are named below with
 * their reason, rather than left to a pattern that would have to guess from variable
 * names which range a user can widen.
 */

/**
 * Ranged reads that are narrow by construction, and why.
 *
 * A file earns a line here by having a range it CONTROLS, not one it is handed. The
 * moment one of these learns to show a month, it belongs back under the rule — so the
 * reason is written out, not just the path.
 */
const NARROW: Record<string, string> = {
  "src/pages/dashboard/RAGWeeklyPage.tsx":
    "The week board. Every read is bounded by its own week picker — seven days of "
    + "line-shifts, some thirty rows. There is no control on the page that widens it.",
};

const SRC = resolve(__dirname, "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** The chain starting at `.from("rag_weekly_entries")`, to the end of its statement. */
function readsOf(body: string, table: string): string[] {
  const out: string[] = [];
  const needle = `.from("${table}")`;
  let at = body.indexOf(needle);
  while (at !== -1) {
    // Far enough to carry the whole builder chain, including a multi-line one.
    out.push(body.slice(at, at + 700));
    at = body.indexOf(needle, at + 1);
  }
  return out;
}

describe("the plan is never read short", () => {
  const files = sourceFiles(SRC);
  const reads = files.flatMap((f) =>
    readsOf(readFileSync(f, "utf8"), "rag_weekly_entries").map((chain) => ({ file: f, chain })),
  );

  it("keeps every exception explained, and every explanation pointing at a file", () => {
    // An allowlist nobody can read is a second place for the rule to rot. Each entry
    // has to name a file that exists and still reads this table.
    for (const [path, reason] of Object.entries(NARROW)) {
      expect(reason.length, `${path} is excused without a reason`).toBeGreaterThan(40);
      expect(
        reads.some((r) => r.file.endsWith(path.replace(/^src\//, "/src/").slice(1))
          || r.file.includes(path.slice("src/".length))),
        `${path} is on the narrow list but no longer reads rag_weekly_entries — drop it`,
      ).toBe(true);
    }
  });

  it("finds the reads at all", () => {
    // Without this, a renamed table or a wrong path makes every assertion below
    // vacuously true — the failure mode of every test that walks a directory.
    expect(reads.length).toBeGreaterThan(8);
  });

  for (const { file, chain } of reads) {
    const short = file.slice(file.indexOf("/src/") + 1);
    // A range read is the one at risk. `.eq("entry_date", …)` pins a single day.
    const spansARange = /\.gte\(\s*"entry_date"/.test(chain);
    if (!spansARange) continue;
    if (NARROW[short]) continue;

    it(`pages the ranged read in ${short}`, () => {
      const paged = /\.range\(/.test(chain) || /fetchAllRows\s*[<(]/.test(chain);
      const capped = /\.limit\(/.test(chain);
      expect(
        paged || capped,
        `${short} reads rag_weekly_entries across a date range without paging it. `
          + "Over a year that is a short plan and an inflated attainment — see the note "
          + "at the top of this file. Wrap it in fetchAllRows, ordered.",
      ).toBe(true);
    });

    it(`orders the ranged read in ${short}, so pages cannot overlap`, () => {
      // Two pages of an unordered result can repeat a row and skip another. On a plan
      // that is one target counted twice and one lost — the error hides inside a
      // plausible total.
      if (!/\.range\(/.test(chain) && !/fetchAllRows\s*[<(]/.test(chain)) return;
      expect(/\.order\(/.test(chain), `${short} pages without an ORDER BY.`).toBe(true);
    });
  }
});
