-- The weekly row learns about the actions, too.
--
-- 20260824090000 marked four labels as gates and made computeLeaderScore cap on them, so
-- a leader opening their own card sees a failed CCP limit the period to 49. The weekly
-- SQL row did not learn: v_leader_weekly_scorecard is fed by leader_weekly_scorecard, a
-- hand-filled table of check statuses and counts, and it has never read quality_actions.
--
-- So the same failed CCP produced two different answers depending on which screen you
-- opened. That is the one thing this module may not do, and it is stated as such at the
-- top of src/lib/leaderScorecard.ts: two fetch paths, one arithmetic.
--
-- WHY THIS IS NOT DOUBLE-COUNTING, since the week already gates on a 'Fail' check. The
-- check sheet answers "was the CCP check done this week, and did it pass". An action
-- answers "an incident occurred". They are two records of two different facts that can
-- and do diverge — an action can be raised in a week whose sheet was never marked Fail.
-- Both gate. Gating twice is arithmetically harmless (LEAST is idempotent, and Red twice
-- is Red) and the alternative is a food safety event that reaches no weekly row at all
-- because nobody ticked a box.
--
-- HOW THIS IS BUILT. The view is re-issued whole, because a view's definition is stored
-- as a parse tree and pg_get_viewdef reconstructs it — the targeted-patch trick used on
-- leader_self_scorecard in 20260822093000 cannot work here. To keep the re-issue honest
-- the body below was GENERATED from the 20260818090000 source by applying four edits,
-- not retyped: every line this migration does not deliberately change is byte-identical
-- to the definition in force. The four changes are marked in place.
--
-- CREATE OR REPLACE VIEW keeps column names, types and order, so the eight dependent
-- views — the periods view, three rollups, two rankings and the trends — are untouched
-- and are not re-issued here.

-- =====================================================================
-- 0. Preconditions
--
-- Both are the same class of failure: the migration would apply cleanly and the gate
-- would never fire, which is worse than not applying at all.
-- =====================================================================

DO $pre$ BEGIN
  IF to_regclass('public.v_leader_weekly_scorecard') IS NULL THEN
    RAISE EXCEPTION '20260818090000 tem de estar aplicada: esta migracao re-emite a view que ela cria.'
      USING ERRCODE = 'invalid_table_definition';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'quality_options'
                    AND column_name = 'is_gate') THEN
    RAISE EXCEPTION
      '20260824090000 tem de estar aplicada primeiro. Sem quality_options.is_gate esta '
      'view nao compila, e se compilasse nao teria nenhuma etiqueta por onde gatear.'
      USING ERRCODE = 'undefined_column';
  END IF;

  /**
   * quality_actions.leader_id tem de apontar para line_leaders, nao para auth.users.
   *
   * Ate 20260825090000 apontava para auth.users, e lideres de linha nao tem conta — o
   * PIN e um segundo factor sobre a sessao de outra pessoa, nao um login. Uma accao com
   * leader_id preenchido guardava portanto um id que NAO existe em line_leaders.
   *
   * O que isso faria a este gate, se corresse antes: a juncao abaixo compara
   * a.leader_id com s.leader_id (line_leaders) e so cai para o nome quando a.leader_id
   * E NULL. Uma accao com o id antigo preenchido nao bate na primeira condicao nem
   * entra na segunda — escapa ao gate inteiro, em silencio, e a semana fecha verde com
   * um CCP reprovado dentro. Falhar aberto num gate e a unica falha que este modulo
   * trata como inaceitavel.
   */
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.quality_actions'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.line_leaders'::regclass
       AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public.quality_actions'::regclass
                                AND attname = 'leader_id')]
  ) THEN
    RAISE EXCEPTION
      '20260825090000_a_line_leader_is_not_an_account tem de estar aplicada primeiro. '
      'Enquanto quality_actions.leader_id apontar para auth.users, uma accao com o id '
      'preenchido escapa ao gate desta view sem erro nenhum.'
      USING ERRCODE = 'invalid_foreign_key';
  END IF;
