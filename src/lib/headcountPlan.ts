import type { Allocation, HeadcountEmployee } from "@/hooks/useHeadcount";
import type { RotaCover } from "@/lib/rotaStatus";

/**
 * A day that has not happened yet, as the rota says it will look.
 *
 * The export of 01/10 to 30/10 on the 12th gave eighteen empty tabs: the board is only
 * written on the morning, so every day after today had nobody on it except the people
 * whose leave or overtime had already been booked. The office wanted the month to read
 * as the plan — who is due in on each line, and who is off and why.
 *
 * Nothing here is written to `daily_allocations`. It is what the sheet shows for a day
 * nobody has planned yet, and the board on the morning is still the record.
 *
 * Rules, in the order they are applied:
 *
 * - **Only days after today.** A past day with nobody on it is a fact about that day,
 *   and filling it from the rota would claim people worked who may not have.
 * - **A day somebody has already planned is left alone.** One `assigned` row means a
 *   planner has started on it, and adding the rest of the rota would put back people
 *   they took off. Leave and overtime rows do not count: those are booked weeks ahead
 *   by other screens and say nothing about who else is in.
 * - **Anybody who already has a row keeps it.** Booked holiday, sickness, unpaid and
 *   accepted overtime are saved rows, so they print under their own columns and the
 *   person is never also put on a line.
 * - **Only people whose rota puts them on this board that day.** Somebody with no rota
 *   on file is unknown, not due — they are counted in `noRota` so the export can say so
 *   rather than leave them out in silence.
 * - **Their place is the standing one.** The matrix (changeover on Mondays and Fridays,
 *   standard otherwise, the other kind if they are only in one), then the last line they
 *   worked, then no line — printed in a column of its own rather than dropped.
 */

export type PlannedAllocation = Allocation & { planned?: boolean };

export interface PlanInput {
  date: string;
  shift: string;
  /** yyyy-mm-dd, local. Days on or before it are returned as saved. */
  today: string;
  saved: Allocation[];
  roster: HeadcountEmployee[];
  cover: (employeeId: string, date: string, shift: string) => RotaCover;
  /** Standing places by employee, per matrix kind. */
  matrix: { normal: Map<string, string | null>; changeover: Map<string, string | null> };
  /** The most recent line each person worked on this board. */
  lastArea: Map<string, string | null>;
}

export interface PlannedDay {
  allocations: PlannedAllocation[];
  /** Whether rota names were added to this day. */
  planned: boolean;
  /** People on this board with no rota on file, left out because nobody knows if they are in. */
  noRota: number;
}

/** Mondays and Fridays are the crossover between two rotas — see `MATRIX_KINDS`. */
function isChangeover(date: string): boolean {
  const dow = new Date(`${date}T12:00:00`).getDay();
  return dow === 1 || dow === 5;
}

export function planDay(input: PlanInput): PlannedDay {
  const { date, shift, today, saved, roster, cover, matrix, lastArea } = input;
  if (date <= today) return { allocations: saved, planned: false, noRota: 0 };
  if (saved.some((a) => a.status === "assigned")) return { allocations: saved, planned: false, noRota: 0 };

  const taken = new Set(saved.map((a) => a.employee_id));
  const [first, second] = isChangeover(date)
    ? [matrix.changeover, matrix.normal]
    : [matrix.normal, matrix.changeover];

  const added: PlannedAllocation[] = [];
  let noRota = 0;
  for (const person of roster) {
    if (taken.has(person.id)) continue;
    const c = cover(person.id, date, shift);
    if (!c.onThisBoard) continue;
    if (!c.known) { noRota += 1; continue; }
    if (!c.coversDay) continue;
    const area =
      (first.has(person.id) ? first.get(person.id) : undefined)
      ?? (second.has(person.id) ? second.get(person.id) : undefined)
      ?? lastArea.get(person.id)
      ?? null;
    added.push({
      id: `planned:${person.id}:${date}`,
      on_date: date,
      shift,
      employee_id: person.id,
      area_id: area,
      status: "assigned",
      half_day: false,
      left_early_at: null,
      arrived_late_at: null,
      note: null,
      is_leader: false,
      planned: true,
    });
  }
  return { allocations: [...saved, ...added], planned: added.length > 0, noRota };
}
