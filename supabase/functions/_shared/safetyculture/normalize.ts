/**
 * Pure translation between a SafetyCulture Action and a PM System quality record.
 *
 * Nothing in here touches the network or the database, so the rules that decide
 * which line an action belongs to, and what kind of error it describes, can be
 * held by a test instead of only by production.
 */

import {
  classifyAction,
  londonDay,
  type ActionClass,
  type Attendance,
  type CheckState,
  type ClassificationRuleV2,
} from "./classification.ts";

export { londonDay };

export interface ScAction {
  /** The stable external identifier. Never invented — it is the idempotency key. */
  id: string;
  /** The number a person reads off the SafetyCulture screen ("A-1042"). */
  unique_id?: string | null;
  title: string;
  description?: string | null;
  status?: string | null;
  /** The readable name, when SafetyCulture sends one. Usually it does not. */
  priority?: string | null;
  /** What SafetyCulture actually sends: a UUID with no name attached. */
  priority_id?: string | null;
  created_at?: string | null;
  modified_at?: string | null;
  due_at?: string | null;
  assignee?: string | null;
  /** Everyone assigned, not just the first name. */
  assignees?: string[];
  labels?: string[];
  site?: string | null;
  asset?: string | null;
  template?: string | null;
  custom_fields?: Record<string, string>;
  deleted?: boolean;
  url?: string | null;
}

export interface ClassificationRule {
  /** Present on every stored rule; optional only so a hand-built test rule can omit it. */
  id?: string;
  name?: string | null;
  /** What a match asserts about the action itself. See `classification.ts`. */
  classification?: ActionClass | null;
  match_field:
    | "label"
    | "template"
    | "site"
    | "asset"
    | "custom_field"
    | "title"
    | "description"
    | "priority";
  match_key?: string | null;
  match_value: string;
  match_mode: "equals" | "contains" | "regex";
  category?: string | null;
  error_type?: string | null;
  department?: string | null;
  label?: string | null;
  severity?: string | null;
  /** When set, a match also attributes the action to this production line. */
  line_name?: string | null;
  priority: number;
  active?: boolean;
}

export interface Classification {
  category: string | null;
  error_type: string | null;
  department: string | null;
  label: string | null;
  severity: string | null;
  matched: boolean;
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Every haystack a single rule field can look at (a label rule sees each label). */
function haystacks(action: ScAction, rule: ClassificationRule): string[] {
  switch (rule.match_field) {
    case "label":
      return action.labels ?? [];
    case "template":
      return [action.template ?? ""];
    case "site":
      return [action.site ?? ""];
    case "asset":
      return [action.asset ?? ""];
    case "custom_field":
      return rule.match_key ? [action.custom_fields?.[rule.match_key] ?? ""] : [];
    case "title":
      return [action.title ?? ""];
    case "description":
      return [action.description ?? ""];
    case "priority":
      return [action.priority ?? ""];
    default:
      return [];
  }
}

function hit(value: string, rule: ClassificationRule): boolean {
  const v = norm(value);
  const m = norm(rule.match_value);
  if (!v || !m) return false;
  if (rule.match_mode === "equals") return v === m;
  if (rule.match_mode === "contains") return v.includes(m);
  try {
    return new RegExp(rule.match_value, "i").test(value);
  } catch {
    return false; // a broken pattern must never widen a match
  }
}

/**
 * Structured fields first, the title last — that ordering lives in the rules table
 * (`priority`), so it can be changed without touching this file.
 *
 * Fields already decided by a higher-priority rule are never overwritten, and a
 * rule that matches nothing leaves everything null. Nothing is guessed: when no
 * rule matches at all, `matched` is false and the caller flags the record for
 * manual classification.
 */
export function classify(action: ScAction, rules: ClassificationRule[]): Classification {
  const out: Classification = {
    category: null,
    error_type: null,
    department: null,
    label: null,
    severity: null,
    matched: false,
  };
  const ordered = rules
    .filter((r) => r.active !== false)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const rule of ordered) {
    if (!haystacks(action, rule).some((h) => hit(h, rule))) continue;
    // A rule that only names a line has not classified the error.
    if (rule.category || rule.error_type) out.matched = true;
    out.category ??= rule.category ?? null;
    out.error_type ??= rule.error_type ?? null;
    out.department ??= rule.department ?? null;
    out.label ??= rule.label ?? null;
    out.severity ??= rule.severity ?? null;
  }
  return out;
}

