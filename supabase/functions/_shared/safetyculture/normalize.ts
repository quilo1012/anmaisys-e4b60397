/**
 * Pure translation between a SafetyCulture Action and a PM System quality record.
 *
 * Nothing in here touches the network or the database, so the rules that decide
 * which line an action belongs to, and what kind of error it describes, can be
 * held by a test instead of only by production.
 */

export interface ScAction {
  /** The stable external identifier. Never invented — it is the idempotency key. */
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  created_at?: string | null;
  modified_at?: string | null;
  due_at?: string | null;
  assignee?: string | null;
  labels?: string[];
  site?: string | null;
  asset?: string | null;
  template?: string | null;
  custom_fields?: Record<string, string>;
  deleted?: boolean;
  url?: string | null;
}

export interface ClassificationRule {
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
    out.matched = true;
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
export function resolveLine(action: ScAction, lineNames: string[]): string | null {
  const candidates = [
    action.site,
    action.asset,
    action.custom_fields?.line,
    action.custom_fields?.Line,
    action.title,
    action.description,
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
  external_priority: string | null;
  external_updated_at: string | null;
  external_deleted_at: string | null;
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
    leaderFor: (line: string) => { id: string; name: string } | null;
    now?: string;
  },
): { draft: RecordDraft; problems: string[] } {
  const now = opts.now ?? new Date().toISOString();
  const problems: string[] = [];

  const line = resolveLine(action, opts.lineNames);
  if (!line) problems.push("line_not_identified");

  const leader = line ? opts.leaderFor(line) : null;
  if (line && !leader) problems.push("leader_not_found");

  const cls = classify(action, opts.rules);
  if (!cls.matched) problems.push("error_type_not_identified");

  if (!action.assignee) problems.push("no_assignee");

  const { status } = mapStatus(action.status);

  return {
    problems,
    draft: {
      source: "safetyculture",
      external_id: action.id,
      external_url: actionUrl(action),
      external_status: action.status ?? null,
      external_priority: action.priority ?? null,
      external_updated_at: action.modified_at ?? null,
      external_deleted_at: action.deleted ? now : null,
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
      labels: cls.label ? [cls.label] : [],
      severity: cls.severity,
      domain: "quality",
      // "line_not_identified" alone is enough: a record nobody can attribute must
      // be corrected by a human rather than counted against a guessed leader.
      needs_classification: problems.length > 0,
      last_synced_at: now,
    },
  };
}