END $pre$;

-- =====================================================================
-- 1. A view, com o gate das accoes
-- =====================================================================

CREATE OR REPLACE VIEW public.v_leader_weekly_scorecard
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.leader_id,
  ll.name  AS leader_name,
  s.line_id,
  ln.name  AS line_name,
  s.week_ending,
  s.month_start,
  s.quarter_start,
  public.scorecard_month_label(s.month_start)     AS month,
  public.scorecard_quarter_label(s.quarter_start) AS quarter,

  -- Volume
  s.planned_volume,
  s.actual_volume,
  s.unplanned_downtime_minutes,
  s.downtime_reason,
  v.volume_pct,
  v.volume_pct_adjusted,
  v.volume_rag,

  -- Quality
  s.ccp_check_status,
  s.starter_check_status,
  s.volume_weight_check_status,
  q.quality_rag,
  q.quality_fail_type,
  (q.quality_fail_type = 'Fail') AS capa_required,

  -- Health & Safety
  s.lost_time_injuries,
  s.reportable_accidents,
  s.first_aid_cases,
  s.near_misses_reported,
  s.safety_observations_done,
  s.toolbox_talks_done,
  s.ppe_compliance_pct,
  s.hs_training_compliance_pct,
  s.overdue_hs_actions,
  (h.eval).rag     AS hs_rag,
  (h.eval).drivers AS hs_driver,
  ((h.eval).rag IS NULL) AS missing_hs_data,

  -- Monitored — collected, shown, aggregated, and scoring nothing
  s.leader_attendance_pct,
  s.team_attendance_pct,
  s.leader_lateness_incidents,
  s.team_lateness_incidents,
  (s.leader_attendance_pct IS NOT NULL AND s.leader_attendance_pct < t.attend_target)
    AS leader_attendance_below_target,

  -- Rule G
  -- Rule G, plus the action gate. GREATEST is not available for text, so the gate is
  -- an explicit override rather than a max: a gated week is Red, full stop, and the
  -- band the three pillars would have produced is not consulted. That is what a gate
  -- IS — if the pillars could still argue it down, it would be a weight.
  CASE WHEN g.gated THEN 'Red'
       ELSE public.scorecard_overall_rag(v.volume_rag, q.quality_rag, (h.eval).rag)
  END AS overall_rag,

  -- Rule H. Quality, H&S, Volume, missing data — in that order, only the applicable
  -- parts, and every part sourced from a value computed above rather than re-derived.
  NULLIF(concat_ws(' ',
    -- The gate leads. A leader reading a Red week asks what to fix, and a food safety
    -- event outranks every other line here — including on a line-row that did not have
    -- the incident, which is why naming it is not optional. See the `g` lateral.
    CASE WHEN g.gated THEN 'Seguranca alimentar: ' || g.reason END,
    CASE WHEN q.quality_rag = 'Red' THEN
      'Qualidade: ' || concat_ws('; ',
        CASE s.ccp_check_status WHEN 'Fail' THEN 'CCP reprovado'
                                WHEN 'Not Done' THEN 'CCP nao realizado' END,
        CASE s.starter_check_status WHEN 'Fail' THEN 'Starter reprovado'
                                    WHEN 'Not Done' THEN 'Starter nao realizado' END,
        CASE s.volume_weight_check_status WHEN 'Fail' THEN 'Vol&Peso reprovado'
                                          WHEN 'Not Done' THEN 'Vol&Peso nao realizado' END,
        CASE WHEN s.ccp_check_status IS NULL OR s.starter_check_status IS NULL
               OR s.volume_weight_check_status IS NULL THEN 'check nao registado' END)
      || CASE WHEN q.quality_fail_type = 'Fail' THEN '; CAPA obrigatoria.' ELSE '.' END
    END,
    CASE WHEN (h.eval).rag IN ('Red', 'Amber')
      THEN 'H&S: ' || array_to_string((h.eval).drivers, '; ') || '.' END,
    CASE
      WHEN v.volume_rag = 'Red'
        THEN 'Volume ' || public.scorecard_pct_label(v.volume_pct) || '% (abaixo do plano).'
      WHEN v.volume_rag = 'Amber' AND v.volume_pct > t.vol_green_max
        THEN 'Volume ' || public.scorecard_pct_label(v.volume_pct) || '% (superproducao).'
      WHEN v.volume_rag = 'Amber'
        THEN 'Volume ' || public.scorecard_pct_label(v.volume_pct) || '% (levemente abaixo do plano).'
    END,
    CASE WHEN s.line_id IS NULL     THEN 'Linha de producao nao informada.' END,
    CASE WHEN (h.eval).rag IS NULL  THEN 'Dados de H&S ausentes.' END,
    CASE WHEN v.volume_pct IS NULL  THEN 'Volume nao informado.' END
  ), '') AS rag_driver,

  -- CAPA
  s.root_cause, s.corrective_action, s.capa_owner, s.capa_due_date, s.capa_status,
  s.effectiveness_verified_by, s.effectiveness_verified_on,

  -- Audit trail
  s.submitted_by, s.submitted_at, s.approved_by, s.approved_at,
  (s.approved_at IS NULL) AS pending_approval,
  s.created_at, s.updated_at,

  -- Rule M. The score sits BESIDE the RAG and is not derived from it, nor it from the
  -- score. It is here to rank and to trend, and the leader reads rag_driver to find out
  -- what to do. A single number cannot do both jobs: 82 does not name a missed check.
  --
  -- As shipped, nothing reads score_final yet except the rollups' avg_score_final: the
  -- two ranking views still order by pct_weeks_red and the trend views still read the
  -- RAG. Ranking on the score is the intended next step, not the current state, and it
  -- is a decision of its own — ranking by score would rank on a number the ceilings
  -- flatten, so several capped weeks would tie where the RAG still tells them apart.
  sc.prod_score,
  sc.qual_score,
  sc.doc_score,
  sc.score_bruto,
  -- The gate ceiling, applied OUTSIDE scorecard_score_evaluate rather than as a new
  -- argument to it. Adding a parameter to that function would not replace it, it would
  -- create a second one beside it — the trap this migration's own closing comment warns
  -- about — and every caller would then have to be found and moved. LEAST here is the
  -- same arithmetic in a place that cannot fork the function.
  --
  -- Still AFTER the weighted sum and still only ever downward, which is the whole rule.
  CASE WHEN g.gated THEN LEAST(sc.score_final, t.cap_gate) ELSE sc.score_final END
    AS score_final,
  CASE WHEN g.gated
       THEN concat_ws(' ',
              'Teto ' || public.scorecard_score_label(t.cap_gate) || ': ' || g.reason || '.',
              sc.cap_reason)
       ELSE sc.cap_reason
  END AS cap_reason,
  (g.gated OR sc.cap_reason IS NOT NULL) AS cap_applied,
  -- Printed next to the score, because a score whose weights nobody can see is a score
  -- nobody can check.
  t.w_prod AS weight_production,
  t.w_qual AS weight_quality,
  t.w_doc  AS weight_documentation,

  -- volume_source, appended LAST rather than filed under Volume where it belongs
  -- thematically: inserting a column mid-list renumbers everything after it, and this
  -- view is read positionally by nothing we can prove. Appending cannot break a reader.
  --
  -- It is a base-table column (20260816090000) and a field the screen WRITES, but it was
  -- missing from every version of this view, and that made it a column the screen could
  -- only ever write once. src/lib/scorecardEntry.ts pickWritable() projects a fetched view
  -- row down to the draft's own keys; a key the view does not carry is not restored, so
  -- the draft held NULL and the next save wrote NULL over the stamp. Reopening a week and
  -- touching any field erased the record of whether the volume was derived or typed by
  -- hand — the audit column, silently, on the save that looked like it had worked.
  s.volume_source

