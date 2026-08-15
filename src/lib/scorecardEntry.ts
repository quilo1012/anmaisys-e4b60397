export type CheckStatus = "Pass" | "Fail" | "Not Done";

/** So os campos que alguem escreve. Nada calculado entra aqui. */
export type ScorecardEntryDraft = {
  leader_id: string;
  line_id: string;
  week_ending: string;
  planned_volume: number | null;
  actual_volume: number | null;
  unplanned_downtime_minutes: number | null;
  downtime_reason: string | null;
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
  capa_status: string | null;
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
  };
}
