import { railEdge } from "@/lib/rail";

// Shared option lists for the Quality Actions module (SafetyCulture-style).

export const QUALITY_LABELS = [
  "Batch code",
  "CCP",
  "Foreign Body",
  "GMP",
  "Health & Safety",
  "Label",
  "Maintenance",
  "Paperwork",
  "Office",
] as const;

export const QUALITY_DEPARTMENTS = ["Supervisor", "Quality", "Warehouse"] as const;

export interface QualityStatus {
  value: "todo" | "in_progress" | "complete";
  label: string;
  /** Tailwind classes for a badge. */
  badge: string;
  /** Chart colour. */
  color: string;
}

export const QUALITY_STATUSES: QualityStatus[] = [
  { value: "todo", label: "To do", badge: "bg-warning/15 text-warning-strong border-warning/40", color: "hsl(38 92% 50%)" },
  { value: "in_progress", label: "In progress", badge: "bg-primary/15 text-primary border-primary/40", color: "hsl(217 91% 60%)" },
  { value: "complete", label: "Complete", badge: "bg-success/15 text-success-strong border-success/40", color: "hsl(142 76% 36%)" },
];

export function statusMeta(value: string | null | undefined): QualityStatus {
  return QUALITY_STATUSES.find((s) => s.value === value) ?? QUALITY_STATUSES[0];
}

export interface QualitySeverity {
  value: "low" | "medium" | "high" | "critical";
  label: string;
  /** Tailwind classes for a badge. */
  badge: string;
  /** Left-border accent class for Kanban cards. */
  accent: string;
  /** Default weight, used until the configured weights load. */
  points: number;
}

export const QUALITY_SEVERITIES: QualitySeverity[] = [
  // O acento é a barra de estado do sistema, à largura do sistema. Escrito à mão aqui,
  // uma acção crítica tinha um vermelho de 4 px e uma linha parada um de 3 px.
  { value: "low", label: "Low", badge: "bg-muted text-muted-foreground border-border", accent: railEdge("idle"), points: 1 },
  { value: "medium", label: "Medium", badge: "bg-warning/15 text-warning-strong border-warning/40", accent: railEdge("hold"), points: 2 },
  { value: "high", label: "High", badge: "bg-warning/15 text-warning-strong border-warning/40", accent: railEdge("hold"), points: 3 },
  { value: "critical", label: "Critical", badge: "bg-destructive/15 text-destructive-strong border-destructive/40", accent: railEdge("stop"), points: 4 },
];

export function severityMeta(value: string | null | undefined): QualitySeverity | null {
  const meta = QUALITY_SEVERITIES.find((s) => s.value === value);
  if (!meta) return null;
  // Reflect the configured weight, so a badge and the score beside it can never
  // disagree about what the severity is worth.
  return CONFIGURED[meta.value] === undefined ? meta : { ...meta, points: CONFIGURED[meta.value] };
}

/**
 * Weights configured in `quality_severity_points`, pushed in once on load by
 * `useSeverityPointsSync`.
 *
 * Held module-level, mirroring how permission overrides work, so the ~20 places that
 * already call `severityPoints()` pick up the configured value without each one
 * having to become a hook. Empty until loaded — the constants above are the fallback,
 * which also keeps points working offline and in tests.
 */
let CONFIGURED: Record<string, number> = {};
const listeners = new Set<() => void>();

export function setSeverityPoints(map: Record<string, number>) {
  CONFIGURED = map ?? {};
  listeners.forEach((l) => l());
}

