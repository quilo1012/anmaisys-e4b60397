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
 * The tables at or past the cap, with the counts measured on 2026-10-05.
 *
 * `production_downtimes` AND `audit_logs` WERE MISSING FROM THIS MAP, and the sentence
 * that kept them out said they were "read through the workforce paging helpers
 * already". That was true of the reads that existed when it was written and stopped
 * being true the day a new screen read the table its own way. An exemption written as
 * prose is a claim about code nobody re-checks; the map is the only part of this file
 * the guard actually reads. Measure, do not reassure.
 *
 * The tables on their way here live in `APPROACHING` below, under the same rules.
 */
const AT_THE_CAP: Record<string, number> = {
  // Fifteen times the cap, and the only table here that has already printed a wrong
  // number on a screen somebody read. One stoppage per machine per stop, about 6700
  // rows a month, and nothing about it slows down.
  production_downtimes: 15_263,
  audit_logs: 7_415,
  production_items: 1_374,
  quality_action_history: 1_161,
  rag_weekly_entries: 1_125,
  // Had two rows of headroom on 2026-10-03 and has none now. Paged before it crossed,
  // which is the only reason there is no wrong figure to quote for this one.
  production_sessions: 1_007,
};

/**
 * The tables that have NOT crossed yet, watched anyway. Counts measured on 2026-10-05.
 *
 * Every table in the map above arrived here the same way: by being under the cap on
 * the day somebody wrote a read of it, and over the cap on the day the server started
 * cutting that read's answer. Nobody is told when it happens. There is no error, no
 * log line, no changed behaviour on the screen — only a smaller number, on a page that
 * has always shown numbers.
 *
 * So the guard starts BEFORE the crossing. A read written against 774 rows is read by
 * the server against however many rows there are the day it runs, and a month is not
 * enough warning to find three hooks and rewrite them calmly.
 *
 * An entry graduates to `AT_THE_CAP` when it crosses; it does not linger here. The
 * test below holds both ends of that, so this map cannot quietly become a second,
 * softer rule.
 */
const APPROACHING: Record<string, number> = {
  // Seven rows a day, about a month of headroom on the day this was written.
  work_orders: 774,
  downtime_events: 784,
};

const WATCHED: Record<string, number> = { ...AT_THE_CAP, ...APPROACHING };

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
  "work_orders @ src/components/LeaderScorecard.tsx":
    "Filtered to one leader by `requester_name`. The busiest requester in the table has "
    + "34 orders of all time, against a cap of a thousand.",
  "work_orders @ src/components/MissingDowntimeAlert.tsx":
    "Closed orders that never recorded a stop — `line_stopped_at is null` and a finished "
    + "status. That is 59 rows in the WHOLE table, and the alert exists to drive the "
    + "number down, not up. The date range narrows it further.",
  "downtime_events @ src/components/MissingDowntimeAlert.tsx":
    "`.in(...)` over the ids the read above returned — at most those 59, and in practice "
    + "a handful from one period.",
  "work_orders @ src/hooks/useShiftDowntime.ts":
    "ONE shift. The busiest day the factory has had put 27 orders into `line_stopped_at`, "
    + "across both shifts.",
  "downtime_events @ src/hooks/useShiftDowntime.ts":
    "Same single shift, and the `.in(...)` that follows it is keyed on the ids that read "
    + "returned. The busiest day in the table has 42 events, across both shifts.",
  "work_orders @ src/lib/mcp/tools/list-work-orders.ts":
    "The MCP tool's own schema bounds it: `z.number().int().min(1).max(100).default(25)`. "
    + "A caller cannot ask for more than 100 rows, so the server's thousand never binds.",
  "work_orders @ src/pages/dashboard/RAGWeeklyPage.tsx":
    "The week board, bounded by `line_stopped_at` inside the chosen week plus a day of "
    + "padding. The busiest week in the table has 83 such orders.",
  "downtime_events @ src/pages/dashboard/RAGWeeklyPage.tsx":
    "Same week picker, by `stopped_at`. The busiest week in the table has 123 events.",
  "downtime_events @ src/pages/dashboard/EngineerDashboard.tsx":
    "`.in(...)` over the ids of the history list above, which is itself `.limit(200)` — "
    + "so at most 200 orders' worth of events, and the busiest day has 42.",
  "audit_logs @ src/hooks/useAuditLogs.ts":
    "Two reads, both bounded. The log viewer pages with `.range()` and an exact count. "
    + "`useStockAdjustmentHistory` takes the newest N of `action = adjust_stock` — 89 "
    + "rows in the whole table, and its one caller asks for 10. Neither sums anything: "
    + "the panel is a list of the most recent, where a short answer is the answer. Note "
    + "this key excuses the FILE, so a wide new read of audit_logs added here would "
    + "inherit the exemption — split the read out if that day comes.",
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
  return Object.keys(WATCHED).flatMap((t) => readsOf(body, file, t));
});

