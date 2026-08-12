/**
 * What one machine's reading from `getmachineStatuses` actually says.
 *
 * WHY THIS IS ITS OWN FILE. It is the one decision in the poll that every screen
 * downstream inherits and none of them can undo: whatever this returns is what
 * gets written to `intouch_machine_map`, and the board, the wallboard and the
 * live view all read the column, not the API. When this was three lines inside a
 * 1,000-line handler it was also untested, and it was wrong.
 *
 * THE RULE, AND THE ONE IT REPLACES. An active DowntimeCode is a stop, whatever
 * the status says. The poll used to do the opposite — a code arriving on status 1
 * or 2 was DELETED before it was stored, unless the code required a work order:
 *
 *     currentDowntimeCode = currentIsHealthy && !maintenanceCodeWhileHealthy
 *       ? null : rawDowntimeCode
 *
 * On 12/08 at 10:45 UTC the API answered, for Filler Line 4:
 * `{"Status": 1, "DowntimeCode": "23EEA244-D79C-4D43-AA7E-05C25D69CC64"}` — Deep
 * Clean, planned, `requires_wo = false`. The code was thrown away, the column
 * went null, and the board read the only witness left, the status: RUNNING, in
 * green, while the iTouching screen two metres away showed "Deep Clean 1:35:45"
 * on a line making nothing with no order loaded. The same deletion is why Line 4
 * has no `production_downtimes` row since 02:06 while every other line logged one
 * up to 10:16 — the clean was never measured, so `planned_stop_minutes()` cannot
 * deduct it from the time that line is judged on.
 *
 * WHY THE CODE CAN BE BELIEVED. The worry the old rule answered was a stale code
 * left behind on a machine that had resumed. iTouching does not leave one: a
 * machine standing still with nothing selected sends the EMPTY STRING, and five
 * did in that same response — Lines 2, 3 and 6, Capsules MC 1 and the Tablet
 * Line, all at status 4 with `"DowntimeCode": ""`. The field is cleared when the
 * reason goes away, so a code that is present is a reason somebody selected.
 *
 * WHAT THE STATUS IS STILL FOR. Everything it was for before, minus this. It
 * remains the only witness when there is NO code, which is how a line reads
 * STOPPED · NO CODE instead of green — see `lineLiveStatus.ts`. And it is still
 * stored raw, because what 4 means apart from 6 is an open question with the
 * vendor and no reading should be rounded off before they answer it.
 *
 * This is also the rule `wallboard-lines` and `classifyLive` have always applied
 * — code first, status only in its absence. They were reading a column the poll
 * had already emptied.
 */

export interface StopReadingInput {
  /** `Status` from the API. Null when it does not parse. */
  status: number | null;
  /** `DowntimeCode` verbatim. `""` when no stop is active, null when absent. */
  rawCode: string | null;
  /**
   * `intouch_stop_code_map.requires_wo` for that code — an admin's standing
   * decision about whether this stop calls out an engineer. It no longer decides
   * WHETHER the stop is recorded, only which ledger takes it further up.
   */
  requiresWo: boolean;
}

export interface StopReading {
  /**
   * What to persist in `last_downtime_code`, verbatim — including the empty
   * string, which is iTouching's own way of saying "no reason active" and is not
   * the same fact as null, which says "the field never arrived".
   */
  code: string | null;
  /** True when a reason is active on the panel. */
  isDown: boolean;
  /** Kept for the caller that still has to choose a ledger. */
  requiresWo: boolean;
}

export function readStop({ status: _status, rawCode, requiresWo }: StopReadingInput): StopReading {
  const active = String(rawCode ?? "").trim().length > 0;
  return { code: rawCode ?? null, isDown: active, requiresWo };
}

/** The statuses that mean the machine is making something, when nothing else says otherwise. */
export const HEALTHY_STATUS = new Set<number>([1, 2]);
