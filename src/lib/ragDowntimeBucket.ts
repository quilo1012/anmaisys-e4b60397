import { getShift, shiftSessionDate } from "./shifts";

export type RagShift = "DAY" | "NIGHT";

/**
 * Which cell of the RAG week a downtime event belongs to.
 *
 * The RAG week aggregates two kinds of row into the same cell. Production sessions
 * arrive with the factory's own `session_date` and `shift` already written on them.
 * Downtime events arrive as a bare `stopped_at` and have to be filed — and filing
 * them by a different rule than the sessions use is how one cell ends up holding a
 * day's production beside a night's downtime.
 *
 * This exists so there is one rule instead of two. It defers entirely to `getShift`
 * and `shiftSessionDate`, which is what the rest of the app already uses:
 *
 *   - The hour comes from `Intl` over `Europe/London`, so the answer is right in
 *     October as well as in July. What was here before added a fixed `+1` for BST,
 *     which moved the whole 17:00–18:00 handover onto the night crew, and the whole
 *     05:00–06:00 handover onto the day crew, for the five months of GMT.
 *   - The date comes from `shiftSessionDate`, so a stop at 00:30 belongs to the night
 *     that started the evening before — the same day the session rows already carry.
 *     `format(dt, "yyyy-MM-dd")` dated it the following morning, which sent the
 *     downtime to the next column while its production stayed put.
 *
 * Both were invisible in summer, which is when the code was written.
 */
export function ragDowntimeBucket(stoppedAt: string | Date): { date: string; shift: RagShift } {
  const shift: RagShift = getShift(stoppedAt) === "day" ? "DAY" : "NIGHT";
  return { date: shiftSessionDate(stoppedAt, shift), shift };
}
