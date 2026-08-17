import { DEFAULT_WEIGHTS, type LeaderScoreWeights } from "@/lib/leaderScore";

/**
 * Which weights a scorecard is scored under, resolved at the date it reports on.
 *
 * `leader_score_weights` is the screen people type into: one row, no history, always
 * "now". `leader_scorecard_threshold` is where those saves are kept, as dated versions
 * — a trigger closes yesterday's rows and opens today's, so, in the words of the
 * migration that built it, "every week already recorded keeps resolving the weights it
 * was actually scored under. Editing the weights in November therefore cannot re-score
 * July."
 *
 * That promise was kept in SQL and broken in TypeScript. The Leader Performance card
 * read the un-versioned editing row with no date at all, so re-weighting the score in
 * November silently re-scored every card anyone opened about July — including ones
 * already printed, signed and filed. A scorecard is a document about a person; a
 * document that changes its own past is not one anybody can be held to.
 *
 * The value itself is a management decision this file has no opinion about. What it
 * enforces is that the decision is read as of the period being reported on.
 */

/** One dated version of one weight, as `leader_scorecard_threshold` stores it. */
export interface WeightVersionRow {
  name: string;
  value: number | string;
  valid_from: string;
  valid_to: string | null;
}

const W_NAMES = {
  W_Production: "production_pct",
  W_Quality: "quality_pct",
  W_Documentation: "documentation_pct",
} as const;

/**
 * The weights in force on `asOf`, or null when the table cannot answer for that date.
 *
 * Null rather than a guess, in three cases, each of which is a real state of the
 * table and none of which may be papered over with a default:
 *
 *  - a name is missing or duplicated on that date — the versions overlap or have a
 *    hole, and picking one of two overlapping rows would score a leader on whichever
 *    happened to sort first;
 *  - the three do not total 100 — a partially-applied re-weighting. Scoring on 95
 *    points of weight inflates every component silently, which is the same class of
 *    failure as scoring a failed read at 100%;
 *  - the date falls before any version opens.
 *
 * The caller falls back to the editing surface, which is at least a coherent set.
 *
 * `valid_to` is inclusive, matching `scorecard_weights_total_100` in
 * 20260818090000 — the trigger probes `valid_to + 1` for the next version, so a
 * half-open reading here would leave the changeover day scored twice.
 */
export function resolveWeightsAt(rows: readonly WeightVersionRow[], asOf: string): LeaderScoreWeights | null {
  const out: Partial<Record<keyof LeaderScoreWeights, number>> = {};
  for (const [name, key] of Object.entries(W_NAMES) as Array<[string, keyof LeaderScoreWeights]>) {
    const inForce = rows.filter(
      (r) => r.name === name && r.valid_from <= asOf && (r.valid_to === null || asOf <= r.valid_to),
    );
    if (inForce.length !== 1) return null;
    const value = Number(inForce[0].value);
    if (!Number.isFinite(value)) return null;
    out[key] = value;
  }
  const w = out as LeaderScoreWeights;
  const total = w.production_pct + w.quality_pct + w.documentation_pct;
  // Tolerance, not equality: the column is `numeric` and the weights are allowed to be
  // fractional, so three thirds of 100 must not be read as a broken table.
  if (Math.abs(total - 100) > 0.01) return null;
  return w;
}

/**
 * What the card should score on, given both sources and the period it reports on.
 *
 * Order is deliberate. The versioned rows are the source of truth *because* they can
 * answer for a date; the editing row is a fallback that can only answer for now, and
 * is used when the versioned table has nothing to say — most importantly on a database
 * where 20260818090000 has not been applied yet, where it is the only answer there is.
 */
export function chooseWeights(
  versioned: readonly WeightVersionRow[] | null,
  editing: LeaderScoreWeights | null,
  asOf: string | null,
): LeaderScoreWeights {
  if (versioned && asOf) {
    const dated = resolveWeightsAt(versioned, asOf);
    if (dated) return dated;
  }
  return editing ?? DEFAULT_WEIGHTS;
}
