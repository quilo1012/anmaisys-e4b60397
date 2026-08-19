import { logFormCharge } from "@/lib/qualityConstants";

/**
 * What the log form saves to `quality_actions`, pulled out of the mutation so the
 * shape of the write is something a test can hold without mounting the page.
 *
 * `leader_id` and `leader_name` are BOTH written, on purpose. `scorecard_safety_counts`
 * (see supabase/migrations/20260817093000_the_week_counts_its_own_safety.sql) counts
 * `WHERE leader_id = _leader_id` — counting by name is the fragility this repo already
 * suffers from elsewhere (leader_pins spells five people in capitals while production
 * tables use title case), and a safety row saved without `leader_id` counts nowhere,
 * forever. `leader_name` stays too: it is what every screen on this module reads and
 * filters by today, and dropping it would be a second, unrelated regression.
 *
 * `original_leader_id` is the id already stored on the row being edited (`null` for a
 * brand-new insert). `openEdit` resolves `leader_id` by matching `leader_name` against
 * ACTIVE leaders only, so a deactivated leader — or any stored name that no longer
 * matches a `line_leaders` row exactly — leaves `form.leader_id` empty even though the
 * row already has a leader on it. Falling back to `null` in that case would silently
 * unlink an already-counted row every time someone edits an unrelated field. Falling
 * back to `original_leader_id` instead means an edit never changes who the row belongs
 * to unless the form's own `leader_id` says otherwise (the user picked someone in the
 * dropdown, which always wins).
 */
export interface QualityActionFormInput {
  action_no: string;
  line: string;
  shift: string;
  leader_id: string;
  leader_name: string;
  date: string;
  sku: string;
  batch: string;
  department: string;
  severity: string;
  labels: string[];
  description: string;
  domain: "quality" | "safety";
  safety_kind: string;
  original_leader_id: string | null;
}

/**
 * @param matchedLeaderName  the name from `line_leaders` for `form.leader_id`, when
 *   found — falls back to `form.leader_name` (the auto-filled or free-typed name)
 *   otherwise, the same fallback the form already used.
 * @param recordedAt  the ISO timestamp built from `form.date` — kept a parameter
 *   rather than derived in here, so a test does not depend on "now".
 *
 * Deliberately does NOT set `points`: `quality_actions.points` is a dead column
 * nothing reads (score is derived by `actionPoints()`), and writing 1 into it on
 * every insert only invited someone to think it did something.
 */
/**
 * The grade a quality action is saved with — derived from its labels, never typed.
 *
 * The log form stopped asking for a severity: `actionPoints()` charges the priced
 * labels and only falls back to the grade, so the field mostly named a number the
 * system did not use. Writing `form.severity` through unchanged would keep that
 * fallback alive with a value nobody can see any more — untick the last priced label
 * and the action would go on charging the grade it briefly held.
 *
 * Derived from what is CHARGED, exclusions applied — see the `excluded` parameter.
 *
 * This has been both ways round. It shipped applying no exclusions, on the argument
 * that an exclusion decides whose score an action lands on and the grade should
 * describe the deviation itself. That put two numbers on the same row saying
 * different things: "Batch code · Maintenance" with Maintenance excluded read 2
 * points and Critical, and a leader reading their own scorecard could not tell which
 * of the two they were being judged on. A grade describing a charge nobody is paying
 * is a contradiction printed in bold, not extra information.
 *
 * The accepted cost: an action whose only priced label is excluded now saves with no
 * grade. Metal on a magnet, wholly maintenance's, keeps its 0 and loses its Critical
 * badge. That severity is not lost to the business — `issueWeight()` prices recurring
 * problems off the labels and ignores attribution, which is the table the question
 * "how bad is this problem" belongs on.
 *
 * Safety passes through whatever it is handed. A safety occurrence always scores 0,
 * so its grade is a description rather than a price — and the safety form stopped
 * asking for one at all, classifying by `safety_kind` instead, which is what the
 * weekly H&S scorecard counts. Rows saved while the picker existed keep their grade.
 */
function qualitySeverity(form: QualityActionFormInput, excluded: Set<string>): string | null {
  if (form.domain !== "quality") return form.severity || null;
  return logFormCharge(form.labels, excluded).severity || null;
}

/**
 * @param excluded  the labels that are not this leader's, from `useLabelAttribution`.
 *   Defaults to empty, which means "nothing is excluded" — the correct reading for a
 *   caller that has no attribution to apply, and what every test that does not care
 *   about attribution relies on. A caller that DOES have it must not pass an empty
 *   set while the table is still loading: the grade would be written from the
 *   unfiltered charge and, unlike a number on screen, it does not settle a moment
 *   later. The log form blocks Save until attribution has loaded, for that reason.
 */
export function buildQualityActionPayload(
  form: QualityActionFormInput,
  matchedLeaderName: string | null,
  recordedAt: string,
  excluded: Set<string> = new Set(),
) {
  return {
    action_no: form.action_no || null,
    line: form.line || null,
    shift: form.shift || null,
    leader_id: form.leader_id || form.original_leader_id || null,
    leader_name: matchedLeaderName ?? (form.leader_name || null),
    sku: form.sku || null,
    batch: form.batch || null,
    department: form.department || null,
    // No `status`. An action is written down because it already happened, so there is
    // no To do / In progress / Complete for it to be in — the lifecycle that decides
    // anything is `validation_status`, which Quality rules on and which is the only
    // one that moves a score.
    //
    // Omitted rather than sent as 'todo': the column is NOT NULL DEFAULT 'todo' with a
    // CHECK (20260722120000), so an insert takes the default and an UPDATE leaves
    // whatever the row already carried. PostgREST writes every key it is given, so a
    // literal here would reset any row moved to Complete while the board existed, on
    // the next unrelated edit.
    severity: qualitySeverity(form, excluded),
    labels: form.labels,
    description: form.description || null,
    recorded_at: recordedAt,
    domain: form.domain,
    // null for quality, the picked kind for safety — the CHECK constraint on the
    // table refuses any other combination.
    safety_kind: form.domain === "safety" ? (form.safety_kind || null) : null,
  };
}
