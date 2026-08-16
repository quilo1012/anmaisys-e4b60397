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
  status: string;
  severity: string;
  labels: string[];
  description: string;
  domain: "quality" | "safety";
  safety_kind: string;
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
export function buildQualityActionPayload(
  form: QualityActionFormInput,
  matchedLeaderName: string | null,
  recordedAt: string,
) {
  return {
    action_no: form.action_no || null,
    line: form.line || null,
    shift: form.shift || null,
    leader_id: form.leader_id || null,
    leader_name: matchedLeaderName ?? (form.leader_name || null),
    sku: form.sku || null,
    batch: form.batch || null,
    department: form.department || null,
    status: form.status,
    severity: form.severity || null,
    labels: form.labels,
    description: form.description || null,
    recorded_at: recordedAt,
    domain: form.domain,
    // null for quality, the picked kind for safety — the CHECK constraint on the
    // table refuses any other combination.
    safety_kind: form.domain === "safety" ? (form.safety_kind || null) : null,
  };
}
