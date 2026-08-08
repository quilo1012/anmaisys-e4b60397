import type { AllocStatus } from "@/lib/rotaStatus";

/**
 * Who leads a column is a fact about the column, not about the person.
 *
 * `daily_allocations_one_leader_per_area` is a unique index over (on_date, shift,
 * area_id) where `is_leader`, so the mark belongs to the square somebody is standing
 * in. Any write that moves them and leaves the mark alone carries it into the next
 * column — and if that column already has a leader, Postgres refuses the whole
 * statement. On 08/08 the Day board had Izildo Sarto leading Line 1 and Murilo
 * Goncalves leading Line 2, and three times that evening a supervisor dragging one
 * card got "duplicate key value violates unique constraint
 * daily_allocations_one_leader_per_area", in those words. Nothing saved, and nothing
 * said what to do about it.
 *
 * So the mark is dropped by the same write that moves them. Leaving the column, or
 * stopping working the day at all, ends it; it is claimed on the column itself, and
 * one press puts it back. Shared between the board and the spreadsheet import because
 * both write `area_id` and the rule has to be the same in both — the import moves
 * eighty people at once, which is the write that can least afford to be refused.
 */
export function keepsLeadership(
  /** What the row already says, or null when the day holds nothing about them yet. */
  prev: { area_id?: string | null; is_leader?: boolean | null } | null | undefined,
  /** What is about to be written. */
  next: { areaId: string | null; status: AllocStatus },
): boolean {
  return (
    prev?.is_leader === true
    && (next.status === "assigned" || next.status === "overtime")
    && next.areaId !== null
    && next.areaId === (prev?.area_id ?? null)
  );
}
