/**
 * What a SafetyCulture action is, once the evidence has been checked.
 *
 * `normalize.ts` answers "what does this action say" — which line it names, what kind
 * of error it describes. This file answers the harder question: "how much of that do
 * we actually know", and it refuses to round an unknown up to a fact.
 *
 * The gates run in a fixed order — site, then date, then worker, then line, then the
 * configurable rules — because each one is only meaningful if the one before it held.
 * A rule cannot put a record raised outside Production back on the operational screen,
 * and no amount of matching text can establish that a person was on the floor.
 *
 * THE THREE-STATE WORKER CHECK IS THE POINT OF THIS FILE.
 *
 * `employee_attendance` is sparse: at the time of writing it stops on 2026-09-03 and
 * covers about fifty of two hundred and thirty-one people on the days it does have. So
 * "no row" and "a row saying absent" are different statements. Collapsing them into a
 * boolean gives a choice between two wrong screens — one that attributes findings to
 * people who may not have been there, and one where every action of the last three days
 * sits in review. `unknown` is therefore a first-class answer: it is reported on the
 * record and shown in the detail drawer, and it does not block. Only a contradiction
 * blocks. A site that wants the strict reading can ask for it with
 * `requireWorkerEvidence`, which is what the setting in Data Source will drive once the
 * attendance table is filled in daily.
 */

export type ActionClass = "line" | "leader" | "quality_error" | "needs_review" | "excluded";

/** `unknown` is not a soft `failed`: it means nothing was recorded either way. */
export type CheckState = "ok" | "failed" | "unknown";

export type Attendance = "present" | "absent" | "unknown";

export type MatchField =
  | "label"
  | "template"
  | "site"
  | "asset"
  | "title"
  | "description"
  | "priority"
  | "line"
  | "custom_field";

export interface ClassificationRuleV2 {
  id: string;
  name?: string | null;
  match_field: MatchField;
  match_key?: string | null;
  match_value: string;
  match_mode: "equals" | "contains" | "regex";
  /** What a match asserts. A rule that names no class only tags; it does not decide. */
  classification?: ActionClass | null;
  priority: number;
  active?: boolean;
}

export interface ClassificationInput {
  site: string | null;
  /** When the finding was RAISED. Never the due date — see `dueDate`. */
  actionDate: string | null;
  /** Carried only so an impossible pair (due before raised) can be spotted. */
  dueDate: string | null;
  line: string | null;
  leader: { id: string; name: string } | null;
  /**
   * Where the leader came from, so an unresolved one can say which kind of gap it is.
   * "session_unsigned" — the shift was opened and left unnamed — is not the same
   * problem as nobody being assigned to the line at all.
   */
  leaderSource?: "session" | "session_unsigned" | "assignment" | "none";
  errorType: string | null;
  department: string | null;
  labels: string[];
  /** Everyone assigned, not just the first name. */
  workers: string[];
  title: string | null;
  description: string | null;
  priority: string | null;
  asset: string | null;
  template: string | null;
  /** SafetyCulture's own custom fields, keyed as the rules address them. */
  customFields?: Record<string, string>;
}

export interface ClassifyOptions {
  /** Was this person on the floor that day? Three answers, never two. */
  attendance: (worker: string, day: string) => Attendance;
  /**
   * Whether a label is one the shift leader answers for. Reads
   * `quality_label_attribution`, which already records that a machine failure is not
   * the leader's doing — the judgement lives in that table, not repeated here.
   */
  countsAgainstLeader?: (label: string) => boolean;
  /** Treat "no attendance recorded" as a blocker. Off until the table is filled daily. */
  requireWorkerEvidence?: boolean;
}

export interface ClassificationOutcome {
  classification: ActionClass;
  /** The day the action was raised, in Europe/London. Null when it could not be read. */
  actionDay: string | null;
  checks: {
    site: CheckState;
    action_date: CheckState;
    worker: CheckState;
    line: CheckState;
  };
  /** Machine-readable, so the screen can explain itself without parsing prose. */
  reasons: string[];
  matched_rule_ids: string[];
  matched_rule_names: string[];
  conflict: { rules: string[]; classes: ActionClass[] } | null;
}

