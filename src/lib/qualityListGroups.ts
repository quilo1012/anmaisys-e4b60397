/**
 * The lists on Lists & scoring, and what each one does to a leader's score.
 *
 * Three lists sit on that screen and they behave completely differently. Quality
 * actions carry a price, can gate a period and can be taken off the leader. Health &
 * Safety hazards carry none of that — a safety occurrence is counted and never charged.
 * Departments carry no price at all, only the answer to "whose problem is this".
 *
 * That was already true before this file existed. What was missing is that the screen
 * SAID so in one place only: a paragraph gated behind the Safety tab. On the Quality
 * tab the hazard list rendered with every control stripped and no sentence explaining
 * it, which reads exactly like a broken points box — and was reported as one.
 *
 * So the sentence lives on the group, next to the columns it explains. There is no code
 * path that draws a list and skips its own reason, and a fourth list cannot be added
 * without writing one.
 */

import type { RailState } from "@/lib/rail";

export interface QualityListGroup {
  /**
   * The `kind` stored in `quality_options`.
   *
   * Not renamed to match the headings. `label` / `safety_label` are what every row
   * already saved carries, and renaming them would orphan the lot — nothing about the
   * scoring changes because a heading reads better.
   */
  kind: "label" | "maintenance_label" | "safety_label" | "department";
  /** The heading, in the words the factory uses. */
  title: string;
  /** One line: what this list does to a leader's score. Never empty. */
  effect: string;
  /**
   * Which scoring columns this list actually has.
   *
   * A false here renders an explicit "—" under a live column header, not a gap. The
   * difference is the whole point: a dash under "Points" says this list is not priced,
   * where an empty cell says the box failed to load.
   */
  columns: {
    /** A price that replaces the severity weight — `quality_options.points`. */
    points: boolean;
    /** Caps the period at CAP_Gate and forces Red — `quality_options.is_gate`. */
    gate: boolean;
    /** Whether an action here charges the leader at all. */
    attribution: boolean;
  };
  /**
   * How hard this list can move a score, in the andon vocabulary the floor already
   * reads on every line screen.
   *
   * Encoding rather than decoration, which is why it lives here beside `columns` and
   * not in the JSX: `stop` is the list that can turn a period Red, `hold` is the list
   * that redirects a charge, `idle` is the list that touches no score at all. Someone
   * scanning the screen gets the three answers before reading a word.
   */
  rail: RailState;
}

const QUALITY_ACTIONS: QualityListGroup = {
  kind: "label",
  title: "Quality actions",
  effect:
    "What a deviation costs. A priced item replaces the severity weight; leave it at 0 and the severity decides.",
  columns: { points: true, gate: true, attribution: true },
  // The only list that can cap a period at 49 and force it Red.
  rail: "stop",
};

/**
 * One object, used by both tabs, so the two cannot drift into saying different things
 * about the same list. That drift was the bug.
 */
/**
 * The maintenance list, added because "Maintenance" was one chip on the quality list.
 *
 * It carries a price and never charges one, which is the one combination this file
 * did not have a shape for before. The price is for whoever reads the log — how big a
 * breakdown this was — and the leader is not the person who chooses when a bearing
 * seizes. That is the same answer department attribution has given since
 * 20260827093000; this list makes it visible on the label as well.
 *
 * `CHARGING_LABEL_KINDS` in qualityConstants.ts is what actually enforces it. The
 * sentence below only has to be true.
 */
const MAINTENANCE: QualityListGroup = {
  kind: "maintenance_label",
  title: "Maintenance",
  effect:
    "How big the breakdown was. Points here are for reading the log, never charged: a machine fault costs no leader a point, whatever it is priced at.",
  // Priced but never charged, so the price cannot be re-attributed either.
  columns: { points: true, gate: false, attribution: false },
  // Records a fact about a machine; it moves no score in either direction.
  rail: "idle",
};

/**
 * One object, used by both tabs, so the two cannot drift into saying different things
 * about the same list. That drift was the bug.
 *
 * This list did NOT price anything until now, and the reasoning against it is worth
 * keeping in front of whoever changes it back: a score that punishes the report
 * teaches the team to stop reporting, so a near miss has to stay free. It still is —
 * an unpriced hazard charges nothing however badly the occurrence is graded, and the
 * severity grade cannot charge a safety row at all (see `livePoints`). What is now
 * possible is pricing one named hazard deliberately, on this screen, where it can be
 * read back. Requested and confirmed with that consequence stated.
 */
const HEALTH_AND_SAFETY: QualityListGroup = {
  kind: "safety_label",
  title: "Health & Safety",
  effect:
    "Hazards. Leave one at 0 and reporting it stays free, whatever the grade. Price one and every occurrence carrying it charges the leader that much — the grade never adds to it.",
  columns: { points: true, gate: false, attribution: false },
  // It can charge now, but it cannot cap: no hazard turns a period Red by itself.
  rail: "hold",
};

const DEPARTMENTS: QualityListGroup = {
  kind: "department",
  title: "Departments",
  effect:
    "Whose problem it is. An action booked to a department charged to Nobody is recorded in full and costs no leader a point — a machine failure is maintenance's, not the person running the line that night.",
  columns: { points: false, gate: false, attribution: true },
  // Moves a charge from one place to another; it cannot create or cap one.
  rail: "hold",
};

/**
 * @param domain which tab the manager was opened from. On `safety` it shows the hazard
 *   list and nothing else: the label prices, the severity weights and the leader-score
 *   weights are all arithmetic a safety occurrence never touches.
 */
export function listGroups(domain: "quality" | "safety"): QualityListGroup[] {
  return domain === "safety"
    ? [HEALTH_AND_SAFETY]
    : [QUALITY_ACTIONS, MAINTENANCE, HEALTH_AND_SAFETY, DEPARTMENTS];
}
