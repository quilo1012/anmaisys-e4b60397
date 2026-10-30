/**
 * The one rule for "half day" on the Headcount board.
 *
 * A row is a half-day holiday when the board's own `half_day` is set, or when the
 * company sheet wrote "(half day)" beside the name — the import keeps that in
 * `sheet_tag`, and nothing ever turned it into `half_day`. Every reader (the chip's
 * badge, the Holidays column, print and export) asks this, so they cannot disagree.
 */
export function isHalfDay(a: { half_day?: boolean | null; sheet_tag?: string | null } | null | undefined): boolean {
  if (!a) return false;
  if (a.half_day === true) return true;
  return (a.sheet_tag ?? "").trim().replace(/\s+/g, " ").toLowerCase() === "half day";
}

/** Whether the tag on a row only says "half day" — shown as the badge, not repeated as a tag. */
export const isHalfDayTag = (tag: string | null | undefined) => isHalfDay({ sheet_tag: tag });

/** A row standing on a line (assigned or overtime with an area) that is also a half-day holiday. */
export function isWorkingHalfDay(a: { status: string; area_id: string | null; half_day?: boolean | null; sheet_tag?: string | null }): boolean {
  return (a.status === "assigned" || a.status === "overtime") && !!a.area_id && isHalfDay(a);
}