const PRODUCTION = "production";

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * The calendar day in Europe/London, which is where the factory is.
 *
 * Not `toISOString().slice(0,10)`: for five months of the year the UK is an hour ahead
 * of UTC, so an action raised at 00:30 on the 7th reads as the 6th in UTC and lands on
 * the wrong shift — and the "Today" filter then shows yesterday's work.
 */
export function londonDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formats as YYYY-MM-DD, which is also the shape `date` columns compare in.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Which half of the factory day an instant falls in: DAY 06:00–17:59, NIGHT
 * 18:00–05:59, Europe/London.
 *
 * A SafetyCulture Action carries no shift, and for months this import wrote none —
 * so 123 live actions sat in the log with `shift` NULL while every screen that
 * narrows to a shift filters `.eq("shift", …)` on the server. Production
 * Performance opens pinned to whichever shift is running, which meant it dropped
 * every action ever synced and printed 0 quality points on every line, every day.
 *
 * The rule is the one src/lib/shifts.ts applies on the screen and the one
 * workOrdersInPeriod() already applies to a work order, which also has no shift
 * column: where nobody wrote a shift down, the factory clock says which it was.
 *
 * Only for instants that are real. The `pm` source stamps a synthetic 12:00 because
 * its form asks for a date and not a time, and reading DAY off that would be an
 * invention — those rows stay blank, and the database trigger draws the same line.
 */
export function londonShift(iso: string | null | undefined): "DAY" | "NIGHT" | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hour12: false,
    }).format(d).replace(/\D/g, ""),
  );
  return hour >= 6 && hour < 18 ? "DAY" : "NIGHT";
}

function haystacks(input: ClassificationInput, rule: ClassificationRuleV2): string[] {
  switch (rule.match_field) {
    case "label":
      return input.labels ?? [];
    case "template":
      return [input.template ?? ""];
    case "site":
      return [input.site ?? ""];
    case "asset":
      return [input.asset ?? ""];
    case "title":
      return [input.title ?? ""];
    case "description":
      return [input.description ?? ""];
    case "priority":
      return [input.priority ?? ""];
    case "line":
      return [input.line ?? ""];
    case "custom_field":
      return rule.match_key ? [input.customFields?.[rule.match_key] ?? ""] : [];
    default:
      return [];
  }
}

function hit(value: string, rule: ClassificationRuleV2): boolean {
  const v = norm(value);
  const m = norm(rule.match_value);
  if (!v || !m) return false;
  if (rule.match_mode === "equals") return v === m;
  if (rule.match_mode === "contains") return v.includes(m);
  try {
    return new RegExp(rule.match_value, "i").test(value);
  } catch {
    // A pattern nobody can compile must never widen a match. It is reported by the
    // rules screen rather than silently matching everything.
    return false;
  }
}

/**
 * Which of the assignees, if any, the attendance table can speak for.
 *
 * One person on the floor is enough. Several of the assignees on a real action are
 * mailboxes — "Quality Control", "Supervisors" — and those will never have an
 * attendance row, so requiring all of them to be present would fail every record.
 */
function checkWorkers(
  workers: string[],
  day: string | null,
  attendance: ClassifyOptions["attendance"],
): { state: CheckState; reason: string | null } {
  if (!day) return { state: "unknown", reason: "worker_attendance_unknown" };
  const named = workers.filter((w) => norm(w));
  if (!named.length) return { state: "unknown", reason: "worker_not_named" };

  const states = named.map((w) => attendance(w, day));
  if (states.includes("present")) return { state: "ok", reason: null };
  if (states.every((s) => s === "absent")) {
    return { state: "failed", reason: "worker_absent_on_action_date" };
  }
  return { state: "unknown", reason: "worker_attendance_unknown" };
}

/**
 * One action, one verdict — or an honest refusal to give one.
 *
 * Nothing here invents a line, a worker or a date. Every path that cannot be evidenced
 * ends in `needs_review` with the reasons that put it there, so the drawer can show a
 * person exactly which check did not hold.
 */