/**
 * Which production line an action is about.
 *
 * The line names come from the `lines` table — never a hard-coded list. A name is
 * only accepted on a token boundary so "C1" does not also match "C10" or the "c1"
 * inside a word. Structured fields (site, asset, custom field) are read before the
 * title, which is the least reliable source.
 */
export function resolveLine(
  action: ScAction,
  lineNames: string[],
  rules: ClassificationRule[] = [],
): string | null {
  // The floor writes "L4" or "Caps 1", not "Line 4". Those shorthands live in the
  // rules table so a new one can be added without a deploy, and they are read
  // before the full line names.
  const aliasRules = rules
    .filter((r) => r.active !== false && r.line_name)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const rule of aliasRules) {
    if (haystacks(action, rule).some((h) => hit(h, rule))) {
      const name = lineNames.find((n) => norm(n) === norm(rule.line_name));
      if (name) return name;
    }
  }

  const candidates = [
    action.asset,
    action.custom_fields?.line,
    action.custom_fields?.Line,
    // The inspection name is where the floor actually writes the line ("B1/L6A").
    action.custom_fields?.inspection,
    action.title,
    action.description,
    // The site is "Production" for the whole factory, so it is the last resort.
    action.site,
  ].filter(Boolean) as string[];

  // Longest name first: "Line 10" must win over "Line 1".
  const byLength = [...lineNames].filter(Boolean).sort((a, b) => b.length - a.length);

  for (const text of candidates) {
    for (const name of byLength) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Allow "C1" to match "C1", "- C1", "C1:" but not "C12" / "AC1".
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
      if (re.test(text)) return name;
    }
  }
  return null;
}

/** SafetyCulture status → the PM record's own lifecycle. */
export function mapStatus(scStatus: string | null | undefined): {
  status: "todo" | "in_progress" | "complete";
  closed: boolean;
} {
  const s = norm(scStatus);
  if (["complete", "completed", "closed", "done", "resolved"].includes(s)) {
    return { status: "complete", closed: true };
  }
  if (["in progress", "in_progress", "inprogress", "started"].includes(s)) {
    return { status: "in_progress", closed: false };
  }
  return { status: "todo", closed: false };
}

export function actionUrl(action: ScAction): string {
  return action.url ?? `https://app.safetyculture.com/tasks/actions/${action.id}`;
}

export interface RecordDraft {
  source: "safetyculture";
  external_id: string;
  external_url: string;
  external_status: string | null;
  /** The readable name — null until the UUID has been mapped. Never the UUID. */
  external_priority: string | null;
  external_priority_id: string | null;
  /** The SafetyCulture action number, shown as "#". */
  action_no: string | null;
  external_updated_at: string | null;
  external_created_at: string | null;
  external_deleted_at: string | null;
  external_site: string | null;
  external_asset: string | null;
  external_template: string | null;
  external_assignees: string[];
  title: string;
  description: string | null;
  assignee_name: string | null;
  due_date: string | null;
  recorded_at: string;
  status: "todo" | "in_progress" | "complete";
  line: string | null;
  leader_id: string | null;
  leader_name: string | null;
  category: string | null;
  error_type: string | null;
  department: string | null;
  labels: string[];
  severity: string | null;
  domain: "quality";
  needs_classification: boolean;
  classification_status: "classified" | "needs_review";
  /** The verdict, and what was actually checked to reach it. */
  classification: ActionClass;
  classification_checks: Record<"site" | "action_date" | "worker" | "line", CheckState>;
  classification_reasons: string[];
  matched_rule_ids: string[];
  matched_rule_names: string[];
  classified_at: string;
  last_synced_at: string;
}

/**
 * The row a single Action becomes. Anything that could not be worked out stays
 * null and raises `needs_classification` — an imported record never carries a
 * value nobody supplied.
 */
