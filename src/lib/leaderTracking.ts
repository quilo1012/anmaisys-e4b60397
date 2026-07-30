import { severityPoints, isValidatedPaperwork, DOCUMENTATION_PENALTY_PCT } from "@/lib/qualityConstants";

/**
 * Quality actions rolled up per leader.
 *
 * A board does not ask how many actions are To do — that is the team's working
 * board, and it changes twice an hour. It asks who is accumulating deviations, how
 * many of them were paperwork, and what it costs them on the scorecard. This is that
 * question, answered from the same numbers the scorecard uses so the two screens
 * cannot disagree.
 */

export interface TrackedAction {
  leader_name: string | null;
  shift: string | null;
  severity: string | null;
  labels?: string[] | null;
  validation_status?: string | null;
}

export interface LeaderTrackingRow {
  leader: string;
  /** Every shift the leader's actions were raised on, e.g. "DAY" or "DAY, NIGHT". */
  shifts: string;
  total: number;
  /** Paperwork errors Quality has validated — the ones that carry the demerit. */
  paperwork: number;
  /** Paperwork raised but not yet validated, so not yet counted against them. */
  paperworkPending: number;
  highCritical: number;
  /** Severity points of every action Quality has not rejected. */
  points: number;
  /** Percentage points off documentation: 5 per validated paperwork error. */
  documentationPenaltyPct: number;
  /** Nothing standing against them in the period. */
  clean: boolean;
}

export function leaderTracking(actions: TrackedAction[]): LeaderTrackingRow[] {
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
    const standing = list.filter((a) => a.validation_status !== "rejected");
    const paperwork = list.filter(isValidatedPaperwork).length;
    const paperworkPending = list.filter(
      (a) => (a.labels ?? []).includes("Paperwork") && a.validation_status !== "validated" && a.validation_status !== "rejected",
    ).length;
    const shifts = Array.from(new Set(list.map((a) => (a.shift || "").toUpperCase()).filter(Boolean))).sort();
    const points = standing.reduce((sum, a) => sum + severityPoints(a.severity), 0);
    rows.push({
      leader,
      shifts: shifts.join(", ") || "—",
      total: list.length,
      paperwork,
      paperworkPending,
      highCritical: list.filter((a) => a.severity === "high" || a.severity === "critical").length,
      points,
      documentationPenaltyPct: paperwork * DOCUMENTATION_PENALTY_PCT,
      clean: standing.length === 0,
    });
  }

  // Worst first: the leader a director should be asking about is the first line.
  return rows.sort(
    (a, b) => b.points - a.points || b.highCritical - a.highCritical || b.total - a.total || a.leader.localeCompare(b.leader),
  );
}

/** One cell summarising what the period costs the leader, e.g. "−7 pts · −10% doc". */
export function scoreImpactLabel(r: LeaderTrackingRow): string {
  if (!r.points && !r.documentationPenaltyPct) return "Compliant";
  const parts: string[] = [];
  if (r.points) parts.push(`−${r.points} pts quality`);
  if (r.documentationPenaltyPct) parts.push(`−${r.documentationPenaltyPct}% doc`);
  return parts.join(" · ");
}
