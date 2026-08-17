export type CheckStatus = "Pass" | "Fail" | "Not Done";

/**
 * `public.scorecard_downtime_reason`, verbatim. These are the six values the
 * enum accepts — DATA, in the database's Portuguese, never translated on the
 * wire. `downtimeReasonLabel()` (src/lib/capaGate.ts) is what turns them into
 * the English a person reads.
 */
export type DowntimeReason =
  | "Quebra" | "Falta de Materia Prima" | "Troca de Mix"
  | "Falta de Pessoal" | "Outro" | "NA";

/** `public.scorecard_capa_status`, verbatim. Same rule as DowntimeReason. */
export type CapaStatus = "Aberta" | "Em Andamento" | "Concluida" | "Verificada";

/** So os campos que alguem escreve. Nada calculado entra aqui. */
export type ScorecardEntryDraft = {
  leader_id: string;
  line_id: string;
  week_ending: string;
  planned_volume: number | null;
  actual_volume: number | null;
  unplanned_downtime_minutes: number | null;
  downtime_reason: DowntimeReason | null;
  volume_source: "derivado" | "manual" | null;
  ccp_check_status: CheckStatus | null;
  starter_check_status: CheckStatus | null;
  volume_weight_check_status: CheckStatus | null;
  lost_time_injuries: number | null;
  reportable_accidents: number | null;
  first_aid_cases: number | null;
  near_misses_reported: number | null;
  safety_observations_done: number | null;
  toolbox_talks_done: number | null;
  ppe_compliance_pct: number | null;
  hs_training_compliance_pct: number | null;
  overdue_hs_actions: number | null;
  leader_attendance_pct: number | null;
  team_attendance_pct: number | null;
  leader_lateness_incidents: number | null;
  team_lateness_incidents: number | null;
  root_cause: string | null;
  corrective_action: string | null;
  capa_owner: string | null;
  capa_due_date: string | null;
  capa_status: CapaStatus | null;
  /**
   * The audit trail. Written only through `saveNow` — never by `setField`/the
   * debounce — because these are stamped by an action (Submit, Approve), not
   * typed by hand. `submitted_by`/`approved_by` are auth user ids, not names;
   * the drawer only needs to know "was this signed", not "by whom" to render.
   */
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

/** So os campos que a base calcula. O ecra le-os e nunca os produz. */
export type ScorecardEntryVerdict = {
  volume_pct: number | null;
  volume_pct_adjusted: number | null;
  volume_rag: string | null;
  quality_rag: string | null;
  quality_fail_type: string | null;
  capa_required: boolean | null;
  hs_rag: string | null;
  hs_driver: string[] | null;
  overall_rag: string | null;
  rag_driver: string | null;
  /**
   * The CONFIRMED audit trail, straight off `v_leader_weekly_scorecard` — unlike
   * `ScorecardEntryDraft.submitted_at`/`approved_at`, which flip the instant
   * `saveNow` is called and stay flipped even if the write is then rejected,
   * these only change when the query refetches a write that actually landed.
   * Anything that decides "is this week already submitted/approved" (a button
   * label, a disabled state) must read these, never the draft's copies — see
   * the fix note in `ScorecardEntryDrawer.tsx`.
   */
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

/** Vazio nao e zero: um campo por preencher fica nulo e le-se "—". */
export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export function emptyDraft(leader_id: string, line_id: string, week_ending: string): ScorecardEntryDraft {
  return {
    leader_id, line_id, week_ending,
    planned_volume: null, actual_volume: null, unplanned_downtime_minutes: null,
    downtime_reason: null, volume_source: null,
    ccp_check_status: null, starter_check_status: null, volume_weight_check_status: null,
    lost_time_injuries: null, reportable_accidents: null, first_aid_cases: null,
    near_misses_reported: null, safety_observations_done: null, toolbox_talks_done: null,
    ppe_compliance_pct: null, hs_training_compliance_pct: null, overdue_hs_actions: null,
    leader_attendance_pct: null, team_attendance_pct: null,
    leader_lateness_incidents: null, team_lateness_incidents: null,
    root_cause: null, corrective_action: null, capa_owner: null,
    capa_due_date: null, capa_status: null,
    submitted_by: null, submitted_at: null, approved_by: null, approved_at: null,
  };
}

/**
 * The draft's own key set, derived from `emptyDraft` so it can never drift from
 * it: add a field to the draft and it is writable here the same second, forget
 * to add one and it is simply not carried — never half-carried.
 */
const WRITABLE_KEYS = Object.keys(emptyDraft("", "", "")) as (keyof ScorecardEntryDraft)[];

/**
 * The one filter between `v_leader_weekly_scorecard` (what is READ) and
 * `leader_weekly_scorecard` (what is WRITTEN).
 *
 * The view is far wider than the table: it carries the leader's and the line's
 * names, the month and quarter labels, every RAG and driver the rules produced,
 * `pending_approval`, `missing_hs_data` — none of which is a column of the base
 * table — plus `month_start` and `quarter_start`, which ARE columns but are
 * `GENERATED ALWAYS … STORED` and so may never appear in a write.
 *
 * Merging a fetched row into the draft unfiltered and then upserting the draft
 * meant every save after the first carried `leader_name`, `volume_rag`,
 * `month_start`…, and PostgREST rejected it (PGRST204 for the unknown columns,
 * Postgres 428C9 for the generated ones): the row could be written exactly once,
 * ever, and Submit and Approve — which go through the same write — were dead
 * from the second save on. Projecting through this function in BOTH directions
 * (on merge and on upsert) is what makes a view column added tomorrow harmless.
 */
export function pickWritable(row: Record<string, unknown> | null | undefined): Partial<ScorecardEntryDraft> {
  if (!row) return {};
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE_KEYS) {
    if (key in row) out[key] = row[key];
  }
  return out as Partial<ScorecardEntryDraft>;
}
