import { actionPoints, standsAgainstLeader, severityPoints, labelChargeFor } from "@/lib/qualityConstants";

/** The labels' price on an action, with nothing excluded — see `issueWeight`. */
const NOTHING_EXCLUDED = new Set<string>();
const labelCharge = (action: { labels?: string[] | null }) => labelChargeFor(action, NOTHING_EXCLUDED);

/**
 * The two roll-ups that used to live inside `useMemo` blocks — the by-leader chart on
 * the quality board, and the quality column of the line indicators.
 *
 * They are out here for one reason: while they sat inside components, nothing could
 * assert that they agreed with the leader table and the scorecard, and for months
 * they did not. The rule is now `actionPoints()` for all four, and a test can say so.
 */

export interface BreakdownAction {
  leader_name?: string | null;
  line?: string | null;
  severity: string | null;
  labels?: string[] | null;
  validation_status?: string | null;
  closed_at?: string | null;
}

export interface LeaderPointsRow {
  label: string;
  /** Every action raised in this leader's name, including the ones costing nothing. */
  count: number;
  points: number;
  critical: number;
  high: number;
}

/**
 * Points per leader, heaviest first — the chart beside the leader table.
 *
 * `count` deliberately counts everything raised, including rejected actions and
 * actions that are not the leader's: the bar says what it cost, the count says what
 * came in, and a leader whose actions were all rejected should still be visible as
 * having had a busy period. Only `points` is charged.
 */
export function leaderPointsBreakdown(
  actions: BreakdownAction[],
  excluded: Set<string>,
): LeaderPointsRow[] {
  const m = new Map<string, LeaderPointsRow>();
  for (const a of actions) {
    const label = a.leader_name?.trim() || "—";
    const cur = m.get(label) ?? { label, count: 0, points: 0, critical: 0, high: 0 };
    cur.count += 1;
    cur.points += actionPoints(a, excluded);
    if (a.severity === "critical") cur.critical += 1;
    else if (a.severity === "high") cur.high += 1;
    m.set(label, cur);
  }
  // Ranked by points, not raw count: ten Lows must not outrank three Criticals.
  return Array.from(m.values()).sort(
    (a, b) => b.points - a.points || b.count - a.count || a.label.localeCompare(b.label),
  );
}

export interface LinePointsRow {
  line: string;
  qualityPoints: number;
  /** Standing on this line and not yet filed by a manager. */
  openActions: number;
}

/**
 * Points per line.
 *
 * `openActions` is NOT filtered by attribution, and that is on purpose: a maintenance
 * fault is still an open action on that line, and the line indicators are read by
 * whoever has to go and deal with it. Attribution answers "whose score", not "what is
 * happening on Line 2". Only the points column is charged.
 */
export function linePointsBreakdown(
  actions: BreakdownAction[],
  excluded: Set<string>,
): LinePointsRow[] {
  const m = new Map<string, LinePointsRow>();
  for (const a of actions) {
    const line = (a.line ?? "").trim();
    if (!line) continue;
    // Rejected costs nothing and is not open either — Quality said it was not real.
    if (a.validation_status === "rejected") continue;
    const cur = m.get(line) ?? { line, qualityPoints: 0, openActions: 0 };
    cur.qualityPoints += actionPoints(a, excluded);
    if (!a.closed_at) cur.openActions += 1;
    m.set(line, cur);
  }
  return Array.from(m.values()).sort((a, b) => a.line.localeCompare(b.line, undefined, { numeric: true }));
}

/**
 * Points for a recurring problem, which is NOT a leader's charge.
 *
 * Priced the same way an action is — labels first, severity when no label prices it —
 * so the recurring-issues table cannot say a foreign body is worth 4 while the log
 * beside it says 5. Quality prices a label to say how bad that KIND of problem is,
 * which is exactly the question this table asks.
 *
 * What it does NOT do is filter by attribution: no `excluded` here, on purpose.
 * "Whose score" and "what keeps happening" are different questions, and dropping
 * maintenance from this list would hide the recurring machine faults that most need
 * fixing. So a maintenance fault costs its leader nothing and still shows up here at
 * full weight, which is the behaviour both tables want.
 */
export function issueWeight(actions: BreakdownAction[]): number {
  return actions.reduce((sum, a) => sum + (labelCharge(a) || severityPoints(a.severity)), 0);
}

/** Whether an action stands against the leader it names — re-exported for screens. */
export { standsAgainstLeader };
