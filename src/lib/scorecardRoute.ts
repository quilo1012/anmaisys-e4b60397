import type { ScorecardPeriod } from "@/lib/leaderScorecard";

/**
 * The address of one leader's scorecard.
 *
 * It used to be a dialog on Production Performance, reachable one way and gone the
 * moment you navigated. As a route it can be linked, bookmarked, printed and sent to
 * the person it is about — and the leader board and this card now live under one
 * path, `/dashboard/leader-scorecard`, instead of being a page in the menu and a
 * modal somewhere else.
 *
 * Which means the address will eventually arrive hand-edited, truncated by a mail
 * client, or a month stale. Everything here is about refusing to render a scorecard
 * about the wrong person, or over a period nobody chose.
 */

const BASE = "/dashboard/leader-scorecard";

/**
 * `YYYY-MM-DD`, and a real day — `2026-02-31` parses in JS and is not a date.
 *
 * Built at UTC midnight on purpose. `new Date("2026-08-01T00:00:00")` is LOCAL
 * midnight, and in London under BST that is 23:00 on 31 July, so round-tripping it
 * through `toISOString()` rejected every valid date by one day — and a rejected date
 * silently became "today", which is a scorecard over the wrong period.
 */
function isIsoDate(v: string | null | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * The period a screen hands to the scorecard: its dates, and deliberately not its shift.
 *
 * Production Performance opens pinned to the shift running right now — it never opens
 * on "all". Passing that through meant a leader who works days, looked up during the
 * night shift, showed "No quality action was raised against this leader in this
 * period" about somebody with a month of actions behind them. It was not wrong so
 * much as unanswerable: nothing on the card said a shift had been applied.
 *
 * A scorecard is about a person, and their actions are theirs on whichever shift they
 * were raised. The card can still be narrowed to one shift — `?shift=NIGHT` is read
 * back by `parseScorecardParams` — but that is now something you ask for, not
 * something the clock decides for you.
 */
export function scorecardLinkPeriod(from: string, to: string): ScorecardPeriod {
  return { from, to, shift: "all" };
}

/** The link the Production Performance button carries: this leader, this period. */
export function scorecardPath(leader: string, period: ScorecardPeriod): string {
  const q = new URLSearchParams({ from: period.from, to: period.to });
  // "all" is the default the reader assumes, so leaving it out keeps the link short
  // and means an address without a shift cannot be read as a shift being selected.
  if (period.shift !== "all") q.set("shift", period.shift);
  return `${BASE}/${encodeURIComponent(leader)}?${q.toString()}`;
}

/**
 * Read the address back, with a defensible answer for every way it can be wrong.
 *
 * `today` is passed in rather than read from the clock so this stays a pure function
 * — the same reason the rest of this module's rules are testable at all.
 */
export function parseScorecardParams(
  leaderParam: string | undefined,
  search: URLSearchParams,
  today: string,
): { leader: string | null; from: string; to: string; shift: "all" | "DAY" | "NIGHT" } {
  const leader = (leaderParam ?? "").trim() || null;

  // A missing or unreadable date falls back to today, never to "everything". A link
  // that lost its query string must not quietly report on a leader's whole history.
  const rawFrom = search.get("from");
  const rawTo = search.get("to");
  let from = isIsoDate(rawFrom) ? rawFrom : today;
  let to = isIsoDate(rawTo) ? rawTo : today;
  // Hand-edited backwards. Swapping beats rendering an empty card that looks like a
  // leader with nothing against them.
  if (from > to) [from, to] = [to, from];

  const rawShift = (search.get("shift") ?? "").trim().toUpperCase();
  const shift = rawShift === "DAY" || rawShift === "NIGHT" ? rawShift : "all";

  return { leader, from, to, shift };
}