export function subscribeSeverityPoints(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The weight in force for each severity — configured value, else the default. */
export function severityPointsMap(): Record<string, number> {
  return Object.fromEntries(QUALITY_SEVERITIES.map((s) => [s.value, CONFIGURED[s.value] ?? s.points]));
}

/**
 * What a severity is worth TODAY, under the configured weight.
 *
 * Not what a given action is worth — that is `actionPoints`, which prefers the figure
 * frozen on the action and only falls through to here. This one answers the narrower
 * question the badges and the log form ask: what does this grade cost right now.
 *
 * The claim that used to be here — "points are NOT a stored column, so changing a
 * weight re-scores the history consistently" — was true when it was written and is the
 * behaviour 20260822090000 exists to end. `points_at_creation` IS a stored column now.
 * An action with no severity scores 0.
 */
export function severityPoints(value: string | null | undefined): number {
  return severityMeta(value)?.points ?? 0;
}

/**
 * The severity a number of points names, or null if no severity is worth it.
 *
 * The inverse of `severityPoints`, for the log form: whoever types the week's actions
 * thinks in points, and having to translate 4 into "Critical" in their head is where
 * the wrong grade gets picked. It reads the same weights `severityPoints` reads, so
 * the two can never disagree about what a severity costs.
 *
 * Null is the honest answer for a number no severity carries — 5, say, which is
 * reachable only by pricing a label. Points are NOT a stored column, so a number the
 * scale cannot express has nowhere to live and must not be silently rounded to a
 * neighbouring severity.
 *
 * Two severities may be configured to the same weight; this resolves upward. Guessing
 * the milder one would log a 3-point action as High while the configuration says it
 * could equally be Critical, and under-grading a quality deviation is the direction
 * that hurts.
 */
export function severityForPoints(
  points: number | null | undefined,
  weights: Record<string, number> = severityPointsMap(),
): string | null {
  if (points === null || points === undefined || !Number.isFinite(points)) return null;
  // QUALITY_SEVERITIES runs low → critical, so the last match is the most severe.
  const match = [...QUALITY_SEVERITIES].reverse().find((s) => weights[s.value] === points);
  return match?.value ?? null;
}

// `sumSeverityPoints` was removed here. It summed raw severity weight over a set of
// actions, which is never what a leader is charged — it ignores rejection, attribution
// and label pricing — and it was the function every screen reached for by name.
// `sumActionPoints` below is the one that answers the question people think they are
// asking. For weighing a problem rather than a person, see `issueWeight`.


// ── What a leader is actually charged ────────────────────────────────────────
//
// `severityPoints()` above answers "what is this severity worth". It is not the
// same question as "does this action count against this leader", and six screens
// used to answer the second one for themselves — three of them differently. A
// leader's total then depended on which screen you opened, which is the fastest
// way to make a whole module unbelievable.
//
// Both halves of the answer live here now. A screen may still choose WHICH actions
// it feeds in — open only, this period only, this line only — but it may not
// re-decide what one action is worth.

/** An action Quality has rejected is void: they looked and said it was not real. */
function isRejected(action: { validation_status?: string | null }): boolean {
  return action.validation_status === "rejected";
}

/**
 * Whether an action's labels make it the leader's to answer for.
 *
 * One attributable label is enough. An action with NO labels also counts: the
 * alternative is that leaving them blank quietly removes a deviation from somebody's
 * score, which is the kind of gap people find by accident and then use.
 *
 * This rule has been both ways round, so the history is worth having in front of you
 * before changing it a third time:
 *
 *   - `32bcaadf` introduced it as it stands — one attributable label is enough.
 *   - `cd417686` inverted it, so any excluded label vetoed the whole action. The
 *     case was AC-6183, "CCP · Maintenance — metal found on magnet check", which
 *     charged three points to the shift leader. Metal on a magnet is the machine or
 *     the raw material, and the magnet check catching it is the system working.
 *   - This commit restores the original rule, deliberately, with AC-6183 known and
 *     accepted as the cost.
 *
 * The reasoning for going back: a veto rule means one label removes a penalty, and
 * nothing on the leader's total shows that it happened. Anyone who works out that
 * adding "Maintenance" to a genuine paperwork error clears it has a lever nobody
 * audits, and the number stops meaning anything. Charging the occasional machine
 * fault is a visible, arguable error on a single action; a silent lever is neither.
 *
 * The AC-6183 shape is real and is NOT solved here — it is pushed to where it can be
 * seen. When a genuine machine fault carries an attributable label alongside, the fix
 * is Quality removing the label that does not belong, on the action, in its history.
 */
export function countsAgainstLeader(
  action: { labels?: string[] | null },
  excluded: Set<string>,
): boolean {
  const labels = (action.labels ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean);
  if (labels.length === 0) return true;
  return labels.some((l) => !excluded.has(l));
}

/**
 * Whether an action's DEPARTMENT makes it the leader's to answer for.
 *
 * A veto — and yes, that is the exact rule the labels above refuse, so read this
 * before assuming one of the two is a mistake.
 *
 * The label veto was reverted (`cd417686`) because a label lives in a SET: anyone who
 * worked out that adding "Maintenance" to a genuine paperwork error cleared it had a
 * lever nobody audits, and nothing on the leader's total showed it had been pulled.
 *
 * A department cannot be that lever. There is exactly one per action, it is the field
 * the person logging it picks on the way in, and it prints in its own column on the
 * list, in the detail panel and in the export. Choosing "Maintenance" is not a value
 * hidden inside a set — it IS the claim about whose problem this is, made in the one
 * place built to make it, where a supervisor scanning the week can see it.
 *
 * So the lever the label rule guards against does not exist here, and the veto buys
 * what the factory actually asked for: a machine failure stops charging the person who
 * was running the line that night, without Quality having to remember to also strip a
 * label off the action.
 *
 * An action with NO department counts, for the same reason a blank label list counts:
 * leaving the field empty must never quietly remove a deviation from somebody's score.
 */
export function countsAgainstLeaderDepartment(
  action: { department?: string | null },
  excluded: Set<string> = excludedDepartmentSet(),
): boolean {
  const department = (action.department ?? "").trim().toLowerCase();
  if (!department) return true;
  return !excluded.has(department);
}

/**
 * What each label is worth, from `quality_options.points`, keyed lowercase.
 *
 * Module-level and pushed in by `useLabelPointsSync`, for the same reason the
 * severity weights are: the callers are plain functions inside charts, table cells
 * and PDF builders, and threading a map through all of them would be a lot of churn
 * for one number. Empty until it loads, and empty means "severity decides" — which
 * is also the correct answer offline and in tests.
 */
let LABEL_POINTS: Record<string, number> = {};

export function setLabelPoints(map: Record<string, number>) {
  LABEL_POINTS = Object.fromEntries(
    Object.entries(map ?? {}).map(([k, v]) => [k.trim().toLowerCase(), v]),
  );
  listeners.forEach((l) => l());
}

/**
 * The hazard list's prices, held apart from the quality labels' on purpose.
 *
 * One flat map would have been less code and it would have re-scored history. Safety
 * occurrences logged before the two lists split carry QUALITY labels — Foreign Body,
 * GMP — because that was the only list there was, and `labelsForDomain` still shows
 * them so they can be unticked. With one map, pricing Foreign Body at 5 for the
 * quality log would have started charging those old occurrences 5 as well, silently,
 * for a decision nobody made about safety.
 *
 * So the domain picks the map: a safety row is priced by the hazard list and by
 * nothing else, and a quality row by the quality list and by nothing else. Maintenance
 * is in neither, which is what "shown, never charged" means in practice.
 */
let HAZARD_POINTS: Record<string, number> = {};

export function setHazardPoints(map: Record<string, number>) {
  HAZARD_POINTS = Object.fromEntries(
    Object.entries(map ?? {}).map(([k, v]) => [k.trim().toLowerCase(), v]),
  );
  listeners.forEach((l) => l());
}

/** The prices in force for one domain's own list. See `setHazardPoints`. */
function priceMapFor(domain: string | null | undefined): Record<string, number> {
  return domain === "safety" ? HAZARD_POINTS : LABEL_POINTS;
}

/**
 * The departments that are NOT the leader's to answer for, lowercased.
 *
 * Module-level and pushed in by `useDepartmentAttributionSync`, exactly like the label
 * prices above and for the same reason: the callers are plain functions inside charts,
 * table cells and PDF builders, and threading a set through all of them would be a lot
 * of churn for one lookup.
 *
 * Held differently from the LABEL exclusion set, which `livePoints` demands as an
 * argument and refuses to default. That rule is not being relaxed by accident, so here
 * is the difference that makes a default safe here and unsafe there:
 *
 *   - Empty means "nothing is excluded", which is also what an unloaded query looks
 *     like. Both sets share that ambiguity.
 *   - For the label set the codebase decided the ambiguity had to be forced into the
 *     caller's face. Fine — and it stays forced.
 *   - The direction of the error is what matters, and it is the SAME here: an empty
 *     set charges a leader for something that may not be theirs. Too high, on screen,
 *     arguable. It never scores anybody green who should not be.
 *   - And the number that ends up on a scorecard is `points_at_creation`, frozen in
 *     the database by `action_points_at` — which reads its own versioned copy of this
 *     set and never consults this one. `actionPoints` returns the frozen figure
 *     without calling `livePoints` at all. This set governs the preview and the
 *     explanation, not the record.
 *
 * If that last point ever stops being true, this default has to go with it.
 */
let EXCLUDED_DEPARTMENTS: Set<string> = new Set();

/** Takes the option rows as `{ [department]: counts_against_leader }`. */
export function setExcludedDepartments(map: Record<string, boolean>) {
  EXCLUDED_DEPARTMENTS = new Set(
    Object.entries(map ?? {})
      .filter(([, counts]) => counts === false)
      .map(([dept]) => dept.trim().toLowerCase())
      .filter(Boolean),
  );
  listeners.forEach((l) => l());
}

/** The departments in force right now, lowercased. */
export function excludedDepartmentSet(): Set<string> {
  return EXCLUDED_DEPARTMENTS;
}

/**
 * What one label is worth on an action of this domain. Zero means it does not price it.
 *
 * The domain is not decoration: the same text can be priced on the quality list and
 * absent from the hazard list, and on a safety row the second answer is the right one.
 */
export function labelPoints(label: string, domain?: string | null): number {
  return priceMapFor(domain)[label.trim().toLowerCase()] ?? 0;
}

/**
 * The ceiling on what an action's labels may charge between them.
 *
 * Three priced labels used to be able to sum past the top of the severity scale with
 * nobody deciding that they should. Foreign Body 5 + GMP 15 + Paperwork 5 is 25 on a
 * scale whose worst single grade is 20 — a number the scale cannot express, arrived at
 * by addition rather than by judgement.
 *
 * DEFAULTS TO UNCAPPED, which is a deliberate departure from the specification. That
 * asked for an initial value equal to Critical's points, and in this system that would
 * not have been a ceiling — it would have been a silent price cut. Labels here are
 * priced ABOVE the top grade on purpose: `severityForPoints` documents 5 as "reachable
 * only by pricing a label", and a Foreign Body priced at 5 against a Critical of 4
 * would have been quietly charged 4 from the day this shipped. Lowering what a food
 * safety label costs, as a side effect of adding a safety rail, is the exact opposite
 * of what the rail is for.
 *
 * So it ships uncapped and the ceiling becomes a decision somebody takes on purpose, in
 * `leader_scorecard_threshold` as CAP_LabelPoints — the same shape as every label
 * shipping at 0. On the day it lands, nobody's score moves.
 *
 * It is NOT held in this module's own config the way the prices are. It is a scoring
 * parameter, and a scoring parameter that is not versioned re-scores history the moment
 * it moves — which is the door 20260822090000 exists to close. It therefore lives in
 * `leader_scorecard_threshold`, dated, and resolves through the action's own scoring
 * version. Until that row is read into this module the default below applies.
 */
let LABEL_POINTS_CAP: number | null = null;

export function setMaxLabelPoints(cap: number | null) {
  LABEL_POINTS_CAP = cap;
  listeners.forEach((l) => l());
}

export function maxLabelPoints(): number {
  return LABEL_POINTS_CAP ?? Infinity;
}

/**
 * The price the labels put on an action, or 0 if none of them price it.
 *
 * Excluded labels are skipped, not just the action they sit on. Otherwise
 * "Maintenance is not the leader's" would hold for the attribution rule and fail for
 * the score, and the exclusion would come back in through the points.
 */
export function labelChargeFor(
  action: { labels?: string[] | null; domain?: string | null },
  excluded: Set<string>,
): number {
  const prices = priceMapFor(action.domain);
  return (action.labels ?? [])
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !excluded.has(l))
    .reduce((sum, l) => sum + (prices[l] ?? 0), 0);
}

