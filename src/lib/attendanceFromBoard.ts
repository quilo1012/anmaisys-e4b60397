/**
 * The one place that turns a board mark into a payroll record.
 *
 * The board and `employee_attendance` have to say the same thing, and they have
 * disagreed twice for the same reason: the rule lived in two places. `place()` writes
 * it when somebody is marked by hand and the sheet import writes it for a thousand
 * rows at once, and the two drifted — a holiday on the board that payroll never saw,
 * then a Sunday worked that payroll recorded as unpaid.
 *
 * Two facts make it more than a lookup.
 *
 * `employee_attendance` is keyed by person and day with no shift, while
 * `daily_allocations` allows a row per shift. Somebody can stand on two boards in one
 * day — the Sunday crew are on the weekend board and again in the day sheet's absence
 * column — so a day with two marks needs a winner, and it cannot be chosen by shift
 * name. Working wins: somebody who was on a line was there, whatever another column
 * said about them.
 *
 * And the statuses are not the same words. The board says `assigned`; payroll says
 * `present`.
 */

/** Board statuses, best evidence of attendance first. */
const RANK: Record<string, number> = {
  assigned: 0,
  overtime: 0,
  holiday: 1,
  sick: 2,
  unpaid: 3,
};

export type AttendanceStatus = "present" | "holiday" | "sick" | "unpaid";

/** What one board mark means to payroll. */
export function attendanceForStatus(boardStatus: string): AttendanceStatus {
  return boardStatus === "holiday" ? "holiday"
    : boardStatus === "sick" ? "sick"
    : boardStatus === "unpaid" ? "unpaid"
    : "present";
}

export interface BoardMark {
  employeeId: string;
  date: string;
  /** A `daily_allocations.status`. */
  status: string;
}

export interface AttendanceRow {
  employee_id: string;
  on_date: string;
  status: AttendanceStatus;
}

/**
 * One attendance row per person per day, from any number of board marks.
 *
 * An unknown status ranks last rather than throwing: a status added to the board
 * later should not stop a whole import, and ranking it below every known one means it
 * can never beat a day somebody demonstrably worked.
 */
export function attendanceFromBoard(marks: BoardMark[]): AttendanceRow[] {
  const best = new Map<string, { row: AttendanceRow; rank: number }>();
  for (const m of marks) {
    const rank = RANK[m.status] ?? 9;
    const key = `${m.employeeId}|${m.date}`;
    const prev = best.get(key);
    if (prev && prev.rank <= rank) continue;
    best.set(key, {
      rank,
      row: { employee_id: m.employeeId, on_date: m.date, status: attendanceForStatus(m.status) },
    });
  }
  return [...best.values()].map((b) => b.row);
}
