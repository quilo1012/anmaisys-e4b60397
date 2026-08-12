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
 * That caveat now carries more weight than it used to: since 09/08 the idle
 * time between orders — and after the last one closes — is charged against the
 * line (see `idleMinutes` below), specifically so a line with no open order
 * stops reading a frozen, flattering pace. With `production_downtimes` empty,
 * a real Deep Clean or changeover reads exactly like idleness, because nothing
 * in this database currently says otherwise.
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
  /**
   * The shift's plan for this line (RAG Weekly `plan_qty`). Caps the
   * expectation: nobody is "due" more than the day's commitment.
   * Omitted or <= 0 leaves the expectation uncapped.
   */
  planTarget?: number | null;
}

export type PaceVerdict = "ON_TARGET" | "AT_RISK" | "BELOW_TARGET";

export type PaceResult =
  | {
      kind: "PACE";
      verdict: PaceVerdict;
      pct: number;
      produced: number;
      expected: number;
      /** Shift minutes inside [shiftStart, now] with no rated order open. */
      idleMinutes: number;
      /** How many rated items are still open right now. Zero means the line has
       *  stopped and the expectation is running on idle time alone. */
      ordersOpen: number;
    }
  | { kind: "NO_SESSION" }
  | { kind: "NO_ORDER" }
  | { kind: "NO_LEADER" }
  | { kind: "NO_RATE" }
  | { kind: "NOTHING_LOGGED" }
  | { kind: "WARMING_UP"; minutes: number };

export type PaceGap = Exclude<PaceResult["kind"], "PACE">;

/** What each non-measurable state tells the supervisor to go and fix. */
export const PACE_MESSAGES: Record<PaceGap, string> = {
  NO_SESSION: "Line not started",
  NO_ORDER: "No order",
  NO_LEADER: "Nobody logged in on the line",
  NO_RATE: "SKU has no standard rate",
  NOTHING_LOGGED: "No output logged yet",
  WARMING_UP: "Starting up",
};

/**
 * The same states in the two words that fit the plate at the top of the card.
 *
 * All five used to arrive there as "No reading", which names the board's
 * problem and not the floor's. A line with no order and a line whose SKU was
 * never given a standard rate need two different people to do two different
 * things, and the plate is where that is read from across the room.
 */
export const PACE_STATUS: Record<PaceGap, string> = {
  NO_SESSION: "Not started",
  NO_ORDER: "No order",
  NO_LEADER: "No leader",
  NO_RATE: "No standard",
  NOTHING_LOGGED: "Not logged",
  WARMING_UP: "Starting up",
};

/**
 * Whether a state is somebody's job right now.
 *
 * A line waiting on an order and a line whose output nobody has typed are both
 * unmeasurable, but only one of them has someone to chase. The first is grey;
 * the second carries the amber rail, because going unnoticed is the whole risk.
 */
export const PACE_NEEDS_ACTION: Record<PaceGap, boolean> = {
  NO_SESSION: false,
  NO_ORDER: false,
  NO_LEADER: true,
  NO_RATE: true,
  NOTHING_LOGGED: true,
  WARMING_UP: false,
};

const MS_PER_MIN = 60_000;

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / MS_PER_MIN);
}

/**
 * The window this item can fairly be measured over, clamped to [shiftStart, now].
 *
 * A finished entry carries both its times, so it is measured over its own run.
 * The open one is measured from when it started — or from the top of the shift
 * when nobody recorded a start, which is the common case while the shift runs:
 * `started_at` is filled at save time, and today Line 3 and Line 4 both have
 * output logged with no start time at all.
 *
 * `from` can land after `to` — a `startedAt` recorded after `now` (a clock
 * skew, or simply an item that has not actually begun as of the instant being
 * read) — and that is left for the caller: `itemMinutes` floors it at zero,
 * `unionMinutes` treats it as no coverage at all, which is correct — an item
 * that has not started yet is not covering the shift.
 */
function itemWindow(item: PaceItem, shiftStart: Date, now: Date): { from: Date; to: Date } {
  const from = item.startedAt && item.startedAt > shiftStart ? item.startedAt : shiftStart;
  const to = item.finishedAt && item.finishedAt < now ? item.finishedAt : now;
  return { from, to };
}

function itemMinutes(item: PaceItem, shiftStart: Date, now: Date): number {
  const { from, to } = itemWindow(item, shiftStart, now);
  return minutesBetween(from, to);
}

/**
 * Total minutes covered by the union of a set of windows — overlaps counted
 * once. Tablet Line, 09/08: SOLGUT ran 05:20–11:50 as the day's only order; the
 * 20 minutes before it started and everything after it finished have no window
 * covering them at all, and that gap is what `computePace` now charges as idle.
 *
 * This has exactly one caller. It stays here rather than in a shared util
 * because nothing else in the app unions time intervals.
 */
