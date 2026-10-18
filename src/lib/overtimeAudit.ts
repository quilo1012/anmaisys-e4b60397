/**
 * Reading `overtime_audit` rows as sentences.
 *
 * The table is written only by database triggers (20261018110000); nothing here
 * writes. Pure functions, so the wording can be tested without a database.
 */

export type OvertimeAuditEvent =
  | "opportunity_created" | "opportunity_edited" | "opportunity_closed"
  | "opportunity_reopened" | "opportunity_cancelled" | "opportunity_deleted"
  | "answered_yes" | "answered_no"
  | "assigned" | "placed_on_reserve" | "declined_by_supervisor"
  | "removed_from_overtime" | "reserve_promoted" | "decision_cleared"
  | "reassigned" | "response_deleted"
  | "attended" | "no_show" | "called_sick" | "employee_cancelled" | "outcome_removed"
  | "absence_affects_overtime"
  | "rules_changed" | "permission_override_changed";

export interface OvertimeAuditRow {
  id: number;
  occurred_at: string;
  event_type: OvertimeAuditEvent;
  request_id: string | null;
  response_id: string | null;
  employee_id: string | null;
  employee_name: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  actor_kind: "employee" | "supervisor" | "administrator" | "system" | "other";
  source: "employee_app" | "supervisor_interface" | "system" | "backfill" | "other";
  on_date: string | null;
  shift: string | null;
  starts_at: string | null;
  ends_at: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  note: string | null;
}

export const EVENT_LABEL: Record<OvertimeAuditEvent, string> = {
  opportunity_created: "Overtime posted",
  opportunity_edited: "Overtime changed",
  opportunity_closed: "Overtime closed",
  opportunity_reopened: "Overtime reopened",
  opportunity_cancelled: "Overtime cancelled",
  opportunity_deleted: "Overtime deleted",
  answered_yes: "Said yes",
  answered_no: "Said no",
  assigned: "Given the place",
  placed_on_reserve: "Put on reserve",
  declined_by_supervisor: "Not chosen",
  removed_from_overtime: "Taken off the overtime",
  reserve_promoted: "Moved up from reserve",
  decision_cleared: "Decision cleared",
  reassigned: "Answer moved to someone else",
  response_deleted: "Answer deleted",
  attended: "Worked it",
  no_show: "Didn't turn up",
  called_sick: "Called in sick",
  employee_cancelled: "Cancelled",
  outcome_removed: "Outcome removed",
  absence_affects_overtime: "Day off on the board",
  rules_changed: "Overtime rules changed",
  permission_override_changed: "Overtime permission changed",
};

/** The filter groups on the screen. */
export const EVENT_GROUPS: Record<string, { label: string; events: OvertimeAuditEvent[] }> = {
  asks: {
    label: "Overtime posted / changed",
    events: ["opportunity_created", "opportunity_edited", "opportunity_closed", "opportunity_reopened", "opportunity_cancelled", "opportunity_deleted"],
  },
  answers: {
    label: "Answers and decisions",
    events: ["answered_yes", "answered_no", "assigned", "placed_on_reserve", "declined_by_supervisor", "removed_from_overtime", "reserve_promoted", "decision_cleared", "reassigned", "response_deleted"],
  },
  outcomes: {
    label: "On the day",
    events: ["attended", "no_show", "called_sick", "employee_cancelled", "outcome_removed", "absence_affects_overtime"],
  },
  access: {
    label: "Rules and permissions",
    events: ["rules_changed", "permission_override_changed"],
  },
};

const FIELD_LABEL: Record<string, string> = {
  on_date: "date", starts_at: "start", ends_at: "end", shift: "shift", headcount: "people needed",
  department: "department", shift_group: "crew", note: "note", status: "status",
  answer: "answer", decision: "decision", outcome: "outcome", board_status: "board",
  no_show_block_days: "no-show block (days)", late_cancel_hours: "late cancellation (hours)",
  late_cancel_blocks: "late cancellation blocks", allowed: "allowed",
};

const OUTCOME_WORD: Record<string, string> = {
  cancelled_in_time: "in time", cancelled_late: "late",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  // "06:00:00" → "06:00"; a date stays as it is.
  return /^\d{2}:\d{2}:\d{2}$/.test(s) ? s.slice(0, 5) : s;
}

/**
 * "start 06:00 → 16:00, end 14:00 → 22:00" — only the keys that changed, which is
 * all the trigger stores. Empty when the event is not a change.
 */
export function changeLine(row: Pick<OvertimeAuditRow, "event_type" | "old_value" | "new_value">): string {
  const { old_value: o, new_value: n } = row;
  if (!o || !n) return "";
  if (row.event_type === "permission_override_changed") {
    return `${show(n.role ?? o.role)} · ${show(n.action ?? o.action)}: ${show(o.allowed)} → ${n.deleted ? "removed" : show(n.allowed)}`;
  }
  const keys = Object.keys(n).filter((k) => k in o && k !== "deleted");
  return keys
    .map((k) => `${FIELD_LABEL[k] ?? k} ${show(o[k])} → ${show(n[k])}`)
    .join(", ");
}

/** What the row adds beyond its label: the cancellation timing, the board word, a new access grant. */
export function detailLine(row: OvertimeAuditRow): string {
  const n = row.new_value ?? {};
  if (row.event_type === "employee_cancelled" && typeof n.outcome === "string") {
    return OUTCOME_WORD[n.outcome] ?? "";
  }
  if (row.event_type === "absence_affects_overtime" && typeof n.board_status === "string") {
    return `marked ${n.board_status} on the board`;
  }
  if (row.event_type === "called_sick" && n.note_recorded) return "a note was recorded (not shown here)";
  if (row.event_type === "permission_override_changed" && !row.old_value) {
    return `${show(n.role)} · ${show(n.action)}: ${show(n.allowed)}`;
  }
  return changeLine(row);
}

/** "Mon 24 Oct · Day · 06:00–14:00", from what the row carries. */
export function whenLine(row: Pick<OvertimeAuditRow, "on_date" | "shift" | "starts_at" | "ends_at">): string {
  const parts: string[] = [];
  if (row.on_date) {
    parts.push(new Date(`${row.on_date}T00:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
    }));
  }
  if (row.shift) parts.push(row.shift);
  if (row.starts_at && row.ends_at) parts.push(`${show(row.starts_at)}–${show(row.ends_at)}`);
  return parts.join(" · ");
}

export const SOURCE_LABEL: Record<OvertimeAuditRow["source"], string> = {
  employee_app: "Employee app",
  supervisor_interface: "Supervisor screen",
  system: "System",
  backfill: "From earlier records",
  other: "Other",
};

/** Who did it, said the way the floor would: a name, or what kind of thing it was. */
export function actorLine(row: Pick<OvertimeAuditRow, "actor_name" | "actor_kind">): string {
  if (row.actor_kind === "system") return "System";
  const kind = row.actor_kind === "administrator" ? "admin" : row.actor_kind === "other" ? "" : row.actor_kind;
  return [row.actor_name ?? "Unknown", kind && `(${kind})`].filter(Boolean).join(" ");
}