export function classifyAction(
  input: ClassificationInput,
  rules: ClassificationRuleV2[],
  opts: ClassifyOptions,
): ClassificationOutcome {
  const countsAgainstLeader = opts.countsAgainstLeader ?? (() => true);
  const reasons: string[] = [];
  const checks: ClassificationOutcome["checks"] = {
    site: "unknown",
    action_date: "unknown",
    worker: "unknown",
    line: "unknown",
  };

  // ── 1. Site ────────────────────────────────────────────────────────────────────
  // The operational view is Production. Everything else belongs to another board.
  const site = norm(input.site);
  if (!site) {
    // Missing is not the same as elsewhere: excluding a record on the strength of an
    // absent field hides it from everyone, so a human is asked instead.
    reasons.push("site_missing");
  } else if (site !== PRODUCTION) {
    checks.site = "failed";
    reasons.push("site_not_production");
    return {
      classification: "excluded",
      actionDay: londonDay(input.actionDate),
      checks,
      reasons,
      matched_rule_ids: [],
      matched_rule_names: [],
      conflict: null,
    };
  } else {
    checks.site = "ok";
  }

  // ── 2. Action date ─────────────────────────────────────────────────────────────
  const actionDay = londonDay(input.actionDate);
  if (!actionDay) {
    reasons.push("action_date_missing");
  } else {
    checks.action_date = "ok";
    const dueDay = londonDay(input.dueDate);
    if (dueDay && dueDay < actionDay) {
      // Something upstream has put the two dates the wrong way round, and the usual
      // cause is a due date that was read as the date of the finding.
      checks.action_date = "failed";
      reasons.push("due_before_action_date");
    }
  }

  // ── 3. Worker ──────────────────────────────────────────────────────────────────
  const worker = checkWorkers(input.workers ?? [], actionDay, opts.attendance);
  checks.worker = worker.state;
  if (worker.reason) reasons.push(worker.reason);

  // ── 4. Line ────────────────────────────────────────────────────────────────────
  if (input.line) {
    if (input.leader) {
      checks.line = "ok";
    } else if (input.leaderSource === "session_unsigned") {
      // Somebody opened the line and left the name blank. Reaching for the standing
      // assignment here is how the wrong leader reached fourteen records.
      reasons.push("leader_session_unsigned");
    } else {
      // A line with nobody accountable on that day cannot be charged to anyone.
      reasons.push("leader_not_found_for_line");
    }
  } else if (!input.department) {
    reasons.push("line_not_identified");
  }

  // ── 5. Rules ───────────────────────────────────────────────────────────────────
  const matched = (rules ?? [])
    .filter((r) => r.active !== false)
    .filter((r) => haystacks(input, r).some((h) => hit(h, r)))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  const classes = [
    ...new Set(
      matched
        .map((r) => r.classification)
        .filter((c): c is ActionClass => Boolean(c)),
    ),
  ];

  let conflict: ClassificationOutcome["conflict"] = null;
  if (classes.length > 1) {
    // Two rules that disagree do not get resolved by priority: whichever won would be
    // a guess, and the point of the priority field is ordering, not arbitration.
    conflict = {
      rules: matched.filter((r) => r.classification).map((r) => r.name ?? r.id),
      classes,
    };
    reasons.push("rule_conflict");
  }

  const matched_rule_ids = matched.map((r) => r.id);
  const matched_rule_names = matched.map((r) => r.name ?? r.id);

  // ── The verdict ────────────────────────────────────────────────────────────────
  const blocked =
    checks.site !== "ok" ||
    checks.action_date !== "ok" ||
    checks.worker === "failed" ||
    (opts.requireWorkerEvidence === true && checks.worker !== "ok") ||
    reasons.includes("leader_not_found_for_line") ||
    reasons.includes("leader_session_unsigned") ||
    reasons.includes("line_not_identified") ||
    conflict !== null;

  const outcome = (classification: ActionClass): ClassificationOutcome => ({
    classification,
    actionDay,
    checks,
    reasons,
    matched_rule_ids,
    matched_rule_names,
    conflict,
  });

  if (blocked) return outcome("needs_review");
  if (classes.length === 1) return outcome(classes[0]);

  // No rule named a class, so fall back to what the record itself establishes.
  //
  // A finding on a line with a known leader is the leader's only when the label is one
  // leaders answer for — `quality_label_attribution` already excludes Maintenance and
  // GMP, on the grounds that charging those to whoever was on shift measures luck. And
  // an error nobody has typed yet is not chargeable at all, so it stays with the line.
  if (input.line && input.leader) {
    const chargeable = Boolean(input.errorType) && (input.labels ?? []).some(countsAgainstLeader);
    return outcome(chargeable ? "leader" : "line");
  }
  if (input.department || input.errorType) return outcome("quality_error");
  return outcome("needs_review");
}
