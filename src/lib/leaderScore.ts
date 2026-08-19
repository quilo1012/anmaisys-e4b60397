import { DOCUMENTATION_LABEL, documentationPenaltyPct, documentationScore, isValidatedPaperwork, sumActionPoints, standsAgainstLeader } from "@/lib/qualityConstants";

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
  /**
   * Every action in the period filtered to this leader, safety rows included.
   *
   * `domain` and `safety_kind` are here because the H&S ceiling below reads them.
   * They were already arriving — `computeScorecard` passes the whole log and
   * `standsAgainstLeader` drops the safety rows out of the quality pillar — the type
   * simply did not admit it, so nothing could be written against them.
   */
  actions: Array<{
    severity: string | null;
    labels?: string[] | null;
    validation_status?: string | null;
    domain?: string | null;
    safety_kind?: string | null;
    /** The frozen charge, when the row carries one — see `actionPoints`. */
    points_at_creation?: number | null;
    /** Only so a gate can name the day it fired. Absent is handled. */
    recorded_at?: string | null;
    /** Which dated scale this action was frozen against — see `scales` below. */
    scoring_version_id?: number | null;
  }>;
  /**
   * Labels that are not the leader's to answer for, from `useLabelAttribution`.
   *
   * Required, and deliberately not defaulted to an empty set: an empty set means
   * "nothing is excluded", which is a real answer and not the same as "the attribution
   * table has not loaded". A default here would let a caller silently score a leader
   * on maintenance faults by forgetting an argument.
   */
  excludedLabels: Set<string>;
  /**
   * The labels that gate a period, lowercased — `quality_options.is_gate`.
   *
   * Required, and NOT defaulted to empty, for a harder version of the reason
   * `excludedLabels` is required. An empty exclusion set errs strict: it charges a
   * leader for something that may not be theirs, which is visible and arguable. An
   * empty GATE set errs lenient, and it errs lenient on food safety: a leader with a
   * failed CCP in the period would score green while the table loaded, and nothing on
   * the screen would say a ceiling had gone missing. That is the failure this whole
   * mechanism exists to make impossible, arriving through the loading state.
   */
  gateLabels: Set<string>;
}

/**
 * The score a gate leaves standing: 49, a fail in anybody's reading of a percentage.
 *
 * ONE number for every gate, and the name says so since a second trigger arrived. A
 * failed CCP and a lost-time injury both leave 49 standing, because they are the same
 * statement — a gate fired — and two constants would eventually come to disagree about
 * what that costs. Mirrors CAP_Gate, which the SQL scorecard shares between the check
 * sheet, H&S and now the food safety labels for the same reason.
 *
 * Mirrors `CAP_Gate` in `leader_scorecard_threshold`, seeded by migration
 * 20260818090000, for the same reason `DEFAULT_WEIGHTS` mirrors the weight seed —
 * this score is computed in TypeScript over a date range while the weekly one is
 * computed in SQL over a week, and the two must not disagree about what an injury
 * costs. Change it there, change it here.
 *
 * Only the two hard conditions are here. The weekly card also has an Amber band at
 * `CAP_HSAmber` (79), driven by `scorecard_hs_evaluate` — which folds in H&S training
 * compliance, a percentage this score has no denominator for. Inventing a second
 * definition of Amber out of the data that IS here would put two answers to "is this
 * leader's H&S amber" in the system, which is the failure this module keeps closing.
 * So the band stays where its inputs are, and this applies the gate both can compute
 * identically.
 */
export const GATE_CAP = 49;

/**
 * The occurrences that mean somebody was hurt badly enough to gate the week.
 *
 * NOT first aid, and NOT a near miss. A ceiling on a reported near miss would teach
 * the team to stop reporting them, and zero near misses is under-reporting rather than
 * a safe line — the same reasoning that prices every safety row at 0 in
 * `actionPoints`. These two are the pair `scorecard_safety_counts` reports separately
 * and that the weekly gate fires on.
 */
const GATING_KINDS: Record<string, string> = {
  lost_time_injury: "a lost-time injury",
  reportable_accident: "a reportable accident",
};

