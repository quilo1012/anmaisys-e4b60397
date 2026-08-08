/**
 * Pace of a line against what it should have made BY NOW.
 *
 * The board used to compare the shift's accumulated output against the whole
 * shift's plan. At five hours into a twelve-hour shift that is a comparison
 * against seven hours nobody has worked yet, so every line reads BELOW TARGET
 * in red and the floor stops looking. This measures against the target for the
 * time already elapsed instead.
 *
 * DEGRADED, KNOWINGLY: the elapsed time is NOT reduced by planned stops.
 * `planned_stop_minutes()` reads `production_downtimes`, which has had no rows
 * since 29/07, so it returns zero for every line and subtracting it would be
 * theatre. A line on Deep Clean is therefore charged for the cleaning. The error
 * is bounded by the planned stops in a shift — around an hour in twelve — where
 * the old comparison was out by every hour still to come. The screen says so
 * itself rather than leaving it to be discovered.
 *
 * Nothing here reads iTouching counts: `production_items.intouch_qty` has been
 * NULL in the whole history of the table, and the sync that would fill it is off
 * by an admin decision (it was deleting operator rows). `produced` is what a
 * person typed, and the caller shows how long ago they typed it.
 */

export const ON_TARGET_PCT = 95;
export const AT_RISK_PCT = 75;

/** Below this, the shift has not run long enough for a ratio to mean anything. */
export const WARMUP_MINUTES = 15;

export interface PaceItem {
  /** `sku_products.target_per_hour`. Null or 0 for the 203 active SKUs without one. */
  ratePerHour: number | null;
  /** `production_items.actual_qty` — typed by the operator. */
  produced: number;
  /** `production_items.started_at`. Null while the entry has not been saved. */
  startedAt: Date | null;
  /** `production_items.finished_at`. */
  finishedAt: Date | null;
  /** `production_items.planned_qty` — the shift commitment for this SKU. */
  plannedQty?: number | null;
}

export interface PaceInput {
  items: PaceItem[];
  shiftStart: Date;
  now: Date;
  /** A `production_sessions` row exists for this line/date/shift. */
  hasSession: boolean;
  /** That row carries a `leader_name`. */
  hasLeader: boolean;
}

export type PaceVerdict = "ON_TARGET" | "AT_RISK" | "BELOW_TARGET";

export type PaceResult =
  | { kind: "PACE"; verdict: PaceVerdict; pct: number; produced: number; expected: number }
  | { kind: "NO_SESSION" }
  | { kind: "NO_ORDER" }
  | { kind: "NO_LEADER" }
  | { kind: "NO_RATE" }
  | { kind: "WARMING_UP"; minutes: number };

/** What each non-measurable state tells the supervisor to go and fix. */
export const PACE_MESSAGES: Record<Exclude<PaceResult["kind"], "PACE">, string> = {
  NO_SESSION: "Line not started",
  NO_ORDER: "No order",
  NO_LEADER: "Nobody logged in on the line",
  NO_RATE: "SKU has no standard rate",
  WARMING_UP: "Starting up",
};

const MS_PER_MIN = 60_000;

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / MS_PER_MIN);
}

/**
 * Minutes this item can fairly be measured over.
 *
 * A finished entry carries both its times, so it is measured over its own run.
 * The open one is measured from when it started — or from the top of the shift
 * when nobody recorded a start, which is the common case while the shift runs:
 * `started_at` is filled at save time, and today Line 3 and Line 4 both have
 * output logged with no start time at all.
 */
function itemMinutes(item: PaceItem, shiftStart: Date, now: Date): number {
  const from = item.startedAt && item.startedAt > shiftStart ? item.startedAt : shiftStart;
  const to = item.finishedAt && item.finishedAt < now ? item.finishedAt : now;
  return minutesBetween(from, to);
}

export function computePace(input: PaceInput): PaceResult {
  const { items, shiftStart, now, hasSession, hasLeader } = input;

  // Order matters: each state names a different thing to go and fix, and the
  // outermost one is the one that has to be fixed first.
  if (!hasSession) return { kind: "NO_SESSION" };
  if (items.length === 0) return { kind: "NO_ORDER" };
  if (!hasLeader) return { kind: "NO_LEADER" };

  const rated = items.filter((i) => Number(i.ratePerHour) > 0);
  if (rated.length === 0) return { kind: "NO_RATE" };

  let expected = 0;
  for (const item of rated) {
    expected += (Number(item.ratePerHour) / 60) * itemMinutes(item, shiftStart, now);
  }

  // Two guards, not one. Early in a shift the ratio divides by something near
  // zero and a single unit reads as several hundred percent; and a line whose
  // rated items have all finished has nothing left to be measured against.
  const elapsed = minutesBetween(shiftStart, now);
  if (elapsed < WARMUP_MINUTES || expected < 1) {
    return { kind: "WARMING_UP", minutes: Math.floor(elapsed) };
  }

  // Produced counts EVERY item, including any without a rate: it is what the
  // line made. Only the expectation is restricted to what can be predicted.
  const produced = items.reduce((sum, i) => sum + Math.max(0, Number(i.produced) || 0), 0);
  const pct = (produced / expected) * 100;

  return {
    kind: "PACE",
    verdict: pct >= ON_TARGET_PCT ? "ON_TARGET" : pct >= AT_RISK_PCT ? "AT_RISK" : "BELOW_TARGET",
    // Not clamped at 100. A line running 130% of standard is worth seeing, and
    // the old screen's Math.min hid every one of them.
    pct,
    produced,
    expected,
  };
}

export const VERDICT_LABEL: Record<PaceVerdict, string> = {
  ON_TARGET: "ON PACE",
  AT_RISK: "AT RISK",
  BELOW_TARGET: "BEHIND PACE",
};

export const VERDICT_COLOR: Record<PaceVerdict, string> = {
  ON_TARGET: "bg-success",
  AT_RISK: "bg-warning",
  BELOW_TARGET: "bg-destructive",
};

/**
 * An order that is met or overshot reads COMPLETE, never a negative balance.
 * iTouching reports Order Balance below zero when a line runs past the order,
 * and "-412 remaining" is read on the floor as a shortfall.
 */
export function balanceLabel(plannedQty: number | null | undefined, produced: number): string {
  const plan = Number(plannedQty ?? 0);
  if (plan <= 0) return "—";
  const left = plan - Math.max(0, Number(produced) || 0);
  return left <= 0 ? "COMPLETE" : String(Math.round(left));
}

/**
 * Minutes since the most recent operator entry, or null when nothing was typed.
 * Shown beside the figure because it is the difference between "the line made
 * this" and "somebody last told us this two hours ago".
 */
export function lastEntryAgeMinutes(updatedAts: Array<string | Date | null | undefined>, now: Date): number | null {
  const times = updatedAts
    .map((v) => (v ? new Date(v).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  return Math.max(0, Math.floor((now.getTime() - Math.max(...times)) / MS_PER_MIN));
}
