/**
 * The engineers' table, scored on measured time rather than on its absence.
 *
 * Half the score for answering, half for fixing: full marks at the target, none at
 * four times it, a straight line between. That shape replaced a lifetime accumulator
 * that stopped at 100, where rewards did nothing and only penalties still bit.
 *
 * WHAT THIS FILE IS FOR. The averages were computed as
 *
 *     avgResponse: e.respCount ? Math.round(e.totalResp / e.respCount) : 0
 *
 * so an engineer whose completed orders carry no timing at all got **zero**, and zero
 * reads to `band` as instant: `band(0, 30)` and `band(0, 60)` both saturate at 50, for
 * a perfect 100. Somebody with no measured times ranked first, above everybody whose
 * times were actually recorded. The existing guard did not catch it — it asks whether
 * any order was completed, and these orders were completed; what is missing is the
 * measurement, not the work.
 *
 * Absent is now absent. An average with nothing behind it is null, and a score needs
 * both halves: scoring one half and not the other would put a half-measured engineer
 * on the same axis as a fully measured one, which is the same mistake in a quieter
 * shape.
 */

/** What the page has already summed per engineer, before any average is taken. */
export interface EngineerTotals {
  name: string;
  /** Orders this engineer closed in the period. */
  completed: number;
  /** Minutes summed, and how many orders actually carried the number. */
  totalResp: number;
  respCount: number;
  totalMTTR: number;
  mttrCount: number;
}

export interface RankedEngineer {
  name: string;
  completed: number;
  /** Null when no completed order carried a time — not zero, which means instant. */
  avgResponse: number | null;
  avgMTTR: number | null;
  /** Null when there is nothing to score, so the screen can say so. */
  score: number | null;
}

/** Response target: 30 minutes. Repair target: 60. Both from `SLA_TARGETS`' shape. */
export const RESPONSE_TARGET_MIN = 30;
export const REPAIR_TARGET_MIN = 60;

/**
 * Half a score, out of 50: full at the target, nothing at four times it.
 *
 * Exported for the test, which is where the saturation at zero has to stay pinned —
 * `band` is correct in itself, and the bug was in what was handed to it.
 */
export function band(value: number, target: number): number {
  return Math.max(0, Math.min(50, Math.round(50 * (1 - (value - target) / (target * 3)))));
}

function average(total: number, count: number): number | null {
  return count > 0 ? Math.round(total / count) : null;
}

export function rankEngineers(totals: EngineerTotals[]): RankedEngineer[] {
  return totals
    .map((e) => {
      const avgResponse = average(e.totalResp, e.respCount);
      const avgMTTR = average(e.totalMTTR, e.mttrCount);
      const scorable = e.completed > 0 && avgResponse !== null && avgMTTR !== null;
      return {
        name: e.name,
        completed: e.completed,
        avgResponse,
        avgMTTR,
        score: scorable
          ? band(avgResponse, RESPONSE_TARGET_MIN) + band(avgMTTR, REPAIR_TARGET_MIN)
          : null,
      };
    })
    // Unscored last, then by score, then by how much was actually done.
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.completed - a.completed);
}

/**
 * Why somebody has no score, in the words the table prints.
 *
 * Two different situations were both reading "no orders": an engineer who closed
 * nothing, and an engineer who closed plenty with no times recorded. The second is a
 * gap in the data somebody can go and fix, and calling it "no orders" hides it.
 */
export function noScoreReason(e: Pick<RankedEngineer, "completed" | "avgResponse" | "avgMTTR">): string {
  if (e.completed === 0) return "no orders";
  return "no times recorded";
}
