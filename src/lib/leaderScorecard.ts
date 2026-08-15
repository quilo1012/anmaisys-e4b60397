import { format } from "date-fns";
import {
  DOCUMENTATION_LABEL, DOCUMENTATION_PENALTY_PCT,
  documentationScore, isValidatedPaperwork,
} from "@/lib/qualityConstants";
import { computeLeaderScore, DEFAULT_WEIGHTS, type LeaderScoreResult, type LeaderScoreWeights } from "@/lib/leaderScore";
import { getShift, shiftSessionDate } from "@/lib/shifts";

/**
 * Everything a leader scorecard is made of, worked out in one place.
 *
 * It lives outside the component because the same card is now read from two ends: a
 * manager opening it from Production Performance, whose session may read the tables
 * directly, and the leader themself on a line tablet, whose rows arrive through a
 * SECURITY DEFINER function because RLS scopes that session to a single line.
 *
 * Two fetch paths, one arithmetic. If the score were computed twice the leader and
 * the manager could be looking at different numbers for the same person and period,
 * which is the one thing a scorecard may never do.
 */

export interface LSAction {
  id: string; status: string; severity: string | null; recorded_at: string;
  labels: string[] | null; department: string | null; line: string | null;
  action_no: string | null; description: string | null; shift: string | null;
  validation_status: string | null; validated_at: string | null; validated_by: string | null;
  attachments: string[] | null; closed_at: string | null;
}

export interface LSWorkOrder {
  id: string; wo_number: number | null; created_at: string; status: string | null;
  line_at_time: string | null; line_stopped: boolean | null; description: string | null;
}

export interface LSSession {
  oee_pct: number | null; run_time_min: number | null; down_time_min: number | null;
  intouch_good_total: number | null; session_date: string | null; line: string | null; shift: string | null;
}

export interface LSRagRow { entry_date: string; line: string; shift: string; plan_qty: number }
export interface LSItem { actual_qty: number | null; target_qty: number | null }
export interface LSStatusChange { action_id: string; changed_at: string }

/** The rows behind one leader's card, before any period rule is applied. */
export interface ScorecardRaw {
  actions: LSAction[];
  completes: LSStatusChange[];
  sessions: LSSession[];
  ragRows: LSRagRow[];
  items: LSItem[];
  woRequests: LSWorkOrder[];
}

export interface ScorecardPeriod {
  /** First day of the period, inclusive, as `yyyy-MM-dd`. */
  from: string;
  /** Last day, inclusive. */
  to: string;
  shift: "all" | "DAY" | "NIGHT";
}

export const EMPTY_RAW: ScorecardRaw = {
  actions: [], completes: [], sessions: [], ragRows: [], items: [], woRequests: [],
};

const norm = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");

/**
 * Keep only the actions whose *shift date* falls in the period.
 *
 * A night that starts on the 28th is still the 28th's night at 05:00 on the 29th, so
 * the fetch deliberately reaches into the morning after and this throws back what
 * does not belong. Applied here rather than in the query so the tablet path, whose
 * rows come from a database function, obeys exactly the same rule.
 */
export function actionsInPeriod(actions: LSAction[], period: ScorecardPeriod): LSAction[] {
  return actions.filter((a) => {
    if (period.shift !== "all" && (a.shift ?? "").toUpperCase() !== period.shift) return false;
    const day = shiftSessionDate(a.recorded_at, a.shift);
    return day >= period.from && day <= period.to;
  });
}

/**
 * A work order carries no shift column — the shift is where its timestamp falls,
 * the same rule the rest of the factory uses.
 */
export function workOrdersInPeriod(wos: LSWorkOrder[], period: ScorecardPeriod): LSWorkOrder[] {
  if (period.shift === "all") return wos;
  return wos.filter((w) => getShift(w.created_at) === (period.shift === "DAY" ? "day" : "night"));
}

export interface QualitySummary {
  total: number; completed: number; filed: number; open: number; pctClosed: number;
  sev: Record<string, number>;
  avgResolution: number | null;
  topLabels: Array<{ label: string; count: number }>;
  trend: Array<{ day: string; count: number }>;
}

export interface DocumentationSummary {
  penalised: LSAction[];
  /** Raised but not yet judged — a clean score may only mean nothing was reviewed. */
  pending: LSAction[];
  rejected: LSAction[];
  score: number;
  impactPct: number;
}

export interface ProductionSummary {
  sessions: number;
  avgOEE: number | null;
  downtimeH: number | null;
  runtimeH: number | null;
  output: number;
  attainment: number | null;
  actualQty: number;
  targetQty: number;
  plannedSessions: number;
  sessionsWithPlan: number;
}

export interface ScorecardResult {
  /** The actions the period actually holds, newest last. */
  actions: LSAction[];
  woRequests: LSWorkOrder[];
  woStopped: number;
  quality: QualitySummary;
  docs: DocumentationSummary;
  production: ProductionSummary;
  score: LeaderScoreResult;
}