FROM public.leader_weekly_scorecard s
LEFT JOIN public.line_leaders ll ON ll.id = s.leader_id
LEFT JOIN public.lines        ln ON ln.id = s.line_id

-- The thresholds as of the week being judged. One pass over the table per row, pivoted
-- here so no rule below has to know how the table is shaped.
CROSS JOIN LATERAL (
  SELECT
    max(th.value) FILTER (WHERE th.name = 'THR_VolAmberMin')  AS vol_amber_min,
    max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMin')  AS vol_green_min,
    max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMax')  AS vol_green_max,
    max(th.value) FILTER (WHERE th.name = 'THR_ProdMinutes')  AS prod_minutes,
    max(th.value) FILTER (WHERE th.name = 'THR_HSTrainRed')   AS hs_train_red,
    max(th.value) FILTER (WHERE th.name = 'THR_HSTrainGreen') AS hs_train_green,
    max(th.value) FILTER (WHERE th.name = 'THR_NearMissMin')  AS near_miss_min,
    max(th.value) FILTER (WHERE th.name = 'THR_SafetyObsMin') AS safety_obs_min,
    max(th.value) FILTER (WHERE th.name = 'THR_ToolboxMin')   AS toolbox_min,
    max(th.value) FILTER (WHERE th.name = 'THR_PPEMin')       AS ppe_min,
    max(th.value) FILTER (WHERE th.name = 'THR_AttendTarget') AS attend_target,
    -- The score's parameters, resolved on exactly the same as-of date as the RAG's, so
    -- a week can never be banded under one vintage and scored under another.
    max(th.value) FILTER (WHERE th.name = 'W_Production')        AS w_prod,
    max(th.value) FILTER (WHERE th.name = 'W_Quality')           AS w_qual,
    max(th.value) FILTER (WHERE th.name = 'W_Documentation')     AS w_doc,
    max(th.value) FILTER (WHERE th.name = 'THR_OverProdBand')    AS over_prod_band,
    max(th.value) FILTER (WHERE th.name = 'THR_OverProdPenalty') AS over_prod_penalty,
    max(th.value) FILTER (WHERE th.name = 'THR_VolZero')         AS vol_zero,
    max(th.value) FILTER (WHERE th.name = 'THR_QualFailPenalty') AS qual_fail_penalty,
    max(th.value) FILTER (WHERE th.name = 'CAP_Gate')            AS cap_gate,
    max(th.value) FILTER (WHERE th.name = 'CAP_NotDone')         AS cap_not_done,
    max(th.value) FILTER (WHERE th.name = 'CAP_HSAmber')         AS cap_hs_amber,
    max(th.value) FILTER (WHERE th.name = 'USE_AdjustedForScore') AS use_adjusted
  FROM public.leader_scorecard_threshold th
  WHERE s.week_ending >= th.valid_from
    AND (th.valid_to IS NULL OR s.week_ending <= th.valid_to)
) t