/**
 * What the log form's Points box must show, and where the number came from.
 *
 * The box was wired to the severity alone. That was right until a label could carry a
 * price: with Foreign Body at 5 and High selected, the form said 4 and `actionPoints`
 * charged 5 — the screen and the database disagreeing about the same action, which is
 * the one thing this module keeps having to fix.
 *
 * So it answers the first branch of `actionPoints` and nothing else. `pricedByLabels`
 * false means "the labels do not price this", which is the form's cue to leave the
 * severity in charge and the box editable.
 *
 * `sources` is for the line under the box: whoever is logging the action should be
 * able to see WHICH label put the number there, not just that something did.
 *
 * Excluded labels are skipped for the same reason `labelChargeFor` skips them — a
 * label that is not the leader's to answer for must not price their action, or the
 * exclusion comes back in through the points.
 */
export interface LogFormCharge {
  points: number;
  pricedByLabels: boolean;
  sources: Array<{ label: string; points: number }>;
  /**
   * The severity the price names, for the form to fill in beside the number.
   *
   * `null` means the labels do not price this at all. `""` means they price it at a
   * number no severity carries (5 + 3 = 8, and nothing is worth 8): the grade is
   * genuinely absent, and guessing a neighbouring one would put a severity on the
   * card that nobody chose.
   */
  severity: string | null;
  /**
   * The department this action is booked to, when that department charges nobody.
   *
   * `null` for every other case, INCLUDING a blank department — a form that has not
   * been filled in yet must read as "not decided", never as "charged to nobody".
   *
   * Named rather than a boolean because the sentence has to say which one: "Maintenance
   * is charged to nobody" is a fact the person can act on — change the department, or
   * leave it and know why the action costs nothing. "This is charged to nobody" sends
   * them looking for the reason.
   */
  chargedToNobody: string | null;
}

/**
 * @param department the department picked on the form, so the preview can answer the
 *   same question the freeze trigger will. Optional, and defaulting to undefined rather
 *   than to a lookup, because the form is the only caller that has one.
 */