/** What a ceiling did to the weighted sum, in a form the scorecard can print. */
export interface LeaderScoreCap {
  /** The ceiling in force. */
  value: number;
  /** Whether it actually lowered the score — false when the week was already below it. */
  applied: boolean;
  /**
   * The weighted sum before the ceiling touched it, so the card can show the
   * subtraction rather than only its result. A leader shown 49 with no sight of the 97
   * it was cut from cannot check the arithmetic, and this is the number they will
   * argue with hardest.
   */
  weighted: number | null;
  /** "A lost-time injury limits this score to 49%." */
  reason: string;
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
  /** Weighted total across the components that could be measured, ceiling applied. */
  final: number | null;
  /** The H&S ceiling, when the period had a gating occurrence. Null when it did not. */
  cap: LeaderScoreCap | null;
  /** Weights actually applied, after dropping any component with no data. */
  applied: LeaderScoreWeights;
  /**
   * Whether this period's actions were all scored on the same ruler.
   *
   * Null when they were, or when nothing here carries a version — which is every row on
   * a database where 20260822090000 has not run, and is why this reads as "nothing to
   * say" rather than as a warning.
   *
   * The freeze made this possible and also made it necessary. Before it, every action in
   * a period was scored on today's scale, so a period was internally consistent and
   * wrong; now each action keeps the scale of its own day, so a quarter that spans a
   * re-pricing is internally MIXED and right. Both are defensible. What is not
   * defensible is showing the second one without saying so, because the reader's whole
   * mental model — "these numbers are comparable" — quietly stops holding.
   */
  scales: string | null;
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
  /**
   * Counted out separately, because `standsAgainstLeader` rejects a safety row on its
   * FIRST line — before it has looked at a label or a department — and folding that
   * into `notTheirs` printed "6 not attributable to the leader" over six near misses.
   *
   * The two exclusions are not the same statement and a leader will read them very
   * differently. "Not attributable" says it happened and it was somebody else's fault.
   * A safety occurrence is nobody's fault for scoring purposes: `actionPoints` prices
   * every one of them at zero on purpose, so that reporting a hazard can never cost the
   * person who reported it. Saying so is the point — a leader who reads that their
   * three near misses were "not attributable" learns that filing them is an argument
   * about blame, which is the behaviour the pricing exists to prevent.
   *
   * The line was accurate for as long as no safety row could reach this function:
   * `safety_kind` was in no select and `domain` in no projection of the tablet's card.
   * Fixing the fetch is what put the wrong words on the screen.
   */
  const rejectedSafety = input.actions.filter(
    (a) => a.domain === "safety" && a.validation_status === "rejected",
  ).length;
  const safetyRows = input.actions.filter((a) => a.domain === "safety").length - rejectedSafety;
  const notTheirs = input.actions.length - attributable.length - rejected - safetyRows;
  const points = sumActionPoints(standing, input.excludedLabels);
  return {
    value: Math.max(0, 100 - points),
    basis:
      `100 less ${points} severity point${points === 1 ? "" : "s"} from ${standing.length} action${standing.length === 1 ? "" : "s"}` +
      (rejected ? ` · ${rejected} rejected by Quality and not counted` : "") +
      (onTheDemerit ? ` · ${onTheDemerit} charged to documentation instead` : "") +
      (safetyRows ? ` · ${safetyRows} safety occurrence${safetyRows === 1 ? "" : "s"}, counted under Health & Safety and not scored` : "") +
      (notTheirs ? ` · ${notTheirs} not attributable to the leader` : ""),
  };
}

/**
 * "A lost-time injury and a reportable accident" — every gate that fired, never just
 * the first. A leader told only about the injury reads the reportable accident as
 * unnoticed, and asks why once and never again.
 */
