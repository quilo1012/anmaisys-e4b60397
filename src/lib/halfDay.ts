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

type Row = { employee_id: string; status: string; area_id: string | null; half_day?: boolean | null; sheet_tag?: string | null };

/**
 * Who the Holidays column draws: every `holiday` row, then every working half day as
 * a mirror (`mirrorOf` = the area they are on). `own` is what the column itself holds;
 * the mirrors are counted on their line, so the column says "7 + 1 half day".
 */
export function holidayColumn<R extends Row>(allocations: ReadonlyArray<R>) {
  const own = allocations.filter((a) => a.status === "holiday");
  const mirrors = allocations.filter((a) => isWorkingHalfDay(a));
  return {
    own,
    mirrors,
    countLabel: mirrors.length ? `${own.length} + ${mirrors.length} half day` : String(own.length),
  };
}

/**
 * What dropping somebody onto a board target writes. Overtime keeps being overtime
 * on a line; marking overtime keeps the area; and a half day stays a half day when
 * the person lands on a line or back in Holidays. `keptHalfDayOn` is set when a
 * half-day holiday has just been put on a line, for the "kept" message.
 */
export function placementForDrop(
  current: Row | null | undefined,
  target: { areaId: string | null; status: string },
): { areaId: string | null; status: string; halfDay?: true; keptHalfDayOn?: string } {
  const status = target.status === "assigned" && current?.status === "overtime" ? "overtime" : target.status;
  const areaId = target.status === "overtime" ? target.areaId ?? current?.area_id ?? null : target.areaId;
  const half = isHalfDay(current) && (status === "assigned" || status === "overtime" || status === "holiday");
  return {
    areaId, status,
    ...(half ? { halfDay: true as const } : {}),
    ...(half && areaId && current?.status === "holiday" ? { keptHalfDayOn: areaId } : {}),
  };
}