export function logFormCharge(
  labels: string[],
  excluded: Set<string>,
  weights: Record<string, number> = severityPointsMap(),
  department?: string | null,
  excludedDepartments: Set<string> = excludedDepartmentSet(),
  /**
   * Which list prices these chips. Last and optional because every existing caller is
   * a quality form, and undefined is exactly what those forms mean.
   */
  domain?: string | null,
): LogFormCharge {
  const sources = labels
    .map((label) => ({ label, points: labelPoints(label, domain) }))
    .filter((s) => s.points > 0 && !excluded.has(s.label.trim().toLowerCase()));

  /**
   * The department veto, applied here for the same reason it is applied first in
   * `livePoints` and in `action_points_at`: it decides whether there is anything to
   * price at all.
   *
   * Without it this function priced the labels and the grade, and the form printed a
   * number the database was about to overwrite with 0. A form that promises what the
   * trigger refuses is worse than a form with no summary — the number is read once, at
   * the only moment the person could still have changed what they were logging.
   */
  if (!countsAgainstLeaderDepartment({ department }, excludedDepartments)) {
    return {
      points: 0,
      pricedByLabels: false,
      // Kept, not cleared. The ticked chips still show what they would have cost, which
      // is what makes the sentence below readable as a decision rather than a glitch.
      sources,
      severity: null,
      chargedToNobody: (department ?? "").trim(),
    };
  }

  const points = sources.reduce((sum, s) => sum + s.points, 0);
  const pricedByLabels = points > 0;
  return {
    points,
    pricedByLabels,
    sources,
    severity: pricedByLabels ? severityForPoints(points, weights) ?? "" : null,
    chargedToNobody: null,
  };
}

/**
 * One sentence saying what the action about to be logged will cost, and why.
 *
 * The log form no longer asks for a severity or a points figure — `actionPoints()`
 * charges the labels and only falls back to the grade, so the two boxes mostly showed
 * a number the system did not use. This sentence is what replaces them, and it is
 * rendered unconditionally: the zero case is the one that matters most, because a
 * deviation logged in good faith that quietly scores nothing is how a leader's
 * scorecard loses it.
 *
 * The number leads. Whoever is logging the action needs to read the price first and
 * the arithmetic second.
 */
export function chargeSummary(charge: LogFormCharge, picked?: string | null): string {
  /**
   * The grade the person logging this actually chose, when the form asks for one.
   *
   * Optional because it did not use to exist: the form derived the grade from the
   * labels, so there was nothing to pass. With MAX in force the grade is half the
   * comparison, and a summary that ignored it would tell somebody their Critical action
   * scores 0 because they have not ticked a priced label — which is exactly the sentence
   * that made the old rule invisible, printed on the screen where the action is created.
   */
  /**
   * First, above the grade and above the labels, because it overrides both.
   *
   * Printed before `gradePoints` is even read: the branch below would otherwise
   * announce "Charged 4p — the Critical grade" for an action the trigger freezes at 0.
   */
  if (charge.chargedToNobody) {
    return `Charged 0p — ${charge.chargedToNobody} is charged to nobody. The action is recorded in full and costs no leader a point.`;
  }

  const gradePoints = picked ? severityPoints(picked) : 0;
  const capped = Math.min(charge.points, maxLabelPoints());

  // One branch, not two: with no priced label `capped` is 0, so a graded action always
  // lands here and never falls through to the "scores 0" sentence below.
  if (gradePoints > capped) {
    const name = severityMeta(picked)?.label ?? picked;
    return charge.pricedByLabels
      ? `Charged ${gradePoints}p — the ${name} grade. Its labels charge ${capped}, and a label can only raise a charge.`
      : `Charged ${gradePoints}p — the ${name} grade. No priced label.`;
  }

  if (!charge.pricedByLabels) return "No priced label — this action scores 0.";
  const from = charge.sources.map((s) => `${s.label} ${s.points}p`).join(" + ");
  const grade = charge.severity ? severityMeta(charge.severity)?.label ?? charge.severity : null;
  // `severity: ""` — priced at a total no grade carries. Say so rather than rounding to
  // a neighbouring severity nobody chose; the action still costs what it costs.
  if (!grade) {
    return `Charged ${charge.points}p, ungraded — no severity is worth ${charge.points}p. ${from}.`;
  }
  return `Charged ${charge.points}p (${grade}) — ${from}.`;
}

/**
 * The line beneath the summary when a ticked label is not this leader's to answer for.
 *
 * `chargeSummary` prices only the labels that count, so without this the form would
 * show a ticked "Maintenance 3p" chip and a total that does not include it, with no
 * explanation. Names them — "some labels" would leave the reader to work out which.
 */
export function excludedLabelNote(labels: string[], excluded: Set<string>): string | null {
  const hit = labels.filter((l) => excluded.has(l.trim().toLowerCase()));
  if (!hit.length) return null;
  if (hit.length === 1) return `${hit[0]} is not this leader's — it will not count toward their score.`;
  const named = `${hit.slice(0, -1).join(", ")} and ${hit[hit.length - 1]}`;
  return `${named} are not this leader's — they will not count toward their score.`;
}

/**
 * What one action costs the leader it was raised against.
 *
 * Zero if Quality rejected it, zero if its labels are not the leader's. Otherwise the
 * price its labels carry — and only if they carry none, the severity weight. THE
 * definition — the table, the chart, the scorecard and the line indicators all call
 * this, so the same leader reads the same number on all four.
 *
 * Labels beat severity because they answer the narrower question. Severity grades a
 * deviation in the abstract; a label says what actually happened, and a foreign body
 * is not a paperwork slip whatever either one was graded. Every label ships at 0, so
 * until Quality prices one this is exactly the old behaviour.
 *
 * FROZEN AT CREATION, since 20260822090000. `points_at_creation` carries what this
 * action was worth under the scale in force on its own date, and when the row has one
 * it IS the answer — the four rules below then describe how that number was reached,
 * not how it is reached now.
 *
 * This reverses what this comment said for two months ("still derived, never stored:
 * re-pricing a label re-scores the history"). That was written as a virtue and it was
 * an audit finding: re-pricing a label in November rewrote July, so the leader ranking
 * compared periods measured with different rulers, a report printed in August stopped
 * reproducing, and in a BRC audit there was no way to show which criterion was in force
 * on the date of the event. Correcting a misclassification still moves the figure — the
 * database recomputes it against the action's OWN version, and stamps
 * `points_recalculated_at`. The fact gets corrected; the ruler does not.
 *
 * The live fallback is not decoration. A row arrives without the column in two real
 * cases: a database where 20260822090000 has not run, and a query whose explicit column
 * list forgot to ask for it. The second is the dangerous one, because it looks like
 * nothing at all — see src/__tests__/frozenPointsInSelects.test.ts, which exists because
 * exactly that shape of bug once cost a leader his entire quality section.
 *
 * `excluded` comes from `useLabelAttribution`. Passing an empty set is the correct
 * behaviour for "nothing is excluded", which means callers must NOT pass an empty set
 * while the attribution table is still loading — see `useLeaderAttribution`.
 *
 * See `standsAgainstLeader` below for its twin: ONE rule about safety, expressed
 * twice because there are two questions — what is it worth, and does it count at all.
 * Change the domain guard here, change it there too.
 */
