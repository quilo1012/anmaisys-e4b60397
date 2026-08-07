/**
 * A shift nobody's rota covers is overtime, and the board has to say so.
 *
 * On Friday 07/08 eleven people were on the night board. No night rota covers a Friday
 * — *Mon–Thu nights* is the only one, and it is [1,2,3,4] — so every one of them was
 * working a shift they were not due to work. Ten were saved as `assigned`. One was
 * `overtime`, because somebody happened to drag him onto the Overtime card by hand.
 *
 * `assigned` and `overtime` are not two ways of saying "at work". The finance close
 * reads them differently, so ten people's extra night was recorded as an ordinary one
 * and paid as an ordinary one. Nothing on the board looked wrong: the names were in
 * the right columns, on the right day, in the right shift.
 *
 * The rota already knows. `worksOn` is the same test the roster uses to decide who to
 * offer for a day; this just carries the answer through to what gets written, so the
 * default is the truth and the override is the exception rather than the reverse.
 *
 * Deliberately NOT inferred:
 *
 * - **No rota recorded** — unknown is not off. Following the roster's own rule
 *   ("someone with no rota recorded is kept: that is unknown, not off"), they stay
 *   `assigned`. Guessing overtime for the people whose rota nobody has filled in would
 *   pay them for it.
 * - **Anything already away** — holiday, sick and unpaid are statements about the
 *   person, not about the rota, and are never rewritten.
 * - **Overtime already set** — a manual mark always survives.
 */

export type AllocStatus = "assigned" | "overtime" | "holiday" | "sick" | "unpaid";

export interface RotaCover {
  /** Whether a rota is recorded at all. False means unknown, which is not "off". */
  known: boolean;
  /** Whether that rota's weekdays include this date. */
  coversDay: boolean;
  /**
   * Whether the person's crew is the board they are being placed on. A day-crew person
   * on the night board is off their rota even on a weekday their rota covers.
   */
  onThisBoard: boolean;
}

/**
 * Whether this placement is somebody working outside their rota.
 *
 * Unknown rota is never off-rota — see the note above.
 */
export function isOffRota(cover: RotaCover): boolean {
  if (!cover.known) return false;
  return !cover.coversDay || !cover.onThisBoard;
}

/**
 * What to write for a placement.
 *
 * `requested` is what the drop asked for; `current` is what the row already says, so a
 * mark made by hand is not undone by a later drag between areas.
 */
export function statusForPlacement(
  requested: AllocStatus,
  current: AllocStatus | null | undefined,
  cover: RotaCover,
): AllocStatus {
  // Away statuses say something about the person, not about the rota.
  if (requested !== "assigned") return requested;
  // An existing overtime mark is a decision somebody made. Moving them between lines
  // must not cancel it.
  if (current === "overtime") return "overtime";
  return isOffRota(cover) ? "overtime" : "assigned";
}
