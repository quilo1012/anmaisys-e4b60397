import { severityPoints, isValidatedPaperwork } from "@/lib/qualityConstants";

/**
 * Quality actions rolled up per leader.
 *
 * A board does not ask how many actions are To do — that is the team's working
 * board, and it changes twice an hour. It asks who is accumulating deviations, how
 * many are still open in their name, and how many points they have picked up over
 * the period.
 *
 * Points here ACCUMULATE. They are not a deduction: this table is a tally of what
 * was raised against a leader, in the same severity weights Quality configures, so
 * three Lows and one Critical are comparable across leaders and across months. What
 * a leader's score does with that number is the scorecard's business, not this
 * table's.
 */

export interface TrackedAction {
  leader_name: string | null;
  shift: string | null;
  severity: string | null;
  /** Filed by a manager. An action without this is still standing. */
  closed_at?: string | null;
  labels?: string[] | null;
  validation_status?: string | null;
}

export interface LeaderTrackingRow {
  leader: string;
  /** Every shift the leader's actions were raised on, e.g. "DAY" or "DAY, NIGHT". */
  shifts: string;
  total: number;
  /** Still standing in this leader's name — not yet closed by a manager. */
  open: number;
  /** Paperwork errors Quality has validated. */
  paperwork: number;
  /** Paperwork raised but not yet validated, so not yet counted against them. */
  paperworkPending: number;
  highCritical: number;
  /** Severity points picked up in the period, over every action Quality has not rejected. */
  points: number;
  /** The share of those points still sitting on open actions. */
  openPoints: number;
  /** Nothing standing against them in the period. */
  clean: boolean;
}

function attributable(a: TrackedAction, excluded: Set<string>): boolean {
  const labels = (a.labels ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean);
  // No labels still counts: otherwise leaving them blank quietly removes a deviation
  // from somebody's score, which is a gap people find by accident and then use.
  if (labels.length === 0) return true;
  return labels.some((l) => !excluded.has(l));
}

export function leaderTracking(
  actions: TrackedAction[],
  /** Labels that are not the leader's to answer for — see useLabelAttribution. */
  excludedLabels: Set<string> = new Set(),
): LeaderTrackingRow[] {
  const byLeader = new Map<string, TrackedAction[]>();
  for (const a of actions) {
    const key = a.leader_name?.trim() || "Unassigned";
    const list = byLeader.get(key);
    if (list) list.push(a);
    else byLeader.set(key, [a]);
  }

  const rows: LeaderTrackingRow[] = [];
  for (const [leader, list] of byLeader) {
    // Rejected means Quality looked and said it was not a deviation. It stays in the
    // count of what was raised, but it costs the leader nothing — same rule as the
    // scorecard, deliberately.
    //
    // Attribution is the second filter: a machine failure or a GMP finding is raised
    // on the line, not against the person running it. Those stay visible in the total
    // and carry no points.
    const standing = list
      .filter((a) => a.validation_status !== "rejected")
      .filter((a) => attributable(a, excludedLabels));
    const paperwork = list.filter(isValidatedPaperwork).length;
    const paperworkPending = list.filter(
      (a) => (a.labels ?? []).includes("Paperwork") && a.validation_status !== "validated" && a.validation_status !== "rejected",
    ).length;
    const shifts = Array.from(new Set(list.map((a) => (a.shift || "").toUpperCase()).filter(Boolean))).sort();
    const points = standing.reduce((sum, a) => sum + severityPoints(a.severity), 0);
    // Open means Quality has not filed it. The To do / In progress / Complete board
    // is gone from this module; the lifecycle that carries a signature is the one
    // that counts — raised, then validated or rejected, then closed by a manager.
    const stillOpen = standing.filter((a) => !a.closed_at);
    rows.push({
      leader,
      shifts: shifts.join(", ") || "—",
      total: list.length,
      open: stillOpen.length,
      paperwork,
      paperworkPending,
      highCritical: list.filter((a) => a.severity === "high" || a.severity === "critical").length,
      points,
      openPoints: stillOpen.reduce((sum, a) => sum + severityPoints(a.severity), 0),
      clean: standing.length === 0,
    });
  }

  // Worst first: the leader a director should be asking about is the first line.
  return rows.sort(
    (a, b) => b.points - a.points || b.highCritical - a.highCritical || b.total - a.total || a.leader.localeCompare(b.leader),
  );
}

/**
 * The points line, e.g. "7 pts (3 open)".
 *
 * Written as an accumulation, never as a minus: the number says what was raised
 * against the leader over the period, not what was taken off them.
 */
export function pointsLabel(r: LeaderTrackingRow): string {
  if (!r.points) return "0 pts";
  return r.openPoints ? `${r.points} pts (${r.openPoints} open)` : `${r.points} pts`;
}