export function buildRecord(
  action: ScAction,
  opts: {
    lineNames: string[];
    rules: ClassificationRule[];
    /**
     * `onDate` is not optional in spirit. Who leads a line changes, and asking who
     * leads it TODAY when classifying a finding from three weeks ago charges the
     * finding to whoever happens to hold the line now.
     */
    leaderFor: (line: string, onDate?: string | null) => { id: string; name: string } | null;
    /** Defaults to "nothing recorded", which reports rather than blocks. */
    attendance?: (worker: string, day: string) => Attendance;
    countsAgainstLeader?: (label: string) => boolean;
    requireWorkerEvidence?: boolean;
    /**
     * What a priority UUID means. Read from `sc_priorities`, because the API sends
     * no name and there is no endpoint that lists them.
     */
    priorityOf?: (id: string) => { name: string; severity: string | null } | null;
    now?: string;
  },
): { draft: RecordDraft; problems: string[] } {
  const now = opts.now ?? new Date().toISOString();
  const problems: string[] = [];

  const line = resolveLine(action, opts.lineNames, opts.rules);
  if (!line) problems.push("line_not_identified");

  // The day the finding was raised — the same day the leader lookup and the
  // attendance lookup are asked about, so all three answers describe one moment.
  const actionDay = londonDay(action.created_at ?? null);
  const leader = line ? opts.leaderFor(line, actionDay) : null;
  if (line && !leader) problems.push("leader_not_found");

  const cls = classify(action, opts.rules);
  if (!cls.matched) problems.push("error_type_not_identified");

  if (!action.assignee) problems.push("no_assignee");

  const { status } = mapStatus(action.status);

  const prio = action.priority_id ? (opts.priorityOf?.(action.priority_id) ?? null) : null;
  if (action.priority_id && !prio) problems.push("priority_not_mapped");

  /**
   * Every label the action carried, plus whatever a rule added.
   *
   * The rule's label used to REPLACE these, which is why forty-seven of forty-nine
   * records arrived with no labels at all and one arrived labelled "Label" — the
   * name of the rule that matched it. `action_points_at` charges by label, so an
   * action with no labels and no severity scores 1 whatever it describes.
   */
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const l of [...(action.labels ?? []), cls.label].filter(Boolean) as string[]) {
    const key = l.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(l.trim());
  }

  const verdict = classifyAction(
    {
      site: action.site ?? null,
      actionDate: action.created_at ?? null,
      dueDate: action.due_at ?? null,
      line,
      leader,
      errorType: cls.error_type,
      department: cls.department,
      labels: action.labels ?? [],
      workers: action.assignees ?? (action.assignee ? [action.assignee] : []),
      title: action.title ?? null,
      description: action.description ?? null,
      priority: action.priority ?? null,
      asset: action.asset ?? null,
      template: action.template ?? null,
      customFields: action.custom_fields,
    },
    (opts.rules ?? [])
      .filter((r): r is ClassificationRule & { id: string } => Boolean(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name ?? null,
        match_field: r.match_field as ClassificationRuleV2["match_field"],
        match_key: r.match_key ?? null,
        match_value: r.match_value,
        match_mode: r.match_mode,
        classification: r.classification ?? null,
        priority: r.priority,
        active: r.active,
      })),
    {
      attendance: opts.attendance ?? (() => "unknown"),
      countsAgainstLeader: opts.countsAgainstLeader,
      requireWorkerEvidence: opts.requireWorkerEvidence,
    },
  );

  return {
    problems,
    draft: {
      source: "safetyculture",
      external_id: action.id,
      external_url: actionUrl(action),
      external_status: action.status ?? null,
      // The name if one is known, never the id: a UUID on screen is not a priority,
      // it is a gap for somebody to close on the settings screen.
      external_priority: action.priority ?? prio?.name ?? null,
      external_priority_id: action.priority_id ?? null,
      action_no: action.unique_id ?? null,
      external_updated_at: action.modified_at ?? null,
      // The two timestamps are kept apart: when it was raised, and when it last
      // changed. `recorded_at` follows the creation date so the Quality screen
      // reads the real date of the finding.
      external_created_at: action.created_at ?? null,
      external_deleted_at: action.deleted ? now : null,
      external_site: action.site ?? null,
      external_asset: action.asset ?? null,
      external_template: action.template ?? null,
      external_assignees: action.assignees ?? (action.assignee ? [action.assignee] : []),
      title: action.title ?? "",
      description: action.description ?? null,
      assignee_name: action.assignee ?? null,
      due_date: action.due_at ?? null,
      recorded_at: action.created_at ?? now,
      status,
      line,
      leader_id: leader?.id ?? null,
      leader_name: leader?.name ?? null,
      category: cls.category,
      error_type: cls.error_type,
      department: cls.department,
      labels,
      // A rule graded this kind of finding on purpose; the priority is a default that
      // came off the template. The deliberate one wins.
      severity: cls.severity ?? prio?.severity ?? null,
      domain: "quality",
      // "line_not_identified" alone is enough: a record nobody can attribute must
      // be corrected by a human rather than counted against a guessed leader.
      needs_classification: problems.length > 0,
      classification_status: problems.length > 0 ? "needs_review" : "classified",
      classification: verdict.classification,
      classification_checks: verdict.checks,
      classification_reasons: verdict.reasons,
      matched_rule_ids: verdict.matched_rule_ids,
      matched_rule_names: verdict.matched_rule_names,
      classified_at: now,
      last_synced_at: now,
    },
  };
}