function namedGates(gating: Array<{ safety_kind?: string | null }>): string {
  const named = Object.keys(GATING_KINDS)
    .filter((k) => gating.some((a) => a.safety_kind === k))
    .map((k) => GATING_KINDS[k]);
  const sentence = named.length === 1
    ? named[0]
    : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * "Fail Ccp on 12/07 limits this score to 49%." — what fired, and when.
 *
 * The date is on it because a leader reading a capped score asks "which one" before they
 * ask "why". A period holding twenty actions and one gate has to point at the one, or
 * the ceiling reads as a verdict on the whole period.
 *
 * Every distinct gate label is named, never just the first — the same reasoning as
 * `namedGates`: a leader told only about the CCP reads the foreign body as unnoticed,
 * and asks once and never again.
 */
function namedLabelGates(
  hits: Array<{ labels?: string[] | null; recorded_at?: string | null }>,
  gateLabels: Set<string>,
): string[] {
  const seen = new Map<string, string | null>();
  for (const a of hits) {
    for (const raw of a.labels ?? []) {
      const key = raw.trim().toLowerCase();
      if (!gateLabels.has(key) || seen.has(key)) continue;
      seen.set(key, a.recorded_at ?? null);
    }
  }
  return [...seen.entries()].map(([label, at]) => {
    const name = label.replace(/\b\w/g, (c) => c.toUpperCase());
    if (!at) return name;
    const d = new Date(at);
    // An unparseable timestamp names the label alone rather than printing "Invalid Date"
    // onto the one line a leader is going to read hardest.
    return Number.isNaN(d.getTime())
      ? name
      : `${name} on ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

function capReason(
  gating: Array<{ safety_kind?: string | null }>,
  hits: Array<{ labels?: string[] | null; recorded_at?: string | null }>,
  gateLabels: Set<string>,
): string {
  const parts: string[] = [];
  if (gating.length) parts.push(namedGates(gating));
  parts.push(...namedLabelGates(hits, gateLabels));
  const named = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${named} limits this score to ${GATE_CAP}%. A gate is a ceiling, never a weight — no production can buy it back.`;
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
  // Paperwork errors Quality has not ruled on yet. They are the reason this pillar
  // can be unmeasured rather than perfect — see below.
  const pendingPaperwork = input.actions.filter(
    (a) => (a.labels ?? []).includes(DOCUMENTATION_LABEL)
      && (a.validation_status ?? "open") !== "validated"
      && a.validation_status !== "rejected",
  ).length;
  // The price comes from the Paperwork label in Lists & scoring, so the demerit and
  // the quality points cannot disagree about what one error is worth.
  const penaltyPct = documentationPenaltyPct();
  /**
   * Null while a paperwork error is still waiting on a verdict.
   *
   * "No validated paperwork error" was true and read as a compliment: the pillar had
   * not been cleared, it had not been LOOKED AT, and it was handing out a full quarter
   * of the final score for the difference. A leader with two paperwork errors pending
   * scored the same 100 here as one with none.
   *
   * Null is the answer `productionScore` already gives a period with no target — the
   * component drops out and its weight is shared among the ones that could be measured,
   * rather than counting as a free full mark. A verdict on either row settles it.
   *
   * An error already validated in the period DOES score, pending rows or not: a
   * measurement exists, and letting one unjudged row erase an error somebody signed
   * would hand a leader a way to park a demerit by raising another action.
   */
  const documentation: LeaderScoreComponent = validatedPaperwork === 0 && pendingPaperwork > 0
    ? {
        value: null,
        basis: `${pendingPaperwork} paperwork action${pendingPaperwork === 1 ? "" : "s"} awaiting a verdict from Quality — not scored until one is given`,
      }
    : {
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
  const weighted = totalWeight
    ? parts.reduce((s, p) => s + (p.c.value as number) * (p.w / totalWeight), 0)
    : null;

  /**
   * The H&S ceiling, applied AFTER the weighted sum and never inside it.
   *
   * This ordering is the whole rule. A ceiling can only ever lower the number, so no
   * amount of production can buy back an injury; a weight would have priced one at
   * some number of points and let a good volume week pay for it. Migration
   * 20260818090000 states it as the one sentence the scorecard module exists to keep
   * true, and this is the second place it is now kept.
   *
   * A rejected occurrence is void, the same rule the quality pillar applies: Quality
   * looked and said it did not happen.
   */
  const gating = input.actions.filter(
    (a) => a.domain === "safety"
      && a.validation_status !== "rejected"
      && a.safety_kind != null
      && a.safety_kind in GATING_KINDS,
  );
  /**
   * The second trigger: an action carrying a food safety label.
   *
   * NO attribution test, and that is deliberate rather than forgotten. `actionPoints`
   * asks whose fault it was because it is deciding who PAYS; a gate asks only whether
   * the event happened in the period. A CCP failure that turns out to be maintenance's
   * still happened on this line, in this period, and a scorecard that quietly dropped
   * it would answer a different question from the one an auditor is asking. It is the
   * same rule the H&S gate above already runs on.
   *
   * No domain test either, so it fails closed: anything carrying a gate label gates.
   *
   * A completed CAPA does not appear here at all. The gate records that the event
   * occurred in the period; closing it out is tracked separately, and letting a closure
   * erase the record would make the period unable to say what happened in it.
   */
  const gateHits = input.actions.filter(
    (a) => a.validation_status !== "rejected"
      && (a.labels ?? []).some((l) => input.gateLabels.has(l.trim().toLowerCase())),
  );

  const cap: LeaderScoreCap | null = gating.length || gateHits.length
    ? {
        value: GATE_CAP,
        // False when the week was already below the ceiling. A ceiling that raised a
        // score would be a floor, and the screen must not claim a limit did work it
        // did not do.
        applied: weighted !== null && weighted > GATE_CAP,
        weighted,
        reason: capReason(gating, gateHits, input.gateLabels),
      }
    : null;
  const final = weighted === null ? null : cap ? Math.min(weighted, cap.value) : weighted;

  /**
   * Counted over the actions that actually SCORE, not over every row fetched.
   *
   * A rejected action is worth nothing and a safety row is worth nothing, so the version
   * they were frozen against changes no figure on this card. Counting them would raise
   * the notice on periods where nothing is actually mixed, and a warning that fires when
   * nothing is wrong is a warning people learn to close.
   */
  const versions = new Set(
    input.actions
      .filter((a) => standsAgainstLeader(a, input.excludedLabels))
      .map((a) => a.scoring_version_id)
      .filter((v): v is number => v != null),
  );

  const scale = totalWeight ? 100 / totalWeight : 0;
  return {
    production,
    quality,
    documentation,
    final,
    cap,
    scales: versions.size > 1
      ? `This period spans ${versions.size} scoring versions. Each action is scored on the scale in force on its own date, so the figures inside it were not all measured with the same ruler.`
      : null,
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
