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
 * Points for one action, derived from its severity and the configured weight.
 *
 * Points are NOT a stored column: severity is the single source of truth, so
 * re-grading an action can never leave a stale score behind, and changing a weight
 * re-scores the history consistently. An action with no severity scores 0.
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

/** What one label is worth. Zero means it does not price an action. */
export function labelPoints(label: string): number {
  return LABEL_POINTS[label.trim().toLowerCase()] ?? 0;
}

/**
 * The price the labels put on an action, or 0 if none of them price it.
 *
 * Excluded labels are skipped, not just the action they sit on. Otherwise
 * "Maintenance is not the leader's" would hold for the attribution rule and fail for
 * the score, and the exclusion would come back in through the points.
 */
export function labelChargeFor(action: { labels?: string[] | null }, excluded: Set<string>): number {
  return (action.labels ?? [])
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !excluded.has(l))
    .reduce((sum, l) => sum + (LABEL_POINTS[l] ?? 0), 0);
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
}

export function logFormCharge(
  labels: string[],
  excluded: Set<string>,
  weights: Record<string, number> = severityPointsMap(),
): LogFormCharge {
  const sources = labels
    .map((label) => ({ label, points: LABEL_POINTS[label.trim().toLowerCase()] ?? 0 }))
    .filter((s) => s.points > 0 && !excluded.has(s.label.trim().toLowerCase()));
  const points = sources.reduce((sum, s) => sum + s.points, 0);
  const pricedByLabels = points > 0;
  return {
    points,
    pricedByLabels,
    sources,
    severity: pricedByLabels ? severityForPoints(points, weights) ?? "" : null,
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
export function chargeSummary(charge: LogFormCharge): string {
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
 * Still derived, never stored: re-pricing a label re-scores the history, the same way
 * re-weighting a severity does, and no action can be left holding a stale number.
 *
 * `excluded` comes from `useLabelAttribution`. Passing an empty set is the correct
 * behaviour for "nothing is excluded", which means callers must NOT pass an empty set
 * while the attribution table is still loading — see `useLeaderAttribution`.
 *
 * See `standsAgainstLeader` below for its twin: ONE rule about safety, expressed
 * twice because there are two questions — what is it worth, and does it count at all.
 * Change the domain guard here, change it there too.
 */
export function actionPoints(
  action: { domain?: string | null; severity: string | null; labels?: string[] | null; validation_status?: string | null },
  excluded: Set<string>,
): number {
  // Safety is counted, never charged. Reporting a near miss is the behaviour we want,
  // and a score that punishes the report teaches the team to stop reporting. This is
  // the ONLY place the rule lives: the leader card, the quality breakdown and Analytics
  // all read this function, so they cannot disagree about it.
  if (action.domain === "safety") return 0;
  if (isRejected(action)) return 0;
  if (!countsAgainstLeader(action, excluded)) return 0;
  return labelChargeFor(action, excluded) || severityPoints(action.severity);
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
export type PointsBasis = "safety" | "rejected" | "not_leaders" | "labels" | "severity" | "unpriced";

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
  action: { domain?: string | null; severity: string | null; labels?: string[] | null; validation_status?: string | null },
  excluded: Set<string>,
): PointsBreakdown {
  const priced = (action.labels ?? [])
    .map((label) => ({ label, points: LABEL_POINTS[label.trim().toLowerCase()] ?? 0 }))
    .filter((p) => p.points > 0);
  const charged = priced.filter((p) => !excluded.has(p.label.trim().toLowerCase()));
  const spared = priced.filter((p) => excluded.has(p.label.trim().toLowerCase()));
  const points = actionPoints(action, excluded);
  const base = { points, charged, spared };

  // The three zeroes, told apart. "0" alone is the answer that made people distrust
  // the module: a deviation logged in good faith and a deviation Quality threw out
  // look the same on a card, and only one of them should.
  if (action.domain === "safety") {
    return { ...base, basis: "safety", explanation: "Safety is counted, never charged — reporting it costs the leader nothing." };
  }
  if (action.validation_status === "rejected") {
    return { ...base, basis: "rejected", explanation: "Quality rejected this — it is not charged." };
  }
  if (!countsAgainstLeader(action, excluded)) {
    const named = (action.labels ?? []).join(", ");
    return { ...base, basis: "not_leaders", explanation: `${named} is not the leader's — this is not charged to them.` };
  }

  if (charged.length) {
    return { ...base, basis: "labels", explanation: `${points} points — ${sumInWords(charged)}.${sparedNote(spared)}` };
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
  actions: Array<{ severity: string | null; labels?: string[] | null; validation_status?: string | null }>,
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
  action: { domain?: string | null; labels?: string[] | null; validation_status?: string | null },
  excluded: Set<string>,
): boolean {
  if (action.domain === "safety") return false;
  return !isRejected(action) && countsAgainstLeader(action, excluded);
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
  lists: { labels?: string[]; safetyLabels?: string[] },
  current: string[] = [],
): string[] {
  const configured = domain === "safety" ? lists.safetyLabels : lists.labels;
  const fallback = domain === "safety" ? SAFETY_LABELS : QUALITY_LABELS;
  const list = configured?.length ? configured : [...fallback];
  return [...list, ...current.filter((l) => l && !list.includes(l))];
}
