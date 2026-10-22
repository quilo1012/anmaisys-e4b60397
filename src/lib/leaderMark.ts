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

/**
 * Whether somebody's job is to lead a line.
 *
 * Read off `position`. "Team Leader" used to sit in `department`, and the board still
 * looked for it there after #393 moved every job title into `position` — so from 07/08
 * no Team Leader on the board was recognised as one, and a supervisor had to press LEAD
 * on Everton Eduardo every single day he was placed. `department` is still asked, as a
 * fallback, for a record nobody has given a position.
 */
export function isTeamLeader(
  person: { position?: string | null; department?: string | null } | null | undefined,
): boolean {
  const job = person?.position?.trim() || person?.department?.trim() || "";
  return /team\s*lead/i.test(job);
}

/**
 * Whether this placement should take the column's mark without anybody pressing LEAD.
 *
 * A Team Leader put to work on a line leads it — unless the line already has a
 * leader that day and shift, because the index allows one and a Team Leader helping
 * on somebody else's line is not the one running it. Supervisors are left out: they
 * look after several lines and lead none of them in particular.
 */
export function claimsLeadership(input: {
  teamLeader: boolean;
  areaId: string | null;
  status: AllocStatus;
  /** Somebody else already holds the mark on this column, this day and shift. */
  columnTaken: boolean;
}): boolean {
  return (
    input.teamLeader
    && (input.status === "assigned" || input.status === "overtime")
    && input.areaId !== null
    && !input.columnTaken
  );
}

/**
 * Who shows LEAD on each line: only an allocation marked `is_leader` for that area,
 * on that date and shift. A job title never shows LEAD on its own. Two marks on one
 * line and shift are a conflict to show, not a tie to break.
 */
export function lineLeadersByArea(
  rows: ReadonlyArray<{
    employee_id: string; area_id: string | null; is_leader?: boolean | null;
    status: string; on_date?: string; shift?: string;
  }>,
  scope?: { onDate: string; shift: string },
): Map<string, { leaderIds: string[]; conflict: boolean }> {
  const out = new Map<string, { leaderIds: string[]; conflict: boolean }>();
  for (const r of rows) {
    if (r.is_leader !== true || !r.area_id) continue;
    if (r.status !== "assigned" && r.status !== "overtime") continue;
    if (scope && ((r.on_date && r.on_date !== scope.onDate) || (r.shift && r.shift !== scope.shift))) continue;
    const e = out.get(r.area_id) ?? { leaderIds: [], conflict: false };
    if (!e.leaderIds.includes(r.employee_id)) e.leaderIds.push(r.employee_id);
    e.conflict = e.leaderIds.length > 1;
    out.set(r.area_id, e);
  }
  return out;
}
