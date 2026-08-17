import { describe, expect, it } from "vitest";
import { emptyDraft, isBlank, pickWritable } from "@/lib/scorecardEntry";

describe("isBlank", () => {
  it("separates nothing recorded from a recorded zero", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(true);
    // Zero near-misses e um numero que alguem escreveu. Nao e uma lacuna.
    expect(isBlank(0)).toBe(false);
  });
});

describe("emptyDraft", () => {
  it("starts every measured field unrecorded, not at zero", () => {
    const d = emptyDraft("l1", "n1", "2026-07-05");
    expect(d.near_misses_reported).toBeNull();
    expect(d.planned_volume).toBeNull();
    expect(d.ccp_check_status).toBeNull();
    expect(d.leader_id).toBe("l1");
    expect(d.week_ending).toBe("2026-07-05");
  });
});

/**
 * A FULL row of `v_leader_weekly_scorecard`, written out column by column rather
 * than trimmed to "a few extras", because the defect this guards was invisible
 * precisely while the fixtures were small: the hook merged the whole view row
 * into the draft and then upserted it into the base table, so every save after
 * the first carried columns the table does not have (PGRST204) and two it has
 * but generates (`month_start`, `quarter_start` — 428C9). The week could be
 * written exactly once, ever.
 */
function fullViewRow() {
  return {
    // The row's own identity and every writable column.
    id: "row-1",
    leader_id: "leader-1",
    line_id: "line-1",
    week_ending: "2026-07-05",
    planned_volume: 1000,
    actual_volume: 950,
    unplanned_downtime_minutes: 30,
    downtime_reason: "Quebra",
    volume_source: "derivado",
    ccp_check_status: "Pass",
    starter_check_status: "Fail",
    volume_weight_check_status: "Not Done",
    lost_time_injuries: 0,
    reportable_accidents: 0,
    first_aid_cases: 1,
    near_misses_reported: 3,
    safety_observations_done: 4,
    toolbox_talks_done: 2,
    ppe_compliance_pct: 0.95,
    hs_training_compliance_pct: 0.9,
    overdue_hs_actions: 0,
    leader_attendance_pct: 1,
    team_attendance_pct: 0.92,
    leader_lateness_incidents: 0,
    team_lateness_incidents: 2,
    root_cause: "Coder reset",
    corrective_action: "Retrained",
    capa_owner: "Ana",
    capa_due_date: "2026-07-31",
    capa_status: "Aberta",
    submitted_by: "user-1",
    submitted_at: "2026-07-06T08:00:00Z",
    approved_by: "user-2",
    approved_at: "2026-07-07T08:00:00Z",
    created_at: "2026-07-05T08:00:00Z",
    updated_at: "2026-07-07T08:00:00Z",

    // GENERATED ALWAYS ... STORED. Sending either one is 428C9.
    month_start: "2026-07-01",
    quarter_start: "2026-07-01",

    // Everything the view adds and the base table has never had.
    leader_name: "M. Silva",
    line_name: "Line 3",
    month: "jul-2026",
    quarter: "Q3-2026",
    volume_pct: 95,
    volume_pct_adjusted: 97,
    volume_rag: "Amber",
    quality_rag: "Red",
    quality_fail_type: "Fail",
    capa_required: true,
    hs_rag: "Green",
    hs_driver: ["Nenhum acidente"],
    missing_hs_data: false,
    leader_attendance_below_target: false,
    overall_rag: "Red",
    rag_driver: "Qualidade: Starter reprovado; CAPA obrigatoria.",
    pending_approval: false,
  };
}

describe("pickWritable", () => {
  it("keeps exactly the draft's own columns, whatever else the view row carries", () => {
    const picked = pickWritable(fullViewRow());
    expect(Object.keys(picked).sort()).toEqual(
      Object.keys(emptyDraft("leader-1", "line-1", "2026-07-05")).sort(),
    );
  });

  it("drops the generated columns, which no write may ever carry", () => {
    const picked = pickWritable(fullViewRow()) as Record<string, unknown>;
    expect("month_start" in picked).toBe(false);
    expect("quarter_start" in picked).toBe(false);
  });

  it("drops every computed column of the view, name by name", () => {
    const picked = pickWritable(fullViewRow()) as Record<string, unknown>;
    for (const computed of [
      "leader_name", "line_name", "month", "quarter",
      "volume_pct", "volume_pct_adjusted", "volume_rag",
      "quality_rag", "quality_fail_type", "capa_required",
      "hs_rag", "hs_driver", "missing_hs_data",
      "leader_attendance_below_target", "overall_rag", "rag_driver",
      "pending_approval", "id", "created_at", "updated_at",
    ]) {
      expect(`${computed} must not reach the write: ${computed in picked}`)
        .toBe(`${computed} must not reach the write: false`);
    }
  });

  it("carries the values it keeps through unchanged, including the audit stamps", () => {
    const picked = pickWritable(fullViewRow());
    expect(picked.planned_volume).toBe(1000);
    expect(picked.downtime_reason).toBe("Quebra");
    expect(picked.capa_status).toBe("Aberta");
    expect(picked.approved_by).toBe("user-2");
    expect(picked.approved_at).toBe("2026-07-07T08:00:00Z");
  });

  it("a column the view gains tomorrow cannot regress this — unknown keys are simply not carried", () => {
    const picked = pickWritable({ ...fullViewRow(), some_column_invented_later: 42 }) as Record<string, unknown>;
    expect("some_column_invented_later" in picked).toBe(false);
  });

  it("reads a missing row as nothing to merge, never as a blank draft", () => {
    expect(pickWritable(null)).toEqual({});
    expect(pickWritable(undefined)).toEqual({});
  });
});