export interface ScorableAction {
  domain?: string | null;
  severity: string | null;
  labels?: string[] | null;
  validation_status?: string | null;
  /**
   * Whose problem this is, as picked on the log form.
   *
   * A scoring input since departments got their own attribution — see
   * `countsAgainstLeaderDepartment`. It was on every action already; only the type
   * did not admit it, so nothing could be written against it.
   */
  department?: string | null;
  /** What this action was worth under the scale of its own day. See `actionPoints`. */
  points_at_creation?: number | null;
}

/**
 * The charge computed against TODAY's rulers, ignoring anything frozen.
 *
 * Split out so the frozen figure and the live one can be compared — which is the only
 * way `pointsBreakdown` can notice that the scale has moved since and say so, instead
 * of printing today's arithmetic beside yesterday's total and letting the reader work
 * out that the two do not add up.
 */
export function livePoints(
  action: ScorableAction,
  excluded: Set<string>,
  excludedDepartments: Set<string> = excludedDepartmentSet(),
): number {
  if (isRejected(action)) return 0;
  // Before the labels, because it is the broader claim: the department says the action
  // belongs to somebody else entirely, and no label can argue it back.
  if (!countsAgainstLeaderDepartment(action, excludedDepartments)) return 0;
  if (!countsAgainstLeader(action, excluded)) return 0;

  /**
   * A label may AGGRAVATE an action. It may never soften one.
   *
   * This was `labelChargeFor(...) || severityPoints(...)` — the label total REPLACED
   * the grade. The consequence was a silent downgrade in the direction that hurts: an
   * action graded Critical carrying one label priced at 1 was worth 1, while the card
   * went on showing "Critical" in red. Nobody could see it, because the only place the
   * two numbers meet is inside this expression.
   *
   * MAX also subsumes the old fall-through — no priced label means a label charge of 0,
   * and MAX(0, grade) is the grade — so the case the previous rule was written for
   * still behaves exactly as it did.
   */
  const fromLabels = Math.min(labelChargeFor(action, excluded), maxLabelPoints());

  /**
   * Safety is charged by its priced hazard and by NOTHING else.
   *
   * This used to be a flat `return 0` above every other rule, on the reasoning that a
   * score punishing the report teaches the team to stop reporting. That reasoning is
   * still right about the report, and it is why the severity grade is dropped here:
   * an unpriced hazard is 0 however badly it is graded, so nobody can start charging
   * occurrences by re-grading them, and a near miss stays free by default.
   *
   * What changed is that Health & Safety may now price a hazard deliberately, one row
   * at a time, on a screen that says so — see qualityListGroups.ts. Pricing PPE at 2
   * is a decision somebody makes and can be read back off the list; grading an
   * occurrence Critical is not.
   *
   * Change this, change `standsAgainstLeader` below in the same commit. The two have
   * gone out of step over exactly this guard once already.
   */
  if (action.domain === "safety") return fromLabels;

  return Math.max(fromLabels, severityPoints(action.severity));
}

export function actionPoints(
  action: ScorableAction,
  excluded: Set<string>,
  excludedDepartments: Set<string> = excludedDepartmentSet(),
): number {
  const frozen = action.points_at_creation;
  if (frozen !== null && frozen !== undefined && Number.isFinite(frozen)) return frozen;
  return livePoints(action, excluded, excludedDepartments);
}

/**
 * The same number `actionPoints` returns, with the arithmetic that produced it.
 *
 * `actionPoints` is the authority and stays the authority: this calls it for the
 * total rather than re-deriving one, so the explanation can never drift from the
 * score it explains. Everything else here is the reasoning made printable.
 *
 * It exists because of a real, unanswerable screen. An action labelled
 * "Batch code · Maintenance" showed 5 points, and no one could tell from the module
 * whether that was Batch code 2 + Maintenance 3 with the attribution rule not in
 * force, or Batch code priced at 5 with Maintenance already costing nothing. One is
 * a leader being charged for a machine failure; the other is the system working. A
 * score people are appraised on has to be auditable from the screen it appears on.
 *
 * `spared` is the half that was missing everywhere: a total that has quietly had
 * something removed looks identical to a total that never had it. Naming the label
 * AND its price is what makes the rule visible — including the awkward case where
 * skipping it changes the total by nothing because the severity then pays in full.
 */
export type PointsBasis = "safety" | "rejected" | "not_leaders" | "labels" | "severity" | "unpriced" | "frozen" | "severity_over_labels";

export interface PointsBreakdown {
  /** Always equal to `actionPoints` for the same arguments. */
  points: number;
  basis: PointsBasis;
  /** The labels that priced it, in the order they sit on the action. */
  charged: Array<{ label: string; points: number }>;
  /** Priced labels skipped because they are not this leader's. */
  spared: Array<{ label: string; points: number }>;
  /** One sentence, ready to print. The number leads; the arithmetic follows. */
  explanation: string;
}

/** "Batch code 2 + Foreign Body 5" — the sum written out, never abbreviated to a total. */
function sumInWords(parts: Array<{ label: string; points: number }>): string {
  return parts.map((p) => `${p.label} ${p.points}`).join(" + ");
}

/** "Maintenance is not the leader's, so its 3 is not charged." */
function sparedNote(spared: Array<{ label: string; points: number }>): string {
  if (!spared.length) return "";
  const named = spared.map((s) => s.label);
  const subject = named.length === 1 ? `${named[0]} is` : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]} are`;
  const total = spared.reduce((sum, s) => sum + s.points, 0);
  return ` ${subject} not the leader's, so ${named.length === 1 ? "its" : "their"} ${total} is not charged.`;
}