function unionMinutes(windows: Array<{ from: Date; to: Date }>): number {
  const spans = windows
    .filter((w) => w.to > w.from)
    .map((w) => ({ from: w.from.getTime(), to: w.to.getTime() }))
    .sort((a, b) => a.from - b.from);

  let total = 0;
  let curFrom = 0;
  let curTo = 0;
  let open = false;
  for (const span of spans) {
    if (!open) {
      curFrom = span.from;
      curTo = span.to;
      open = true;
    } else if (span.from > curTo) {
      total += curTo - curFrom;
      curFrom = span.from;
      curTo = span.to;
    } else if (span.to > curTo) {
      curTo = span.to;
    }
  }
  if (open) total += curTo - curFrom;

  return total / MS_PER_MIN;
}

export function computePace(input: PaceInput): PaceResult {
  const { items, shiftStart, now, hasSession, hasLeader, planTarget } = input;

  // Order matters: each state names a different thing to go and fix, and the
  // outermost one is the one that has to be fixed first.
  if (!hasSession) return { kind: "NO_SESSION" };
  if (items.length === 0) return { kind: "NO_ORDER" };
  if (!hasLeader) return { kind: "NO_LEADER" };

  const rated = items.filter((i) => Number(i.ratePerHour) > 0);
  if (rated.length === 0) return { kind: "NO_RATE" };

  const windows = rated.map((item) => itemWindow(item, shiftStart, now));

  // coveredExp is a sum over items, and stays a sum even when two windows
  // overlap — unchanged from before the idle charge. Line 3, 09/08 sometimes
  // carries two open SKUs at once; double-counting that overlap here is an
  // existing, separate wart and out of scope for this fix.
  let coveredExp = 0;
  rated.forEach((item, i) => {
    coveredExp += (Number(item.ratePerHour) / 60) * minutesBetween(windows[i].from, windows[i].to);
  });

  const elapsed = minutesBetween(shiftStart, now);

  // Tablet Line, 09/08: SOLGUT ran 05:20–11:50, one order all day. At 14:00Z
  // the old code froze the expectation at 11:50 and printed PACE 115% for an
  // idle line. The clock does not stop: every minute of the shift with no
  // rated order open — before the first item starts, between two items, or
  // after the last one closes — is now charged against the line, at the rate
  // of whichever rated item's window ends latest (the product the line was
  // last set up for). `idleRate` always exists here: NO_RATE above guarantees
  // at least one rated item.
  let idleRate = Number(rated[0].ratePerHour);
  let idleRateAt = windows[0].to.getTime();
  for (let i = 1; i < rated.length; i++) {
    const to = windows[i].to.getTime();
    if (to >= idleRateAt) {
      idleRate = Number(rated[i].ratePerHour);
      idleRateAt = to;
    }
  }

  // idleMinutes uses the UNION of the windows, not their sum, so the same
  // overlap that double-counts coveredExp can never manufacture idle time out
  // of it.
  const idleMinutes = Math.max(0, elapsed - unionMinutes(windows));
  const idleExp = (idleRate / 60) * idleMinutes;

  const rawExpected = coveredExp + idleExp;
  const plan = Number(planTarget) || 0;
  // Capped at the shift's plan: past that point nobody is "due" any more, so
  // a line that finished its 7,300-unit plan by 11:50 and then sat idle for
  // the rest of the day is not marked down for the hours after it was done.
  // Omitted or <= 0 (today's callers, until the screens are wired) leaves the
  // expectation uncapped, exactly as before this change.
  const expected = plan > 0 ? Math.min(rawExpected, plan) : rawExpected;

  // Two guards, not one. Early in a shift the ratio divides by something near
  // zero and a single unit reads as several hundred percent; and a line whose
  // rated items have all finished has nothing left to be measured against.
  if (elapsed < WARMUP_MINUTES || expected < 1) {
    return { kind: "WARMING_UP", minutes: Math.floor(elapsed) };
  }

  // Produced counts EVERY item, including any without a rate: it is what the
  // line made. Only the expectation is restricted to what can be predicted.
  const produced = items.reduce((sum, i) => sum + Math.max(0, Number(i.produced) || 0), 0);

  // Nothing typed all shift is not a measured zero.
  //
  // Nothing in this system distinguishes a line that made nothing from a line
  // whose output nobody has entered, and dividing 0 by the expectation asserts
  // the first. On 08/08 that put Line 1 at 0%, red, CRITICAL, while iTouching
  // had the machine blending seconds earlier — and the page carried a banner
  // underneath explaining the 0% was "not necessarily because nothing was
  // made". The state that needed naming was the absence of the entry, which
  // is also the only thing anyone can act on.
  //
  // One unit is enough to be a measurement: after that the line is being
  // reported on and a bad number is the news.
  if (produced === 0) return { kind: "NOTHING_LOGGED" };

  const pct = (produced / expected) * 100;

  // An item counts as open when it has no finishedAt yet, or its finishedAt
  // has not arrived as of `now` — the same test `itemWindow` uses to decide
  // whether an item's window still reaches `now`.
  const ordersOpen = rated.filter((i) => i.finishedAt === null || i.finishedAt >= now).length;

  return {
    kind: "PACE",
    verdict: pct >= ON_TARGET_PCT ? "ON_TARGET" : pct >= AT_RISK_PCT ? "AT_RISK" : "BELOW_TARGET",
    // Not clamped at 100. A line running 130% of standard is worth seeing, and
    // the old screen's Math.min hid every one of them.
    pct,
    produced,
    expected,
    idleMinutes,
    ordersOpen,
  };
}