CROSS JOIN LATERAL (
  SELECT
    CASE WHEN s.planned_volume IS NULL OR s.actual_volume IS NULL THEN NULL
         ELSE s.actual_volume::numeric / s.planned_volume::numeric END AS volume_pct
) p
CROSS JOIN LATERAL (
  SELECT
    p.volume_pct,
    public.scorecard_volume_pct_adjusted(
      s.actual_volume, s.planned_volume, s.unplanned_downtime_minutes, t.prod_minutes)
      AS volume_pct_adjusted,
    -- The official band reads the RAW figure. The adjusted one is displayed beside it
    -- and judges nothing.
    public.scorecard_volume_rag(
      p.volume_pct, t.vol_amber_min, t.vol_green_min, t.vol_green_max) AS volume_rag
) v
CROSS JOIN LATERAL (
  SELECT ARRAY[s.ccp_check_status, s.starter_check_status, s.volume_weight_check_status]
    AS checks
) c
CROSS JOIN LATERAL (
  SELECT public.scorecard_quality_rag(c.checks)       AS quality_rag,
         public.scorecard_quality_fail_type(c.checks) AS quality_fail_type
) q
CROSS JOIN LATERAL (
  SELECT public.scorecard_hs_evaluate(
    s.lost_time_injuries, s.reportable_accidents, s.first_aid_cases,
    s.near_misses_reported, s.safety_observations_done, s.toolbox_talks_done,
    s.ppe_compliance_pct, s.hs_training_compliance_pct, s.overdue_hs_actions,
    t.hs_train_red, t.hs_train_green, t.near_miss_min,
    t.safety_obs_min, t.toolbox_min, t.ppe_min) AS eval
) h

