import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A table read short is a number wrong in the flattering direction.
 *
 * PostgREST answers an unbounded select with at most 1000 rows and says nothing about
 * it — no error, no flag, just a shorter array. A screen that sums those rows prints
 * something that looks exactly like an answer.
 *
 * It has happened twice on the figures this factory is appraised on:
 *
 * `rag_weekly_entries` is the DENOMINATOR of every attainment figure here. It passed
 * the cap during 2026 — 1068 rows — so a Year period divided a full period's output by
 * a partial period's plan and printed 80.9% where the truth was 76.4%. Four and a half
 * points. Analytics had been paged, with a comment saying precisely this; three copies
 * of the same read had not.
 *
 * `production_items` is the NUMERATOR. 1367 rows, and the rows arrive in the order they
 * were made — so the thousand that came back were the OLDEST and the newest month was
 * always the invisible one. SKU Efficiency at 90 days lost 949,759 units, 28% of
 * everything the factory has made, with every SKU on the ranking still showing a
 * number beside it.
 *
 * THE RULE: a read of one of the tables below that spans a RANGE, or has no narrowing
 * filter at all, must be paged and ordered. Paged, or the answer is short. Ordered, or
 * two pages repeat one row and skip another, and the error hides inside a plausible
 * total.
 *
 * Narrow reads are exempt — but by name and with the reason written out, not by a
 * pattern left to guess from a variable name which ranges a user can widen.
 */

/**
 * The tables at or past the cap, with the count measured on 2026-10-03.
 *
 * NEXT TO CROSS, measured the same day: `downtime_events` at 774 and `work_orders` at
 * 768, both growing about seven rows a day — a month of headroom. They are not
 * enforced here yet because their reads have not been audited one by one, and a guard
 * with an unexamined allowlist is worse than no guard. When they are, they belong in
 * this map. The bigger tables above them — `attendance_days`, `employee_attendance`,
 * `daily_allocations`, `production_downtimes`, `audit_logs` — are read through the
 * workforce paging helpers already.
 */
const AT_THE_CAP: Record<string, number> = {
  production_items: 1367,
  quality_action_history: 1086,
  rag_weekly_entries: 1068,
  // Two rows of headroom at twelve sessions a day. Paged before it happened, which is
  // the only reason there is no figure to quote for this one.
  production_sessions: 998,
};

/**
 * Reads that are narrow by CONSTRUCTION, keyed `table @ path`, with the measurement
 * that says so.
 *
 * A read earns a line here by controlling its own bounds, not by being handed them.
 * The moment one of these learns to show a month, it belongs back under the rule — so
 * the reason is a fact about the data, not a reassurance.
 */
const NARROW: Record<string, string> = {
  "rag_weekly_entries @ src/pages/dashboard/RAGWeeklyPage.tsx":
    "The week board. Every read is bounded by its own week picker — seven days of "
    + "line-shifts, some thirty rows. No control on the page widens it.",
  "production_sessions @ src/pages/dashboard/RAGWeeklyPage.tsx":
    "Same week picker, same seven days. About a hundred sessions at the very most, "
    + "against a cap of a thousand.",
  "production_sessions @ src/hooks/useUnledShifts.ts":
    "The seven days ending on the chosen Sunday, the span `scorecard_week_board` uses. "
    + "A week of sessions is roughly eighty rows.",
  "production_sessions @ src/components/LeaderScorecard.tsx":
    "Filtered to one leader by name. The busiest leader in the factory has 88 sessions "
    + "across the whole year, so a year of this read is a tenth of the cap.",
  "production_items @ src/components/LeaderScorecard.tsx":
    "Filtered to one leader through the embedded session. The busiest leader has 132 "
    + "item rows across the whole year.",
  "production_items @ src/pages/dashboard/ControlCenterPage.tsx":
    "The items of the sessions of ONE date and ONE shift — a handful of sessions, so "
    + "a handful of ids in the `.in(...)` and a few dozen rows back.",
  "production_items @ src/pages/dashboard/LineDisplayScreen.tsx":
    "One line, one date, one shift: the session on the screen in front of somebody. "
    + "185 items was the busiest week for the whole factory.",
  "production_items @ src/pages/dashboard/QualityActionsPage.tsx":
    "Keyed on the batch codes named by the quality actions on screen. The busiest "
    + "batch code in the table has 27 item rows.",
  "quality_action_history @ src/components/LeaderScorecard.tsx":
    "The status changes of one leader's actions, and only `status` becoming `complete` "
    + "— at most one row per action, against 379 actions in the whole table.",
  "quality_action_history @ src/hooks/useQualityIssue.ts":
    "The audit trail of ONE action. The most-edited action in the table has 26 rows.",
};