/**
 * What the line card's big figure IS, and therefore what colours it.
 *
 * The card prints two different measurements under two different words. When the
 * shift can be paced it prints PACE — output against the time already worked. When
 * it cannot, it falls back to OF PLAN — output against the whole shift's plan.
 *
 * The colour used to be decided separately from that, and the two came apart on
 * 09/08: Line 3 had made 4,799 against a 3,338 plan and the card printed
 * "OF PLAN 144%" in grey, because `UAEABECIB` has no standard rate and so the PACE
 * could not be computed. A card that prints a number and then refuses to say
 * whether it is good has withheld the only thing it was asked. The rate being
 * missing is a real fault and it is still named, in amber, in the footer — but it
 * is a fault about the SKU, not a reason to disown the line's own output.
 *
 * So there is one rule: colour whatever figure is on screen, on that figure's own
 * thresholds — 95/75 for a pace, 100/80 for a share of the plan, which are the two
 * pairs already in use on this floor.
 */
export type ScoreBand = "GO" | "HOLD" | "STOP";

/** Which of the two questions the figure answers. */
export type ScoreBasis = "PACE" | "PLAN";

export interface LineScore {
  basis: ScoreBasis;
  /** The percentage the band was decided on. Never clamped. */
  pct: number;
  band: ScoreBand;
  /**
   * How much of the shift's plan is made: `actual / target`. Zero when there is
   * no plan to be a share of.
   *
   * The card prints THIS as its big figure, and the pace beside it in small.
   * Both were already on the card — the pace as a bare "60%" and the share as
   * the fill of the bar under it — but only one of them was a number, and it
   * was the one nobody could check against the sheet. Equal to `pct` whenever
   * the plan is also the basis, which is every closed period.
   */
  attainedPct: number;
}

export const PLAN_ON_TARGET_PCT = 100;
export const PLAN_AT_RISK_PCT = 80;

/**
 * Null when there is nothing on the card worth colouring.
 *
 * That is the case the grey was invented for and it survives untouched: a line
 * with a plan and nothing typed reads 0%, and nothing in this system can tell that
 * apart from a line that made nothing. Colouring it red asserts the first.
 *
 * @param pace `undefined` when the view is a week or a month, where "by now" is not
 *   a question — the period is over and the whole plan was the target.
 */
/**
 * Verde, âmbar ou vermelho, num sítio só.
 *
 * Os dois limiares dependem do que se está a medir, e é essa a única diferença: contra
 * o PLANO de um período fechado, 100% é ter feito o que estava planeado; contra o que
 * já era devido a esta hora do turno, a fábrica trabalha a 95/75, que são os números
 * pintados no chão.
 *
 * Extraído para que o painel inteiro e um cartão não possam discordar. O ecrã diz
 * VERDE com a mesma conta que faz um cartão dizer verde — se um dia forem duas contas,
 * é o ecrã que perde a autoridade, porque é o que se lê de longe e não se confere.
 */
export function scoreBand(basis: ScoreBasis, pct: number): ScoreBand {
  const onTarget = basis === "PACE" ? ON_TARGET_PCT : PLAN_ON_TARGET_PCT;
  const atRisk = basis === "PACE" ? AT_RISK_PCT : PLAN_AT_RISK_PCT;
  return pct >= onTarget ? "GO" : pct >= atRisk ? "HOLD" : "STOP";
}

export function lineScore(
  pace: PaceResult | undefined,
  target: number,
  actual: number,
): LineScore | null {
  const attainedPct = target > 0 ? (actual / target) * 100 : 0;

  if (pace?.kind === "PACE") {
    return { basis: "PACE", pct: pace.pct, band: scoreBand("PACE", pace.pct), attainedPct };
  }

  // A pace was asked for and could not be given. The plan comparison stands in,
  // but only once something has actually been logged against it.
  if (pace && !(target > 0 && actual > 0)) return null;

  return { basis: "PLAN", pct: attainedPct, band: scoreBand("PLAN", attainedPct), attainedPct };
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