-- Rule M, both layers, in one call. It is given the H&S band that h computed rather
-- than the raw H&S fields, so the ceiling and the RAG cannot ever disagree about
-- whether the week was Amber.
-- Called in FROM rather than as (f(...)).* in the select list: the star form re-runs
-- the function once per column it expands, and this one is six columns wide.
-- The action gate: a quality action carrying a label marked is_gate.
--
-- LEADER AND WEEK, NOT LINE. The specification says the gate applies to "aquele periodo
-- e aquele lider", and this follows it literally — so a CCP failure on Line 3 also turns
-- the same leader's Line 5 row Red that week. That is a real consequence and it is the
-- reason rag_driver names the event first: somebody reading Red on a clean line has to
-- be able to see, on the row itself, that the cause was a food safety event elsewhere in
-- that leader's week. Matching the line instead would need quality_actions.line to agree
-- with lines.name as free text, which is the class of match that has already cost this
-- project a leader's entire quality section.
--
-- The leader join takes the id when the action has one and falls back to the name
-- otherwise: quality_actions.leader_id is nullable, and a gate that skipped the rows
-- without it would fail OPEN on exactly the oldest data.
--
-- A rejected action is void — Quality looked and said it did not happen. Nothing else
-- voids it: not a closed CAPA, not attribution. The gate records that the event occurred.
CROSS JOIN LATERAL (
  SELECT
    count(*) > 0 AS gated,
    string_agg(DISTINCT o.value || ' em ' || to_char(a.recorded_at, 'DD/MM'), '; ')
      AS reason
  FROM public.quality_actions a
  JOIN public.quality_options o
    ON o.kind = 'label' AND o.is_gate = true AND o.value = ANY(a.labels)
  WHERE a.validation_status IS DISTINCT FROM 'rejected'
    AND a.recorded_at::date BETWEEN s.week_ending - 6 AND s.week_ending
    AND (a.leader_id = s.leader_id
         OR (a.leader_id IS NULL
             AND ll.name IS NOT NULL
             AND lower(btrim(a.leader_name)) = lower(btrim(ll.name))))
) g

CROSS JOIN LATERAL public.scorecard_score_evaluate(
    -- The raw figure by default. USE_AdjustedForScore is the business decision, held
    -- as a parameter precisely so it is never an accident.
    CASE WHEN coalesce(t.use_adjusted, 0) = 1 THEN v.volume_pct_adjusted ELSE p.volume_pct END,
    c.checks, s.lost_time_injuries, s.reportable_accidents, (h.eval).rag,
    t.w_prod, t.w_qual, t.w_doc,
    t.vol_amber_min, t.vol_green_min, t.vol_green_max,
    t.over_prod_band, t.over_prod_penalty, t.vol_zero, t.qual_fail_penalty,
    t.cap_gate, t.cap_not_done, t.cap_hs_amber) AS sc;

COMMENT ON VIEW public.v_leader_weekly_scorecard IS
  'O scorecard semanal calculado, ao nivel lider x linha x semana. Definicao unica de volume_pct, volume_pct_adjusted, volume_rag, quality_rag, quality_fail_type, hs_rag, hs_driver, overall_rag e rag_driver: os rollups, o resumo, a tendencia e o ranking leem esta view e nao repetem nenhuma regra. Desde 20260826090000 o RAG e o tecto tambem respondem a accoes com etiqueta is_gate, ao nivel lider x semana.';
