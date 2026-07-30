import { documentationScore, severityPoints } from "@/lib/qualityConstants";

/**
 * The leader's final score: production, quality and documentation, weighted.
 *
 * Every definition below is printed next to its number on the scorecard. A score
 * nobody can explain is worse than no score — in an audit, and in the conversation
 * with the leader it is about.
 */

export interface LeaderScoreWeights {
  production_pct: number;
  quality_pct: number;
  documentation_pct: number;
}

/** Used until the configured weights load, and if the table is unreachable. */
export const DEFAULT_WEIGHTS: LeaderScoreWeights = {
  production_pct: 40,
  quality_pct: 30,
  documentation_pct: 30,
};

export interface LeaderScoreInput {
  /** Sum of actual across the leader's production items. */
  actual: number;
  /** Sum of target across the same items. 0 when nothing was planned. */
  target: number;
  /** Average OEE across the leader's sessions, when the lines report it. */
  avgOEE: number | null;
  /** Quality actions in the period, already filtered to this leader. */
  actions: Array<{ severity: string | null; labels?: string[] | null; validation_status?: string | null }>;
}

export interface LeaderScoreComponent {
  /** 0–100, or null when there is nothing to measure it from. */
  value: number | null;
  /** How it was calculated, in one sentence, for the screen. */
  basis: string;
}

/**
 * Percentages are rounded DOWN, never to nearest.
 *
 * A leader with one Low action scored 99 on quality and 100 on the other two, which
 * weighted out at 99.7 and printed as "100%" — a deduction that rounded itself away.
 * A score that hides a penalty is worse than no score, so 99.7 reads 99.
 */
export function displayScore(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Math.floor(v);
}

export interface LeaderScoreResult {
  production: LeaderScoreComponent;
  quality: LeaderScoreComponent;
  documentation: LeaderScoreComponent;
  /** Weighted total across the components that could be measured. */
  final: number | null;
  /** Weights actually applied, after dropping any component with no data. */
  applied: LeaderScoreWeights;
}

/**
 * Production: attainment against target, capped at 100.
 *
 * Capped because a leader who ran 130% of plan has not earned a score above full
 * marks — a plan that low is a planning matter, not a performance one, and letting
 * it inflate the total would hide a bad week elsewhere. Falls back to OEE when the
 * period has no target at all.
 */
function productionScore(input: LeaderScoreInput): LeaderScoreComponent {
  if (input.target > 0) {
    return {
      value: Math.max(0, Math.min(100, (input.actual / input.target) * 100)),
      basis: "Actual against target, capped at 100%",
    };
  }
  if (input.avgOEE != null) {
    return { value: Math.max(0, Math.min(100, input.avgOEE)), basis: "Average OEE — no target was set for this period" };
  }
  return { value: null, basis: "No target and no OEE in this period" };
}

/**
 * Quality: 100 less the severity points of every action that stands.
 *
 * "Stands" means anything Quality has not rejected — open, under investigation or
 * validated. An action that was raised against a leader's shift is a quality event
 * whether or not the paperwork has caught up with it, and a leader with an action
 * open reading 100% is the kind of number nobody believes twice.
 *
 * Only a rejected action is void: Quality looked and said it was not a real
 * deviation, so it should not follow the leader around.
 *
 * This is deliberately NOT the documentation rule. The −5% paperwork demerit still
 * waits for a validated verdict, because that one is a formal penalty with a name
 * against it; this is a performance indicator that moves while the case is open.
 *
 * Uses the severity weights Quality configures for the board, so one screen cannot
 * say a Critical is worth 4 while another says 1.
 */
function qualityScore(input: LeaderScoreInput): LeaderScoreComponent {
  if (input.actions.length === 0) {
    return { value: 100, basis: "No quality actions raised in this period" };
  }
  const standing = input.actions.filter((a) => a.validation_status !== "rejected");
  const rejected = input.actions.length - standing.length;
  const points = standing.reduce((sum, a) => sum + severityPoints(a.severity), 0);
  return {
    value: Math.max(0, 100 - points),
    basis:
      `100 less ${points} severity point${points === 1 ? "" : "s"} from ${standing.length} action${standing.length === 1 ? "" : "s"}` +
      (rejected ? ` · ${rejected} rejected by Quality and not counted` : ""),
  };
}

export function computeLeaderScore(
  input: LeaderScoreInput,
  weights: LeaderScoreWeights = DEFAULT_WEIGHTS,
): LeaderScoreResult {
  const production = productionScore(input);
  const quality = qualityScore(input);

  const validatedPaperwork = input.actions.filter(
    (a) => a.validation_status === "validated" && (a.labels ?? []).includes("Paperwork"),
  ).length;
  const documentation: LeaderScoreComponent = {
    value: documentationScore(validatedPaperwork),
    basis: validatedPaperwork === 0
      ? "No validated paperwork error"
      : `100 less 5% for each of ${validatedPaperwork} validated paperwork error${validatedPaperwork === 1 ? "" : "s"}`,
  };

  // A component with nothing to measure is dropped and its weight shared out, rather
  // than counted as zero: a leader with no production target in the period has not
  // scored badly on production, they simply cannot be scored on it.
  const parts = [
    { c: production, w: weights.production_pct },
    { c: quality, w: weights.quality_pct },
    { c: documentation, w: weights.documentation_pct },
  ].filter((p) => p.c.value !== null && p.w > 0);

  const totalWeight = parts.reduce((s, p) => s + p.w, 0);
  const final = totalWeight
    ? parts.reduce((s, p) => s + (p.c.value as number) * (p.w / totalWeight), 0)
    : null;

  const scale = totalWeight ? 100 / totalWeight : 0;
  return {
    production,
    quality,
    documentation,
    final,
    applied: {
      production_pct: production.value === null ? 0 : Math.round(weights.production_pct * scale),
      quality_pct: quality.value === null ? 0 : Math.round(weights.quality_pct * scale),
      documentation_pct: documentation.value === null ? 0 : Math.round(weights.documentation_pct * scale),
    },
  };
}