/** Paging, however it was reached: `.range()` in the chain, or a helper wrapping it. */
const isPaged = (r: Read) =>
  /\.range\(/.test(r.chain)
  || /fetchAllRows\s*[<(]/.test(r.before)
  || /fetchRowsByIds\s*[<(]/.test(r.before);

/** What PostgREST answers with when nobody bounds the read. */
const SERVER_CAP = 1000;

/**
 * A `.limit(n)` that the server will honour: a literal, at or under the cap.
 *
 * Above the cap a limit is a wish, not a bound. The server answers with 1000 rows
 * either way, and the `.limit()` left in the chain reads like a deliberate decision
 * somebody already checked. A limit that is not a literal cannot be checked from here
 * at all — `.limit(ranged ? 5000 : 200)` is two reads wearing one coat — so it is not
 * a defence either.
 */
function limitedUnderTheCap(chain: string): boolean {
  const m = /\.limit\(\s*([0-9][0-9_]*)\s*\)/.exec(chain);
  return m !== null && Number(m[1].replace(/_/g, "")) <= SERVER_CAP;
}

/**
 * A read that cannot come back short however many rows match.
 *
 * THIS USED TO ACCEPT ANY `.limit(`, and that is how the Stop Analysis screen shipped
 * summing five days under the words "last 30 days". It read `production_downtimes`
 * — 15 263 rows — with `.limit(20_000)`, which the server cut to 1000 without a word,
 * and this guard waved it through because the chain contained a limit. 226h34m of
 * stopped time where the factory had stopped 2 679h. The limit was the symptom the
 * guard had been told to read as the cure.
 */
const cannotBeShort = (r: Read) =>
  limitedUnderTheCap(r.chain)
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
    for (const t of Object.keys(WATCHED)) {
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

  it("keeps the approaching list a waiting room, not a softer rule", () => {
    // Both ends matter. Under 500 and the table is years away, and watching it now
    // buys nothing but noise in this file. At 950 it has effectively arrived and
    // belongs in AT_THE_CAP, where the reason written beside it is the measurement
    // that it IS past the cap — leaving it here would make that reason untrue.
    for (const [table, rows] of Object.entries(APPROACHING)) {
      expect(rows, `${table} is too far out to watch yet`).toBeGreaterThan(500);
      expect(
        rows,
        `${table} has arrived — move it to AT_THE_CAP with its new count`,
      ).toBeLessThanOrEqual(950);
      expect(AT_THE_CAP[table], `${table} is in both maps`).toBeUndefined();
    }
  });

  it("counts a `.limit()` as a bound only when the server would honour it", () => {
    // The hole this guard shipped with. Without these four lines the exemption can be
    // widened back to "any limit at all" by one deleted condition, and the next screen
    // that asks for twenty thousand rows passes on the way to printing five days as
    // thirty.
    expect(limitedUnderTheCap(".limit(1)"), "a limit of one is a bound").toBe(true);
    expect(limitedUnderTheCap(".limit(1000)"), "the cap itself is a bound").toBe(true);
    expect(limitedUnderTheCap(".limit(1001)"), "one past the cap is a wish").toBe(false);
    expect(limitedUnderTheCap(".limit(20_000)"), "twenty thousand is a wish").toBe(false);
    expect(
      limitedUnderTheCap(".limit(ranged ? 5000 : 200)"),
      "a limit that is not a literal cannot be checked from here",
    ).toBe(false);
    expect(limitedUnderTheCap(".limit(pageSize)"), "nor can a variable").toBe(false);
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
        `${r.file} reads ${r.table} (${WATCHED[r.table]} rows) across a range without `
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
