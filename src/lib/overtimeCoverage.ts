import {
  askHasStarted, placesTaken,
  type OvertimeRequest, type OvertimeResponse,
} from "@/lib/overtimeRequests";
import { askShift, type OvertimeShift } from "@/lib/overtimeShifts";

/**
 * How well a period's overtime asks are covered — the Production dashboard's overtime
 * row, counted by the rules the overtime screen already uses.
 *
 * - A place is **filled** by somebody accepted and still coming (`placesTaken`, the
 *   same count the database refuses an accept past, BLOCO 101). Somebody who called in
 *   sick has given their place back.
 * - **Still to fill** is only on asks that are open and have not started. A closed ask
 *   was filled by the supervisor's say-so; a started one can no longer be filled.
 * - **Worked** is an outcome of `attended` — what happened, not what was planned.
 * - Cancelled asks are counted apart and never in the places.
 */
export interface OvertimeCoverage {
  asks: number;
  cancelled: number;
  /** People booked and still coming, on every ask. */
  booked: number;
  /** Places asked for — only asks that carry a number (from before BLOCO 102). */
  placesWanted: number;
  /** Booked people on those numbered asks, at most their number. */
  placesFilled: number;
  /** Free places on numbered asks that are open and not started. */
  stillToFill: number;
  /** Yes answers on open asks nobody has decided on. */
  awaitingDecision: number;
  worked: number;
  /** Booked per board, with the numbered places beside it where there are any. */
  byShift: Record<OvertimeShift, { booked: number; wanted: number; filled: number }>;
  /**
   * Open, not started, and short: a numbered ask with places left, or an ask with no
   * number that nobody has said yes to yet (`left` null). Soonest first.
   */
  unfilled: Array<{ request: OvertimeRequest; left: number | null }>;
}

export function overtimeCoverage(
  requests: readonly OvertimeRequest[],
  responsesByRequest: ReadonlyMap<string, readonly OvertimeResponse[]>,
  outcomeOf: (responseId: string) => string | undefined,
  now: Date = new Date(),
): OvertimeCoverage {
  const out: OvertimeCoverage = {
    asks: 0, cancelled: 0, booked: 0, placesWanted: 0, placesFilled: 0, stillToFill: 0,
    awaitingDecision: 0, worked: 0,
    byShift: { Day: { booked: 0, wanted: 0, filled: 0 }, Night: { booked: 0, wanted: 0, filled: 0 } },
    unfilled: [],
  };
  for (const r of requests) {
    if (r.status === "cancelled") { out.cancelled += 1; continue; }
    const responses = responsesByRequest.get(r.id) ?? [];
    const taken = placesTaken(responses, outcomeOf);
    const shift = askShift(r);
    out.asks += 1;
    out.booked += taken;
    out.byShift[shift].booked += taken;
    if (r.headcount != null) {
      const filled = Math.min(r.headcount, taken);
      out.placesWanted += r.headcount;
      out.placesFilled += filled;
      out.byShift[shift].wanted += r.headcount;
      out.byShift[shift].filled += filled;
    }
    out.worked += responses.filter((x) => outcomeOf(x.id) === "attended").length;

    const live = r.status === "open" && !askHasStarted(r, now);
    if (live) {
      out.awaitingDecision += responses.filter((x) => x.answer === "yes" && !x.decision).length;
      if (r.headcount == null) {
        if (taken === 0) out.unfilled.push({ request: r, left: null });
      } else {
        const left = r.headcount - Math.min(r.headcount, taken);
        if (left > 0) {
          out.stillToFill += left;
          out.unfilled.push({ request: r, left });
        }
      }
    }
  }
  out.unfilled.sort((a, b) =>
    a.request.on_date.localeCompare(b.request.on_date) || a.request.starts_at.localeCompare(b.request.starts_at));
  return out;
}