function summariseQuality(actions: LSAction[], completes: LSStatusChange[]): QualitySummary {
  const total = actions.length;
  const completed = actions.filter((a) => a.status === "complete").length;
  const filed = actions.filter((a) => !!a.closed_at).length;
  const sev: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const a of actions) if (a.severity && sev[a.severity] !== undefined) sev[a.severity] += 1;

  const completeAt = new Map<string, number>();
  for (const c of completes) {
    const t = new Date(c.changed_at).getTime();
    const prev = completeAt.get(c.action_id);
    if (prev === undefined || t > prev) completeAt.set(c.action_id, t);
  }
  let sumDays = 0, n = 0;
  for (const a of actions) {
    const done = completeAt.get(a.id);
    if (a.status === "complete" && done) { sumDays += (done - new Date(a.recorded_at).getTime()) / 86400000; n += 1; }
  }

  const labelMap = new Map<string, number>();
  for (const a of actions) for (const l of a.labels ?? []) labelMap.set(l, (labelMap.get(l) ?? 0) + 1);
  const topLabels = Array.from(labelMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const dayMap = new Map<string, number>();
  for (const a of actions) {
    const k = format(new Date(a.recorded_at), "yyyy-MM-dd");
    dayMap.set(k, (dayMap.get(k) ?? 0) + 1);
  }
  const trend = Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, count]) => ({ day: format(new Date(`${k}T00:00:00`), "dd/MM"), count }));

  return {
    total, completed, filed, open: total - completed,
    pctClosed: total ? Math.round((completed / total) * 100) : 0,
    sev, avgResolution: n > 0 ? sumDays / n : null, topLabels, trend,
  };
}

function summariseDocumentation(actions: LSAction[]): DocumentationSummary {
  const penalised = actions.filter(isValidatedPaperwork);
  const raised = actions.filter((a) => (a.labels ?? []).includes(DOCUMENTATION_LABEL));
  return {
    penalised,
    pending: raised.filter((a) => a.validation_status === "open" || a.validation_status === "under_investigation"),
    rejected: raised.filter((a) => a.validation_status === "rejected"),
    score: documentationScore(penalised.length),
    impactPct: penalised.length * DOCUMENTATION_PENALTY_PCT,
  };
}

function summariseProduction(sessions: LSSession[], items: LSItem[], ragRows: LSRagRow[]): ProductionSummary {
  // Only count what the lines actually report. A metric no line fills in is not
  // zero — "0.0h downtime" reads as a perfect week when the truth is that nothing
  // was recorded at all.
  const oees = sessions.map((s) => s.oee_pct).filter((v): v is number => v != null);
  const avgOEE = oees.length ? oees.reduce((a, b) => a + b, 0) / oees.length : null;
  const dtReported = sessions.filter((s) => s.down_time_min != null);
  const downtimeH = dtReported.length ? dtReported.reduce((s, x) => s + (x.down_time_min ?? 0), 0) / 60 : null;
  const runtimeReported = sessions.filter((s) => s.run_time_min != null);
  const runtimeH = runtimeReported.length ? runtimeReported.reduce((s, x) => s + (x.run_time_min ?? 0), 0) / 60 : null;

  const actual = items.reduce((s, x) => s + (x.actual_qty ?? 0), 0);

  // Target from the RAG plan, matched on date + shift + line like everywhere else.
  const planMap = new Map<string, number>();
  for (const r of ragRows) {
    const k = `${r.entry_date}|${String(r.shift ?? "").trim().toUpperCase()}|${norm(r.line)}`;
    planMap.set(k, (planMap.get(k) ?? 0) + Number(r.plan_qty ?? 0));
  }
  let target = 0;
  const seen = new Set<string>();
  for (const s of sessions) {
    const k = `${s.session_date}|${String(s.shift ?? "").trim().toUpperCase()}|${norm(s.line)}`;
    if (seen.has(k)) continue;   // one plan per line+shift+day, not per session row
    seen.add(k);
    target += planMap.get(k) ?? 0;
  }

  return {
    sessions: sessions.length, avgOEE, downtimeH, runtimeH,
    output: actual,
    attainment: target > 0 ? Math.round((actual / target) * 100) : null,
    actualQty: actual, targetQty: target,
    plannedSessions: seen.size,
    sessionsWithPlan: Array.from(seen).filter((k) => (planMap.get(k) ?? 0) > 0).length,
  };
}

export interface ScorecardContext {
  /** Falls back to the defaults when Quality has not configured them. */
  weights?: LeaderScoreWeights;
  /**
   * Labels that are not the leader's to answer for.
   *
   * Required, and an options object rather than a fourth positional argument so it
   * cannot be defaulted away: an empty set means "everything counts", and this is the
   * scorecard a leader opens about themselves — the last screen that should disagree
   * with the board their manager is reading.
   */
  excludedLabels: Set<string>;
}

export function computeScorecard(
  raw: ScorecardRaw,
  period: ScorecardPeriod,
  ctx: ScorecardContext,
): ScorecardResult {
  const { weights = DEFAULT_WEIGHTS, excludedLabels } = ctx;
  const actions = actionsInPeriod(raw.actions ?? [], period);
  const woRequests = workOrdersInPeriod(raw.woRequests ?? [], period);
  const quality = summariseQuality(actions, raw.completes ?? []);
  const docs = summariseDocumentation(actions);
  const production = summariseProduction(raw.sessions ?? [], raw.items ?? [], raw.ragRows ?? []);

  return {
    actions, woRequests,
    woStopped: woRequests.filter((w) => w.line_stopped).length,
    quality, docs, production,
    score: computeLeaderScore(
      { actual: production.actualQty, target: production.targetQty, avgOEE: production.avgOEE, actions, excludedLabels },
      weights,
    ),
  };
}