export function pointsBreakdown(
  action: ScorableAction,
  excluded: Set<string>,
): PointsBreakdown {
  const priced = (action.labels ?? [])
    .map((label) => ({ label, points: labelPoints(label, action.domain) }))
    .filter((p) => p.points > 0);
  const charged = priced.filter((p) => !excluded.has(p.label.trim().toLowerCase()));
  const spared = priced.filter((p) => excluded.has(p.label.trim().toLowerCase()));
  const points = actionPoints(action, excluded);
  const base = { points, charged, spared };

  /**
   * The scale moved after this action was logged, so every sentence below would be
   * arithmetic about a total that is no longer this action's.
   *
   * This is the failure mode the whole module keeps closing, arriving through a new
   * door: a card reading "20 points — Foreign Body 5 + GMP 15" beside a frozen 8 is
   * worse than a card that explains nothing, because the reader checks the sum, finds
   * it wrong, and stops believing the number rather than the explanation. Both figures
   * are named instead, and which one is being charged is said outright.
   *
   * Only when they actually DIFFER. An action whose scale has not moved gets its
   * ordinary explanation, which is almost every action almost all of the time.
   */
  const live = livePoints(action, excluded);
  if (points !== live) {
    return {
      ...base,
      basis: "frozen",
      explanation:
        `${points} points — the scale in force when this was logged. ` +
        `Today's scale would make it ${live}; past actions keep the scale of their own day.`,
    };
  }

  // The three zeroes, told apart. "0" alone is the answer that made people distrust
  // the module: a deviation logged in good faith and a deviation Quality threw out
  // look the same on a card, and only one of them should.
  // Only when it IS a zero. A priced hazard falls through to the ordinary label
  // explanation below, which names the hazard and what it charged — the reader has to
  // be able to see where the points on a safety row came from.
  if (action.domain === "safety" && points === 0) {
    return {
      ...base,
      basis: "safety",
      explanation: "No priced hazard on this occurrence — reporting it costs the leader nothing.",
    };
  }
  if (action.validation_status === "rejected") {
    return { ...base, basis: "rejected", explanation: "Quality rejected this — it is not charged." };
  }
  if (!countsAgainstLeader(action, excluded)) {
    const named = (action.labels ?? []).join(", ");
    return { ...base, basis: "not_leaders", explanation: `${named} is not the leader's — this is not charged to them.` };
  }

  if (charged.length) {
    const raw = charged.reduce((sum, c) => sum + c.points, 0);
    const cap = maxLabelPoints();
    const fromLabels = Math.min(raw, cap);
    const fromSeverity = severityPoints(action.severity);
    // "24 pts — labels: Foreign Body + GMP", capped at 20 if a ceiling is set.
    const capNote = raw > cap ? ` Their ${raw} is capped at ${cap}.` : "";

    /**
     * Which of the two won, said outright.
     *
     * Under the old rule the labels always won when there were any, so naming them was
     * the whole explanation. Under MAX they can lose, and a card that listed
     * "Batch code 2" beside a total of 20 would be arithmetic nobody can follow — the
     * reader checks the sum, finds it wrong, and stops trusting the number. Both sides
     * are named and the winner is stated.
     */
    if (fromSeverity > fromLabels) {
      const grade = severityMeta(action.severity)?.label ?? action.severity;
      return {
        ...base,
        basis: "severity_over_labels",
        explanation:
          `${points} points — the ${grade} grade. Its labels would charge ${fromLabels}` +
          ` (${sumInWords(charged)}), and a label can only ever raise a charge, never lower it.` +
          `${capNote}${sparedNote(spared)}`,
      };
    }
    return {
      ...base,
      basis: "labels",
      explanation: `${points} points — ${sumInWords(charged)}.${capNote}${sparedNote(spared)}`,
    };
  }

  const grade = severityMeta(action.severity)?.label;
  if (grade) {
    // The fall-through worth seeing: an excluded price left nothing behind it, so the
    // grade pays in full and the exclusion moved the total by nothing. Documented in
    // `actionPoints` as accepted — but silent, it reads as the rule failing.
    return { ...base, basis: "severity", explanation: `${points} points from the ${grade} grade — no label here carries a price.${sparedNote(spared)}` };
  }
  return { ...base, basis: "unpriced", explanation: `No priced label and no grade — this scores 0.${sparedNote(spared)}` };
}

/** Total charged across a set of actions. Filter the set first; this only weighs it. */
export function sumActionPoints(
  actions: ScorableAction[],
  excluded: Set<string>,
): number {
  return actions.reduce((sum, a) => sum + actionPoints(a, excluded), 0);
}

/**
 * Whether an action stands at all — used for counts, where points are not the answer.
 *
 * ONE rule, expressed twice on purpose, right beside `actionPoints` above: the two
 * functions answer two different questions — what is it worth (`actionPoints`) and
 * does it count against the leader at all (`standsAgainstLeader`) — and a safety row
 * answers "no" to both. They must be changed together. This guard went missing once
 * already: `actionPoints` learned the domain rule, this one did not, and safety rows
 * kept counting as quality activity in `leaderScore.qualityScore` and in
 * ControlCentreHome's open / severe / awaiting-verdict tiles until it was added back.
 */
export function standsAgainstLeader(
  action: {
    domain?: string | null;
    labels?: string[] | null;
    department?: string | null;
    validation_status?: string | null;
  },
  excluded: Set<string>,
  excludedDepartments: Set<string> = excludedDepartmentSet(),
): boolean {
  if (!countsAgainstLeaderDepartment(action, excludedDepartments)) return false;
  if (isRejected(action) || !countsAgainstLeader(action, excluded)) return false;
  // A safety occurrence stands exactly when it costs something. That is the invariant
  // this function exists to hold with `livePoints`: anything worth points must also
  // count, or a leader is charged for a row the same screen says does not stand.
  // Unpriced — the ordinary near miss — still answers no, as it always has.
  if (action.domain === "safety") return labelChargeFor(action, excluded) > 0;
  return true;
}


// ── Validation lifecycle ─────────────────────────────────────────────────────
//
// Separate from `status`, which is the kanban column (to do / in progress /
// complete). This is the question an audit asks: is the deviation real, who said so,
// and on what evidence. Only `validated` ever costs a leader points.

export type ValidationStatus =
  | "open"
  | "under_investigation"
  | "validated"
  | "rejected";

export interface ValidationState {
  value: ValidationStatus;
  label: string;
  badge: string;
  /** What it means for the scorecard. */
  hint: string;
}

