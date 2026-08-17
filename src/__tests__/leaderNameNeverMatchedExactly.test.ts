import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * No query anywhere may match a leader's name with `.eq()`.
 *
 * `leader_name` is free text, filled in by different hands on different screens, and
 * this database has spelled the same person two ways for months: `leader_pins` holds
 * HENRIQUE, CAINAN, FILIPI, KAZ and JULIANO in capitals while `production_sessions`
 * and `quality_actions` hold them in title case. `.eq()` is case-sensitive, so the
 * query returns nothing and the screen renders that as a fact about the person rather
 * than as a failure to find them.
 *
 * It cost Cainan his entire quality section — twelve production sessions found, zero
 * actions, and "No quality action was raised against this leader in this period"
 * printed over Quality 100%. The same `.eq()` was sitting in the line indicators at
 * the same time, doing the same thing more quietly.
 *
 * A repo-wide guard rather than a test per screen, because the defect is not in any
 * one of them: it is that the comparison looks completely ordinary. It type-checks, it
 * runs, it returns rows for seventeen of the twenty-two leaders, and the five it fails
 * on are the five nobody thinks to check.
 */

const SRC = join(process.cwd(), "src");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full)) yield full;
  }
}

/** `.eq("leader_name", …)` and `.eq("production_sessions.leader_name", …)` alike. */
const EXACT_MATCH = /\.eq\(\s*["'`][\w.]*leader_name["'`]/g;

describe("matching a leader by name", () => {
  it("is never done case-sensitively anywhere in src", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      // This file quotes the pattern in order to forbid it.
      if (file.endsWith("leaderNameNeverMatchedExactly.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(EXACT_MATCH)) {
        const line = text.slice(0, m.index).split("\n").length;
        offenders.push(`${relative(process.cwd(), file)}:${line}`);
      }
    }
    expect(
      offenders,
      `use ilike with leaderNamePattern() — .eq() silently finds nothing for the five leaders spelled in capitals:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
