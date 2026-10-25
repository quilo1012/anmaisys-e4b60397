/**
 * Who said yes to overtime, and who actually came — kept as two answers.
 *
 * The response is the employee's (`overtime_responses.answer`, and the booking the
 * database made of it in `decision`). Attendance is what an authorised person saw on
 * the day (`overtime_outcomes`, written only by `record_overtime_outcome`). Neither is
 * read from the other: an accepted yes is not a person on the floor, and logging in or
 * having an account is not attendance. Until somebody records it, attendance is
 * "Expected" — never Absent by default, and nobody has to be marked Present: only an
 * absence is recorded.
 *
 * Pure functions over rows the database already holds, so the Headcount Board and its
 * tests read the same rule.
 */

export type ResponseState = "pending" | "accepted" | "reserve" | "declined" | "not_needed";
export type AttendanceState = "not_checked" | "present" | "absent" | "called_sick" | "cancelled";

export const RESPONSE_LABEL: Record<ResponseState, string> = {
  pending: "Pending",
  accepted: "Accepted",
  reserve: "Reserve",
  declined: "Declined",
  not_needed: "Not needed",
};

export const ATTENDANCE_LABEL: Record<AttendanceState, string> = {
  not_checked: "Expected",
  present: "Present",
  absent: "Absent — Overtime No-Show",
  called_sick: "Absent — called sick",
  cancelled: "Booking cancelled",
};

/** The employee's answer and the booking made of it. A supervisor's "declined" is not the employee declining. */
export function responseStateOf(r: { answer: string; decision: string | null }): ResponseState {
  if (r.answer === "no") return "declined";
  switch (r.decision) {
    case "accepted": return "accepted";
    case "reserve": return "reserve";
    case "declined": return "not_needed";
    default: return "pending";
  }
}

/** What was recorded on the day. No row is "not yet checked", whatever the time. */
export function attendanceStateOf(outcome: string | null | undefined): AttendanceState {
  switch (outcome) {
    case "attended": return "present";
    case "no_show": return "absent";
    case "called_sick": return "called_sick";
    case "cancelled_in_time":
    case "cancelled_late": return "cancelled";
    default: return "not_checked";
  }
}

export interface AttendanceRow {
  responseId: string;
  employeeId: string;
  name: string;
  response: ResponseState;
  attendance: AttendanceState;
  note: string | null;
  recordedAt: string | null;
  /** From the overtime audit, which names the person behind the session. Null when it cannot be read. */
  recordedBy: string | null;
  /** More than one attendance entry in the audit: it was recorded and then changed. */
  corrected: boolean;
}

export interface AttendanceSummary {
  /** Booked and not cancelled: who is expected. A declined or reserve answer is not. */
  accepted: number;
  present: number;
  /** No-shows and sick calls together; the rows say which. */
  absent: number;
  /** Expected, and nobody has recorded whether they came. */
  unconfirmed: number;
  declined: number;
  reserve: number;
}

/** Whether a row is part of the expected headcount: booked, and the booking not cancelled. */
export function isExpected(row: Pick<AttendanceRow, "response" | "attendance">): boolean {
  return row.response === "accepted" && row.attendance !== "cancelled";
}

export function attendanceSummary(rows: Pick<AttendanceRow, "response" | "attendance">[]): AttendanceSummary {
  const s: AttendanceSummary = { accepted: 0, present: 0, absent: 0, unconfirmed: 0, declined: 0, reserve: 0 };
  for (const r of rows) {
    if (r.response === "declined") s.declined += 1;
    if (r.response === "reserve") s.reserve += 1;
    if (!isExpected(r)) continue;
    s.accepted += 1;
    if (r.attendance === "present") s.present += 1;
    else if (r.attendance === "absent" || r.attendance === "called_sick") s.absent += 1;
    else s.unconfirmed += 1;
  }
  return s;
}

/** Attendance outcomes, as the audit names them. A cancellation is the employee's, not an attendance check. */
const ATTENDANCE_EVENTS = new Set(["attended", "no_show", "called_sick"]);

/**
 * Who last recorded attendance for each response, and whether it was changed after.
 * `events` must be oldest first, as `overtime_audit` is read.
 */
export function attendanceTrail(
  events: { response_id: string | null; event_type: string; actor_name: string | null; occurred_at: string }[],
): Map<string, { by: string | null; at: string; count: number }> {
  const out = new Map<string, { by: string | null; at: string; count: number }>();
  for (const e of events) {
    if (!e.response_id || !ATTENDANCE_EVENTS.has(e.event_type)) continue;
    const prev = out.get(e.response_id);
    out.set(e.response_id, { by: e.actor_name, at: e.occurred_at, count: (prev?.count ?? 0) + 1 });
  }
  return out;
}

/** Order on the board: who still needs checking first, then absences, then present; others after. */
export function attendanceOrder(a: AttendanceRow, b: AttendanceRow): number {
  const rank = (r: AttendanceRow) =>
    !isExpected(r) ? 4
    : r.attendance === "not_checked" ? 0
    : r.attendance === "absent" || r.attendance === "called_sick" ? 1
    : 2;
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}