export const VALIDATION_STATES: ValidationState[] = [
  { value: "open", label: "Open", badge: "bg-muted text-muted-foreground border-border", hint: "Raised, not yet investigated. No effect on any score." },
  { value: "under_investigation", label: "Under investigation", badge: "bg-primary/15 text-primary border-primary/40", hint: "Being looked into. No effect on any score." },
  { value: "validated", label: "Validated", badge: "bg-destructive/15 text-destructive-strong border-destructive/40", hint: "Confirmed by Quality. This is the only state that affects the leader's score." },
  { value: "rejected", label: "Rejected", badge: "bg-muted text-muted-foreground border-border", hint: "Not a real deviation. No effect on any score." },
];

/**
 * Closure is not a verdict, so it is not one of the states above.
 *
 * It used to be: "closed" was a fifth value of the same field, which meant closing a
 * validated action overwrote the verdict and the leader's penalty silently vanished
 * the moment somebody tidied the board. Closure now sits beside the verdict —
 * closed_at / closed_by — and only a manager may set it.
 */
export function isClosed(a: { closed_at?: string | null }): boolean {
  return !!a.closed_at;
}

export function validationMeta(value: string | null | undefined): ValidationState {
  return VALIDATION_STATES.find((v) => v.value === value) ?? VALIDATION_STATES[0];
}

/**
 * The label that makes an action a documentation error.
 *
 * One label, per the specification: a missing signature, an incomplete form, a record
 * written outside its window, a wrong stop code. Widening this to Label or Batch code
 * would change what a leader is scored on, so it is a decision to take openly rather
 * than a list to grow quietly.
 */
export const DOCUMENTATION_LABEL = "Paperwork";

/**
 * What a leader loses per validated documentation error, when Quality has not priced
 * the label. The fallback, not the rule — see `documentationPenaltyPct`.
 */
export const DOCUMENTATION_PENALTY_PCT = 5;

/**
 * The price of one validated documentation error.
 *
 * There is ONE place to set what a Paperwork error is worth — the label's points in
 * Lists & scoring — and this reads it. Before, the label carried a price for the
 * quality score and this block carried a separate hard-coded 5, so pricing the label
 * at 10 left two different answers on screen for the same error.
 *
 * Unpriced falls back to the old 5, on the same reasoning as `actionPoints`: every
 * label ships at 0, and 0 means "no price set", not "free". So the day this lands,
 * nobody's documentation score moves.
 *
 * Worth stating plainly, because it is a management decision and not an oversight: a
 * validated Paperwork error is charged TWICE — once as quality points through
 * `actionPoints`, and again as this demerit. One error is both a quality event and a
 * formal documentation failure, and the scorecard is built to say so. Pricing the
 * label therefore moves both components at once.
 */
export function documentationPenaltyPct(): number {
  return labelPoints(DOCUMENTATION_LABEL) || DOCUMENTATION_PENALTY_PCT;
}

/** True when an action counts against the leader's documentation score. */
export function isValidatedPaperwork(a: {
  labels?: string[] | null;
  validation_status?: string | null;
}): boolean {
  return a.validation_status === "validated" && (a.labels ?? []).includes(DOCUMENTATION_LABEL);
}

/** 100 minus the label's price for each validated documentation error, never below zero. */
export function documentationScore(validatedPaperworkCount: number): number {
  return Math.max(0, 100 - validatedPaperworkCount * documentationPenaltyPct());
}

// ── Safety vocabulary ────────────────────────────────────────────────────────
//
// The kinds a safety occurrence can be. Kept apart from `QUALITY_SEVERITIES`: safety
// is counted, never scored (see `actionPoints`), and what one occurrence IS matters
// more than how severe it was.

export interface SafetyKind {
  value:
    | "lost_time_injury" | "reportable_accident" | "first_aid" | "near_miss"
    | "safety_observation" | "toolbox_talk" | "ppe_breach";
  label: string;
  /**
   * What sort of fact this is, and the reason the three are never added together:
   *   harm       — it already hurt somebody
   *   signal     — it did not hurt anybody, and reporting it is the good outcome
   *   prevention — activity done on purpose, counted against a weekly minimum
   */
  group: "harm" | "signal" | "prevention";
  /** Tailwind classes for a badge. */
  badge: string;
}

export const SAFETY_KINDS: SafetyKind[] = [
  { value: "lost_time_injury",   label: "Lost-time injury",   group: "harm",       badge: "bg-destructive/15 text-destructive-strong border-destructive/40" },
  { value: "reportable_accident", label: "Reportable accident", group: "harm",      badge: "bg-destructive/15 text-destructive-strong border-destructive/40" },
  { value: "first_aid",          label: "First aid",          group: "harm",       badge: "bg-warning/15 text-warning-strong border-warning/40" },
  { value: "near_miss",          label: "Near miss",          group: "signal",     badge: "bg-primary/15 text-primary border-primary/40" },
  { value: "safety_observation", label: "Safety observation", group: "prevention", badge: "bg-muted text-muted-foreground border-border" },
  { value: "toolbox_talk",       label: "Toolbox talk",       group: "prevention", badge: "bg-muted text-muted-foreground border-border" },
  { value: "ppe_breach",         label: "PPE breach",         group: "signal",     badge: "bg-warning/15 text-warning-strong border-warning/40" },
];

export function safetyKindMeta(value: string | null | undefined): SafetyKind | null {
  return SAFETY_KINDS.find((k) => k.value === value) ?? null;
}

/**
 * What the three groups above MEAN, in the words the form puts on screen.
 *
 * The grouping was already in `SAFETY_KINDS` and was visible only as a separator
 * line inside a dropdown, which is a hint nobody reads. It carries the one thing
 * this module must never let a user get wrong: first aid and near miss are not
 * degrees of the same event. One is somebody already hurt, the other is the warning
 * that arrived in time — and `scorecard_safety_counts` is emphatic that the two are
 * never summed. Naming the groups on the form is how that rule reaches the person
 * holding the tablet, at the moment they are deciding.
 *
 * `harm` first, deliberately. Not because it is the common case — it is the rarest —
 * but because a list that opens with Toolbox talk invites the reader to scan for the
 * mildest thing that fits.
 */
export interface SafetyKindGroup {
  group: SafetyKind["group"];
  title: string;
  /** One line under the title, in the voice of what the reader is deciding. */
  hint: string;
}

