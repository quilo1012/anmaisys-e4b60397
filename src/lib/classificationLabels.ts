/**
 * Turning a verdict into something a supervisor can act on.
 *
 * The classifier writes machine-readable reasons so the screen can group and filter
 * them; a person still has to be told, in one line, which check did not hold and what
 * to do about it. Keeping the wording here rather than inline in the table means the
 * drawer, the review queue and the tooltip cannot drift into saying different things
 * about the same reason.
 */

export type ActionClass = "line" | "leader" | "quality_error" | "needs_review" | "excluded";
export type CheckState = "ok" | "failed" | "unknown";

export const CLASS_LABEL: Record<ActionClass, string> = {
  line: "Line",
  leader: "Leader",
  quality_error: "Quality error",
  needs_review: "Needs review",
  excluded: "Excluded",
};

/**
 * Written as statements about the evidence, not as accusations.
 *
 * "Nobody recorded whether…" and "Recorded as away" are deliberately different
 * sentences: the first is a gap in the attendance table and the second is a finding,
 * and a supervisor who cannot tell them apart will chase the wrong thing.
 */
export const REASON_TEXT: Record<string, string> = {
  site_not_production: "Raised outside Production.",
  site_missing: "No site on the record, so it could not be placed.",
  action_date_missing: "No date of the finding — the due date is not a substitute.",
  due_before_action_date: "The due date falls before the finding was raised.",
  worker_absent_on_action_date: "Everyone assigned is recorded as away that day.",
  worker_attendance_unknown: "Nobody recorded whether the assignees were on the floor that day.",
  worker_not_named: "No assignee on the record.",
  leader_not_found_for_line: "No leader held that line on that day.",
  leader_session_unsigned: "The shift was opened on that line but nobody signed for it.",
  line_not_identified: "No line and no department could be identified.",
  rule_conflict: "Two rules disagree about what this is.",
};

export function reasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason.replace(/_/g, " ");
}

/**
 * Which reasons actually stopped the record, as opposed to being reported alongside it.
 *
 * `worker_attendance_unknown` is the one that matters here: it is present on most
 * records, because the attendance table is sparse, and showing it as a blocker would
 * bury the real reason under noise on every row.
 */
const ADVISORY = new Set(["worker_attendance_unknown", "worker_not_named"]);

export function blockingReasons(reasons: string[] | null | undefined): string[] {
  return (reasons ?? []).filter((r) => !ADVISORY.has(r));
}

export function advisoryReasons(reasons: string[] | null | undefined): string[] {
  return (reasons ?? []).filter((r) => ADVISORY.has(r));
}

/** ✓ / ✕ / ? — the drawer's checklist, in one place so the three screens agree. */
export function checkMark(state: CheckState | null | undefined): "✓" | "✕" | "?" {
  if (state === "ok") return "✓";
  if (state === "failed") return "✕";
  return "?";
}