const SRC = resolve(__dirname, "..");
/** Any query at all, used to end one read's window before the next one begins. */
const ANY_FROM = /\.from\(\s*["'`]/g;

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

interface Read {
  table: string;
  /** `src/...` path, as the allowlist keys are written. */
  file: string;
  key: string;
  /** The builder chain, to the start of the next query. */
  chain: string;
  /** The 500 characters before it, where a paging WRAPPER sits. */
  before: string;
}

/**
 * Every read of `table`, each with the text around it.
 *
 * The window runs to the next `.from(` of any table rather than to the next semicolon:
 * a chain with conditional filters is SPLIT by semicolons —
 *
 *     let q = supabase.from(T).select(…).gte(…);
 *     if (shift !== "all") q = q.eq("shift", shift);
 *     return q.order("id").range(a, b);
 *
 * — and a window that stopped at the first one would call that read unpaged, which is
 * how the first version of this guard reported four false positives. Ending at the
 * next query instead keeps the whole of this read and none of the one after it.
 */
function readsOf(body: string, file: string, table: string): Read[] {
  const out: Read[] = [];
  const needle = `.from("${table}")`;
  let at = body.indexOf(needle);
  while (at !== -1) {
    ANY_FROM.lastIndex = at + needle.length;
    const next = ANY_FROM.exec(body);
    const end = Math.min(next ? next.index : body.length, at + 1600);
    out.push({
      table,
      file,
      key: `${table} @ ${file}`,
      chain: body.slice(at, end),
      // A paged read is wrapped, so the helper's name is BEHIND the query, not in it.
      before: body.slice(Math.max(0, at - 500), at),
    });
    at = body.indexOf(needle, at + 1);
  }
  return out;
}

const reads: Read[] = sourceFiles(SRC).flatMap((full) => {
  const body = readFileSync(full, "utf8");
  const file = full.slice(full.indexOf("/src/") + 1);
  return Object.keys(AT_THE_CAP).flatMap((t) => readsOf(body, file, t));
});

/** Paging, however it was reached: `.range()` in the chain, or a helper wrapping it. */
const isPaged = (r: Read) =>
  /\.range\(/.test(r.chain)
  || /fetchAllRows\s*[<(]/.test(r.before)
  || /fetchRowsByIds\s*[<(]/.test(r.before);

/** A read that cannot come back short however many rows match. */
const cannotBeShort = (r: Read) =>
  /\.limit\(/.test(r.chain)
  || /\.(maybeSingle|single)\s*\(/.test(r.chain)
  || /head:\s*true/.test(r.chain);

const isWrite = (r: Read) => /\.(insert|update|upsert|delete)\s*\(/.test(r.chain);

/**
 * The reads at risk: a span of dates, or nothing narrowing them at all. A read pinned
 * to one date or one entity is a handful of rows and needs nothing.
 */
function atRisk(r: Read): boolean {
  if (isWrite(r) || cannotBeShort(r)) return false;
  if (/\.(gte|lte|lt|gt)\(/.test(r.chain)) return true;
  const pinned = /\.(eq|in)\(\s*"[a-z_]*date[a-z_]*"/.test(r.chain)
    || /\.eq\(\s*"(id|work_order_id|session_id|employee_id|action_id)"/.test(r.chain);
  return !pinned;
}

describe("the big tables are never read short", () => {
  it("finds the reads at all", () => {
    // Without this, a renamed table or a wrong path makes every assertion below
    // vacuously true — the failure mode of every test that walks a directory.
    expect(reads.length).toBeGreaterThan(20);
    for (const t of Object.keys(AT_THE_CAP)) {
      expect(reads.some((r) => r.table === t), `no read of ${t} found — renamed?`).toBe(true);
    }
  });

  it("knows every table it claims to watch is past the cap", () => {
    // The map is the argument for the rule. A table under 1000 rows does not need
    // this guard, and listing one here would make the reasons below untrue.
    for (const [table, rows] of Object.entries(AT_THE_CAP)) {
      expect(rows, `${table} is listed but under the cap`).toBeGreaterThan(950);
    }
  });

  it("keeps every exception explained, and every explanation pointing at a read", () => {
    // An allowlist nobody can read is a second place for the rule to rot.
    for (const [key, reason] of Object.entries(NARROW)) {
      expect(reason.length, `${key} is excused without a reason`).toBeGreaterThan(60);
      expect(
        reads.some((r) => r.key === key),
        `${key} is on the narrow list but no longer reads that table — drop the entry`,
      ).toBe(true);
    }
  });

  for (const r of reads) {
    if (!atRisk(r)) continue;
    if (NARROW[r.key]) continue;

    it(`pages the wide read of ${r.table} in ${r.file}`, () => {
      expect(
        isPaged(r),
        `${r.file} reads ${r.table} (${AT_THE_CAP[r.table]} rows) across a range without `
          + "paging it. PostgREST answers with 1000 rows and no warning — see the note at "
          + "the top of this file. Wrap it in fetchAllRows, or fetchRowsByIds when the "
          + "filter is a list of ids, and order it. If the read is narrow by "
          + "construction, add it to NARROW with the measurement that says so.",
      ).toBe(true);
    });

    it(`orders the paged read of ${r.table} in ${r.file}, so pages cannot overlap`, () => {
      if (!isPaged(r)) return; // the test above is the one that should fail
      expect(
        /\.order\(/.test(r.chain),
        `${r.file} pages ${r.table} without an ORDER BY. Two pages of an unordered `
          + "result can repeat a row and skip another — one target counted twice and "
          + "one lost, inside a total that still looks reasonable.",
      ).toBe(true);
    });
  }
});
