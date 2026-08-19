import { format } from "date-fns";
import {
  DOCUMENTATION_LABEL, documentationPenaltyPct,
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
  /** 'quality' | 'safety' | undefined (rows recorded before the column existed) —
   *  required so `computeLeaderScore`'s `actionPoints`/`standsAgainstLeader` calls can
   *  see it. Without it in the select, a safety row prices as a quality one. */
  domain?: string | null;
  /**
   * Which safety occurrence this is — `lost_time_injury`, `near_miss`, and so on.
   *
   * Required for the same reason `domain` is, one step further on: `domain` tells
   * `actionPoints` to price the row at zero, and this tells `computeLeaderScore`
   * whether the row is one of the two that put a 49% ceiling on the whole period. It
   * was missing from every select for ten days, so the ceiling could not fire on any
   * real data while every unit test of it passed. See
   * theCeilingCannotSeeTheInjury.test.ts.
   *
   * Undefined means the same as a missing `domain`: the migration has not run, in
   * which case the base holds no safety rows to gate on either.
   */
  safety_kind?: string | null;
  /** What the action was worth under the scale of its own day, from 20260822090000.
   *  Undefined means the same as a missing `domain` does — either the migration has not
   *  run, or a select forgot to ask — and `actionPoints` falls back to today's scale.
   *  See frozenPointsInSelects.test.ts for why the second case needs guarding. */
  points_at_creation?: number | null;
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
export interface LSItem {
  actual_qty: number | null;
  target_qty: number | null;
  /**
   * The session this item was logged against, when the caller selected it.
   *
   * Only needed to answer one question: which of the leader's planned line-shifts
   * logged no output at all. Optional because the tablet path's rows arrive from a
   * database function whose shape is fixed by a migration, and a card that cannot
   * answer the question must say nothing rather than guess at it.
   */
  production_sessions?: { session_date: string | null; shift: string | null; line: string | null } | null;
}
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
 *
 * And, like a quality action, the DAY it belongs to is its shift's day rather than its
 * calendar one: a night that starts on the 5th is still the 5th's night at 02:00 on
 * the 6th. This used to return every row untouched when the period was "all shifts",
 * which left the card counting whatever the query happened to fetch — the previous
 * night's call-outs included, the ones raised after midnight missing, and no way to
 * tell from the number.
 *
 * "Maintenance called" is the figure a leader is least able to argue with. Nobody
 * remembers whether the engineer was rung at 23:50 or 00:10.
 */
export function workOrdersInPeriod(wos: LSWorkOrder[], period: ScorecardPeriod): LSWorkOrder[] {
  return wos.filter((w) => {
    const shift = getShift(w.created_at);
    if (period.shift !== "all" && shift !== (period.shift === "DAY" ? "day" : "night")) return false;
    const day = shiftSessionDate(w.created_at, shift === "night" ? "NIGHT" : "DAY");
    return day >= period.from && day <= period.to;
  });
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
  /** What one validated error costs, from the Paperwork label's price. */
  penaltyPct: number;
  /**
   * What the unjudged cases would cost if Quality validated them all.
   *
   * Not a penalty and never subtracted from the score — the demerit still waits for a
   * verdict. It exists so the card can stop printing "100% compliant" over paperwork
   * nobody has looked at yet.
   */
  pendingImpactPct: number;
}

/**
 * What happened to people in this period — counted, never scored.
 *
 * Three groups, and they are the point. `SAFETY_KIND_GROUPS` says harm, signal and
 * prevention are not degrees of the same event: first aid is somebody already hurt,
 * a near miss is the warning that arrived in time. Summing them produces a figure that
 * goes DOWN when a team reports more hazards, which would teach the floor to stop
 * filing them — the one inversion this domain exists to prevent, and the same reason
 * `actionPoints` prices every safety row at zero.
 *
 * So there is no `total` across the groups here on purpose. `total` counts occurrences
 * for the one question that needs a single number — "is there anything to show?" —
 * and the card never prints it.
 */
export interface SafetySummary {
  /** Occurrences in the period. Used to decide whether the band appears at all. */
  total: number;
  /** Rejected by Quality: it did not happen, so it counts nowhere and gates nothing. */
  rejected: number;
  /**
   * Per `SAFETY_KINDS` value. A kind with none in the period is simply absent.
   *
   * Counts by KIND and not by group, although the card draws the groups. `SAFETY_KINDS`
   * already says which group a kind belongs to, and a second copy of that mapping here
   * is a copy that can disagree with it — a seventh kind added there would land in the
   * card's three columns and in nobody's total, or the reverse, and the mismatch would
   * be invisible in both.
   */
  byKind: Record<string, number>;
  /** The rows themselves, so the band can name the ones that fired the ceiling. */
  occurrences: LSAction[];
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
  /**
   * Planned line-shifts that logged no output at all — the mirror of
   * `sessionsWithPlan`.
   *
   * The card already warns about the opposite case: a line-shift with output and no
   * RAG plan adds to the numerator and not the denominator, so attainment reads
   * higher than it is. This is the same distortion pointing the other way. A shift
   * that was planned but never filled in on My Production adds 5,000 to the target
   * and nothing to the actual, and the leader is shown a percentage that is about
   * paperwork rather than about production — with nothing on the card to say so.
   *
   * Zero when the caller did not select the session behind each item, which is not
   * the same as zero shifts: see `LSItem.production_sessions`.
   */
  plannedWithoutOutput: number;
}

export interface ScorecardResult {
  /** The actions the period actually holds, newest last. */
  actions: LSAction[];
  woRequests: LSWorkOrder[];
  woStopped: number;
  quality: QualitySummary;
  docs: DocumentationSummary;
  safety: SafetySummary;
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

  // Bucketed on the SHIFT date, the same rule `actionsInPeriod` used to decide the row
  // belonged here at all. Bucketing on the calendar date of the timestamp drew a night
  // action at 02:00 on the day after the one it was counted under — a bar standing on
  // a day the card does not report on, moving a night's failures onto the next shift.
  const dayMap = new Map<string, number>();
  for (const a of actions) {
    const k = shiftSessionDate(a.recorded_at, a.shift);
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
  const pending = raised.filter((a) => a.validation_status === "open" || a.validation_status === "under_investigation");
  const penaltyPct = documentationPenaltyPct();
  return {
    penalised,
    pending,
    rejected: raised.filter((a) => a.validation_status === "rejected"),
    score: documentationScore(penalised.length),
    impactPct: penalised.length * penaltyPct,
    penaltyPct,
    pendingImpactPct: pending.length * penaltyPct,
  };
}

/**
 * Counted off the whole log, with one exclusion and no attribution test.
 *
 * Rejected rows are out: Quality looked and said it did not happen, the same rule the
 * quality pillar and the gate both apply.
 *
 * Nothing else is. `actionPoints` asks whose fault an action was because it is deciding
 * who PAYS; this band is not charging anybody, it is reporting what occurred on the
 * leader's shifts. A near miss caught by an operator on somebody else's fault still
 * happened here, and a card that dropped it would answer a different question from the
 * one the leader is being asked in the review.
 */
function summariseSafety(actions: LSAction[]): SafetySummary {
  const safety = actions.filter((a) => a.domain === "safety" && a.safety_kind);
  const rejected = safety.filter((a) => a.validation_status === "rejected");
  const occurrences = safety.filter((a) => a.validation_status !== "rejected");
  const byKind: Record<string, number> = {};
  for (const a of occurrences) {
    const kind = a.safety_kind as string;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return { total: occurrences.length, rejected: rejected.length, byKind, occurrences };
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

  /**
   * Which planned line-shifts actually logged something.
   *
   * Keyed exactly as the plan is, so a shift can be looked up in both. An item with a
   * zero quantity counts as no output: the row exists but the shift produced nothing
   * the plan can be measured against, and the reader's question is about the figure,
   * not about whether a form was opened.
   */
  const loggedOutput = new Set<string>();
  let itemsCarrySession = false;
  for (const it of items) {
    const s = it.production_sessions;
    if (!s) continue;
    itemsCarrySession = true;
    if ((it.actual_qty ?? 0) > 0) {
      loggedOutput.add(`${s.session_date}|${String(s.shift ?? "").trim().toUpperCase()}|${norm(s.line)}`);
    }
  }

  return {
    sessions: sessions.length, avgOEE, downtimeH, runtimeH,
    output: actual,
    attainment: target > 0 ? Math.round((actual / target) * 100) : null,
    actualQty: actual, targetQty: target,
    plannedSessions: seen.size,
    sessionsWithPlan: Array.from(seen).filter((k) => (planMap.get(k) ?? 0) > 0).length,
    plannedWithoutOutput: itemsCarrySession
      ? Array.from(seen).filter((k) => (planMap.get(k) ?? 0) > 0 && !loggedOutput.has(k)).length
      : 0,
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
  /**
   * The labels that gate the period — `quality_options.is_gate`, lowercased.
   *
   * Threaded rather than looked up here for the same reason `excludedLabels` is: this
   * function is shared by the manager's card and the leader's own, and a lookup inside
   * it would run twice with two different loading states for one number.
   */
  gateLabels: Set<string>;
}

export function computeScorecard(
  raw: ScorecardRaw,
  period: ScorecardPeriod,
  ctx: ScorecardContext,
): ScorecardResult {
  const { weights = DEFAULT_WEIGHTS, excludedLabels, gateLabels } = ctx;
  const actions = actionsInPeriod(raw.actions ?? [], period);
  const woRequests = workOrdersInPeriod(raw.woRequests ?? [], period);
  /**
   * The Quality section counts quality actions, and the H&S band counts the rest.
   *
   * `summariseQuality` was handed the whole log, which was invisible for as long as a
   * safety row could not be told apart — `domain` reached the manager's select in
   * August and the tablet's projection not at all. The band made it a contradiction on
   * one page: "Quality · Total actions 9" beside three near misses, a first aid case
   * and two prevention entries named individually below it, every one of them counted
   * in both places.
   *
   * `% closed` was the worse half of it. A near miss is filed, never "completed", so
   * each one sat in the denominator permanently and a leader who had closed every
   * quality action they had was shown 33%.
   *
   * `docs` is deliberately still given the whole log: a paperwork error is quality
   * domain by construction — 20260817090000's CHECK ties `domain = 'safety'` to a
   * `safety_kind` and nothing else — so the filter would change nothing there, and
   * narrowing an input that does not need narrowing invites the reverse mistake later.
   */
  const quality = summariseQuality(actions.filter((a) => a.domain !== "safety"), raw.completes ?? []);
  const docs = summariseDocumentation(actions);
  const safety = summariseSafety(actions);
  const production = summariseProduction(raw.sessions ?? [], raw.items ?? [], raw.ragRows ?? []);

  return {
    actions, woRequests,
    woStopped: woRequests.filter((w) => w.line_stopped).length,
    quality, docs, safety, production,
    score: computeLeaderScore(
      { actual: production.actualQty, target: production.targetQty, avgOEE: production.avgOEE, actions, excludedLabels, gateLabels },
      weights,
    ),
  };
}