export const SAFETY_KIND_GROUPS: SafetyKindGroup[] = [
  { group: "harm", title: "Harm", hint: "Someone was hurt" },
  { group: "signal", title: "Signal", hint: "A warning that arrived in time" },
  { group: "prevention", title: "Prevention", hint: "Work done before anything happened" },
];

/**
 * The kinds that mean somebody was actually hurt.
 *
 * Exported rather than written out at the call site because the Safety board counts
 * them and `scorecard_safety_counts` counts the same three as separate columns —
 * a fourth `harm` kind added to `SAFETY_KINDS` must reach the board without anyone
 * remembering to come back here.
 */
export function isHarmKind(value: string | null | undefined): boolean {
  return safetyKindMeta(value)?.group === "harm";
}

/**
 * The hazards a safety occurrence is logged against.
 *
 * A separate list from `QUALITY_LABELS`, because the quality one describes none of
 * them: the safety form used to offer Batch code, CCP and Foreign Body, which is why
 * safety occurrences were logged with no label at all. Held here as the fallback for
 * `quality_options` rows of kind `safety_label`, exactly as the quality list is —
 * so the chips read correctly before the seed reaches a database, and offline.
 *
 * Unpriced by design and not priceable in the manager: a safety occurrence scores 0,
 * always (see `actionPoints`), so a price on one of these would name a number that
 * never gets charged.
 */
/**
 * The breakdowns a maintenance label names.
 *
 * A list of its own rather than the single "Maintenance" chip the quality list has
 * carried since the start. That chip answered "was maintenance involved" and nothing
 * else, so every machine fault in the factory arrived at the scorecard as one word
 * and the log could not tell a seized bearing from a missing guard sensor.
 *
 * Deliberately disjoint from both other lists — `Electrical fault` here against
 * `Electrical` on the safety list, which is the hazard of touching live equipment and
 * not the reason the line stopped. The log colours a chip by which list it came from,
 * and a word on two lists would take two colours.
 *
 * Priced but never charged: see CHARGING_LABEL_KINDS.
 */
export const MAINTENANCE_LABELS = [
  "Breakdown",
  "Bearing failure",
  "Belt / conveyor",
  "Sensor / photocell",
  "Air leak",
  "Electrical fault",
  "Lubrication",
  "Spare part missing",
  "Calibration",
] as const;

/**
 * The option kinds whose `points` actually reach a leader's total.
 *
 * Three lists carry a price and only two of them charge one. Quality actions always
 * have; Health & Safety now does, by an explicit decision recorded in
 * `qualityListGroups.ts`. Maintenance shows a price and never charges it — a machine
 * fault is not the person running the line that night, which is the same rule the
 * department attribution has enforced since 20260827093000.
 *
 * This constant is the ONE place that answers it. `chargingLabelPoints` below builds
 * the price map every score reads, and it is the only builder — so a fourth list
 * cannot start charging by accident, and this one cannot stop.
 */
export const CHARGING_LABEL_KINDS = ["label", "safety_label"] as const;

/**
 * The two price maps, built from the raw option rows and kept apart by kind.
 *
 * Pure and exported because the alternative — filtering inside the hook — is a rule
 * about money living in a data-fetching file where no test would ever look at it.
 * `maintenance_label` and `department` rows fall out here and reach neither map, which
 * is the whole enforcement of "shown, never charged".
 */
export function chargingLabelPoints(
  rows: { kind: string; value: string; points?: number | null }[],
): { labels: Record<string, number>; hazards: Record<string, number> } {
  const of = (kind: string) =>
    Object.fromEntries(
      rows.filter((r) => r.kind === kind).map((r) => [r.value, Number(r.points ?? 0)]),
    );
  return { labels: of("label"), hazards: of("safety_label") };
}

export const SAFETY_LABELS = [
  "Slip / trip / fall",
  "Manual handling",
  "Machine guarding",
  "PPE",
  "Chemical / COSHH",
  "Forklift / traffic",
  "Housekeeping",
  "Electrical",
] as const;

/**
 * The label chips one log form shows: its domain's list, plus whatever the action
 * already carries.
 *
 * The second half is the part worth keeping. Occurrences logged before the split
 * carry quality labels, and a form that showed only the safety list would drop them
 * on the next save without anybody seeing it go — the chip has to be on screen to be
 * unticked.
 */
export function labelsForDomain(
  domain: string | null | undefined,
  lists: { labels?: string[]; safetyLabels?: string[]; maintenanceLabels?: string[] },
  current: string[] = [],
): string[] {
  const configured = domain === "safety" ? lists.safetyLabels : lists.labels;
  const fallback = domain === "safety" ? SAFETY_LABELS : QUALITY_LABELS;
  const own = configured?.length ? configured : [...fallback];
  // Maintenance is a list INSIDE the quality log, not a domain of its own: the same
  // deviation is logged once and can be both a quality problem and a machine one, so
  // both sets of chips have to be on the same form. The safety form does not get them
  // — a hazard is graded against hazards.
  const list = domain === "safety" ? own : [...own, ...(lists.maintenanceLabels ?? [])];
  return [...list, ...current.filter((l) => l && !list.includes(l))];
}

/**
 * Which list a label on a logged action came from, or null if no list claims it.
 *
 * The action stores labels as plain text (`labels: string[]`), so the list is not on
 * the row — it is recovered by looking the text up in the configured options. Null is
 * a real and common answer: a label removed from a list, or renamed, stays on every
 * action already logged against it, and those chips must still render.
 */
export function labelKindOf(
  label: string,
  kinds: Record<string, string>,
): string | null {
  return kinds[label.trim().toLowerCase()] ?? null;
}

/**
 * The badge a label chip wears, by the list it came from.
 *
 * Four answers, four colours, because a chip that cannot say which list it belongs to
 * is why "Maintenance" and "CCP" read as the same kind of fact on the log today. The
 * neutral one is not a fallback nobody sees — it is what an unconfigured or renamed
 * label gets, and it has to read as "no list", not as a fourth list.
 */
export function labelBadge(kind: string | null | undefined): string {
  switch (kind) {
    case "label":
      return "bg-primary/15 text-primary border-primary/40";
    case "maintenance_label":
      return "bg-warning/15 text-warning-strong border-warning/40";
    case "safety_label":
      return "bg-destructive/15 text-destructive-strong border-destructive/40";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
