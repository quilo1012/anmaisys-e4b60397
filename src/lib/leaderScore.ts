import { documentationPenaltyPct, documentationScore, isValidatedPaperwork, sumActionPoints, standsAgainstLeader } from "@/lib/qualityConstants";

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

/**
 * Used until the configured weights load, and if the table is unreachable.
 *
 * These are the same three weights the weekly scorecard scores on: the configured row
 * in `leader_score_weights` is versioned into `leader_scorecard_threshold` as
 * W_Production / W_Quality / W_Documentation, and both scores read one decision about
 * what this factory values. Keep this fallback equal to the seed there — a fallback
 * that disagrees with the database is a score that changes when the network hiccups.
 */
export const DEFAULT_WEIGHTS: LeaderScoreWeights = {
  production_pct: 40,
  quality_pct: 35,
  documentation_pct: 25,
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
  /**
   * Labels that are not the leader's to answer for, from `useLabelAttribution`.
   *
   * Required, and deliberately not defaulted to an empty set: an empty set means
   * "nothing is excluded", which is a real answer and not the same as "the attribution
   * table has not loaded". A default here would let a caller silently score a leader
   * on maintenance faults by forgetting an argument.
   */
  excludedLabels: Set<string>;
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
 * Two things are void: an action Quality rejected, and an action whose labels are not
 * the leader's to answer for. Both tests live in `actionPoints`, which the leader
 * table, the by-leader chart and the line indicators also call, so what one action is
 * worth is decided in one place.
 *
 * One number does legitimately differ, and it is worth knowing which before chasing
 * it as a bug: the Quality-page tally counts every standing action, while this
 * component hands the validated paperwork errors to the documentation block below.
 * A leader can therefore read 10 points on the board and "100 less 6" here. The
 * difference is named on the basis line rather than left for somebody to find.
 *
 * This is deliberately NOT the documentation rule. The paperwork demerit still waits
 * for a validated verdict, because that one is a formal penalty with a name against
 * it; this is a performance indicator that moves while the case is open.
 *
 * Which is exactly why a VALIDATED paperwork error is dropped here: at that moment the
 * documentation block takes it over, and counting it in both components charged one
 * error twice. It weighed heavier still once a label could carry a price, since the
 * same number then moved quality and documentation together.
 *
 * Only the validated ones leave. An open paperwork action is charged nowhere else —
 * the demerit has not claimed it yet — so it stays a quality event until somebody
 * signs it off, and a leader cannot park an error out of their score by leaving it
 * unjudged.
 *
 * Uses the severity weights Quality configures for the board, so one screen cannot
 * say a Critical is worth 4 while another says 1.
 */
function qualityScore(input: LeaderScoreInput): LeaderScoreComponent {
  if (input.actions.length === 0) {
    return { value: 100, basis: "No quality actions raised in this period" };
  }
  const attributable = input.actions.filter((a) => standsAgainstLeader(a, input.excludedLabels));
  const standing = attributable.filter((a) => !isValidatedPaperwork(a));
  const rejected = input.actions.filter((a) => a.validation_status === "rejected").length;
  // Counted off `attributable`, not off every action: a paperwork error that is not
  // this leader's was already out of the total, and subtracting it twice would push
  // "not attributable" negative on the very line that explains the score.
  const onTheDemerit = attributable.length - standing.length;
  const notTheirs = input.actions.length - attributable.length - rejected;
  const points = sumActionPoints(standing, input.excludedLabels);
  return {
    value: Math.max(0, 100 - points),
    basis:
      `100 less ${points} severity point${points === 1 ? "" : "s"} from ${standing.length} action${standing.length === 1 ? "" : "s"}` +
      (rejected ? ` · ${rejected} rejected by Quality and not counted` : "") +
      (onTheDemerit ? ` · ${onTheDemerit} charged to documentation instead` : "") +
      (notTheirs ? ` · ${notTheirs} not attributable to the leader` : ""),
  };
}

export function computeLeaderScore(
  input: LeaderScoreInput,
  weights: LeaderScoreWeights = DEFAULT_WEIGHTS,
): LeaderScoreResult {
  const production = productionScore(input);
  const quality = qualityScore(input);

  // The same test `qualityScore` uses to hand these over, so the error cannot be
  // dropped by one component without the other picking it up.
  const validatedPaperwork = input.actions.filter(isValidatedPaperwork).length;
  // The price comes from the Paperwork label in Lists & scoring, so the demerit and
  // the quality points cannot disagree about what one error is worth.
  const penaltyPct = documentationPenaltyPct();
  const documentation: LeaderScoreComponent = {
    value: documentationScore(validatedPaperwork),
    basis: validatedPaperwork === 0
      ? "No validated paperwork error"
      : `100 less ${penaltyPct}% for each of ${validatedPaperwork} validated paperwork error${validatedPaperwork === 1 ? "" : "s"}`,
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

/** Anything with a name and a score can be ranked; the table row carries far more. */
export interface RankableLeader {
  leader: string;
  score: number | null;
}

/**
 * A leader's rank, by score, independent of how the table happens to be sorted.
 *
 * The Leader Performance table awarded 🥇🥈🥉 to rows 0, 1 and 2 of the current sort,
 * and all eleven of its columns are sortable. Sorting by "Open Actions" descending
 * handed the gold medal to the leader with the most open actions; sorting by "Doc
 * errors" handed it to whoever had made the most paperwork errors. The medal was never
 * a statement about a leader — it was a statement about a row index, wearing the
 * costume of one.
 *
 * So rank is computed here, from the score and nothing else, and the medal travels with
 * the person when the reader re-sorts the table.
 *
 * Competition ranking, not sequential: two leaders on the same score are both first,
 * and the next is third. The alternative was breaking the tie on the name, which hands
 * one of two identical performances a better medal for beginning with an earlier
 * letter.
 *
 * A null score is unranked, not last. `computeLeaderScore` returns null when there was
 * nothing measurable in the period, and ordering that below a genuine 40 would turn
 * "we have no reading" into "the worst reading", which is the failure this file's
 * `final: number | null` exists to prevent.
 */
export function rankLeadersByScore(rows: readonly RankableLeader[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const scored = rows.filter((r): r is RankableLeader & { score: number } => r.score !== null);
  const descending = [...scored].sort((a, b) => b.score - a.score);

  let rank = 0;
  let previousScore: number | null = null;
  descending.forEach((row, index) => {
    // A new score takes the position it actually sits at, so a shared first place
    // consumes second and the next leader is third.
    if (previousScore === null || row.score !== previousScore) {
      rank = index + 1;
      previousScore = row.score;
    }
    out.set(row.leader, rank);
  });

  for (const r of rows) if (!out.has(r.leader)) out.set(r.leader, null);
  return out;
}
