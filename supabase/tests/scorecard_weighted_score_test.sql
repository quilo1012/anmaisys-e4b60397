-- Tests for the 0-100 weighted score and its two layers (item M).
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after
-- 20260818090000_a_gate_is_a_ceiling_not_a_weight.sql has been applied. It opens a
-- transaction, creates its own throwaway leader, line, assignment and weeks, asserts,
-- and ROLLBACKs: nothing survives it. The last statement prints 'ALL TESTS PASSED';
-- any failure raises and aborts before that line, naming the case that failed.
--
-- Unlike leader_weekly_scorecard_test.sql, this file seeds every row it asserts on, so
-- it can be run against an empty database and against a full one.
--
-- It must run as a role that bypasses RLS (the SQL Editor's postgres role does).
-- Leader and line names are placeholders: no real leader and no real line appears here.

BEGIN;

CREATE FUNCTION pg_temp.expect(_case text, _got text, _want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'FAILED %  — esperado [%], obtido [%]',
      _case, COALESCE(_want, '<NULL>'), COALESCE(_got, '<NULL>');
  END IF;
END $$;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN
    RAISE EXCEPTION 'FAILED %  — esperado verdadeiro, obtido [%]', _case, COALESCE(_got::text, '<NULL>');
  END IF;
END $$;

-- Rounded to two places before comparing: the score is numeric and 91.666… is not a
-- literal anybody should have to write out to assert on.
CREATE FUNCTION pg_temp.expect_num(_case text, _got numeric, _want numeric) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NULL AND _want IS NULL THEN RETURN; END IF;
  IF _got IS NULL OR _want IS NULL OR round(_got, 2) <> round(_want, 2) THEN
    RAISE EXCEPTION 'FAILED %  — esperado [%], obtido [%]',
      _case, COALESCE(_want::text, '<NULL>'), COALESCE(_got::text, '<NULL>');
  END IF;
END $$;

-- ==============================================================
-- Fixtures. Placeholder names only.
-- ==============================================================

INSERT INTO public.lines (id, name)
VALUES ('33333333-3333-3333-3333-333333333301', 'LINHA_M1');

INSERT INTO public.line_leaders (id, name, shift)
VALUES ('44444444-4444-4444-4444-444444444401', 'LIDER_M', 'DAY');

INSERT INTO public.leader_line_assignment (leader_id, line_id, valid_from)
VALUES ('44444444-4444-4444-4444-444444444401',
        '33333333-3333-3333-3333-333333333301', DATE '2026-07-01');

-- Six weeks, one per case. All in July 2026, which is in the past relative to any
-- re-weighting done later in this file — that is what the versioning case turns on.
INSERT INTO public.leader_weekly_scorecard (
  leader_id, line_id, week_ending,
  planned_volume, actual_volume,
  ccp_check_status, starter_check_status, volume_weight_check_status,
  lost_time_injuries, reportable_accidents, first_aid_cases, near_misses_reported,
  safety_observations_done, toolbox_talks_done, ppe_compliance_pct,
  hs_training_compliance_pct, overdue_hs_actions,
  root_cause, corrective_action, capa_owner, capa_due_date)
VALUES
  -- W1 — 100% do plano, tres Pass, e NENHUM dado de H&S. Score 100, sem teto.
  ('44444444-4444-4444-4444-444444444401', '33333333-3333-3333-3333-333333333301', DATE '2026-07-05',
   1000, 1000, 'Pass', 'Pass', 'Pass',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),

  -- W2 — igual, mas com H&S recolhido e ZERO near-misses reportados. Sub-reporte:
  -- hs_rag Amber, bruto 100, final 79.
  ('44444444-4444-4444-4444-444444444401', '33333333-3333-3333-3333-333333333301', DATE '2026-07-12',
   1000, 1000, 'Pass', 'Pass', 'Pass',
   0, 0, 0, 0, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL),

  -- W3 — um check reprovado. Gate de food safety: teto 49 e CAPA preenchida, senao a
  -- semana nem podia ser aprovada (a CAPA vai aqui para o caso 4 poder aprova-la).
  ('44444444-4444-4444-4444-444444444401', '33333333-3333-3333-3333-333333333301', DATE '2026-07-19',
   1000, 1000, 'Fail', 'Pass', 'Pass',
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0,
   'causa', 'accao', 'DONO_PLACEHOLDER', DATE '2026-08-31'),

  -- W4 — um check nao realizado. Disciplina, nao desvio de produto: teto 69.
  ('44444444-4444-4444-4444-444444444401', '33333333-3333-3333-3333-333333333301', DATE '2026-07-26',
   1000, 1000, 'Not Done', 'Pass', 'Pass',
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL),

  -- W5 — 108% do plano. Superproducao: ProdScore abaixo de 100, e o RAG em Amber.
  ('44444444-4444-4444-4444-444444444401', '33333333-3333-3333-3333-333333333301', DATE '2026-08-02',
   1000, 1080, 'Pass', 'Pass', 'Pass',
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL),

  -- W6 — acidente com afastamento, com volume perfeito e qualidade Green. O teto
  -- absoluto: nada disto compra de volta o 49.
  ('44444444-4444-4444-4444-444444444401', '33333333-3333-3333-3333-333333333301', DATE '2026-08-09',
   1000, 1000, 'Pass', 'Pass', 'Pass',
   1, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL),

  -- W7 — semana sem NENHUM check preenchido. Score NULO, e nao zero.
  ('44444444-4444-4444-4444-444444444401', '33333333-3333-3333-3333-333333333301', DATE '2026-08-16',
   1000, 1000, NULL, NULL, NULL,
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL);

-- ==============================================================
-- Layer 1 and layer 2, week by week
-- ==============================================================
DO $$
DECLARE r record;
BEGIN
  -- CASO: volume 100%, todos Pass, sem dados de H&S -> score 100, SEM teto.
  -- H&S nulo nao e Amber e por isso nao baixa o teto: ausencia de dados nao pontua,
  -- em nenhuma direccao.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE week_ending = '2026-07-05';
  PERFORM pg_temp.expect_num ('W1 prod_score',  r.prod_score,  100);
  PERFORM pg_temp.expect_num ('W1 qual_score',  r.qual_score,  100);
  PERFORM pg_temp.expect_num ('W1 doc_score',   r.doc_score,   100);
  PERFORM pg_temp.expect_num ('W1 score_bruto', r.score_bruto, 100);
  PERFORM pg_temp.expect_num ('W1 score_final', r.score_final, 100);
  PERFORM pg_temp.expect    ('W1 cap_reason',  r.cap_reason,  NULL);
  PERFORM pg_temp.expect    ('W1 cap_applied', r.cap_applied::text, 'false');
  PERFORM pg_temp.expect    ('W1 hs_rag',      r.hs_rag,      NULL);
  PERFORM pg_temp.expect    ('W1 overall_rag', r.overall_rag, 'Green');

  -- CASO: zero near-miss reportado -> Amber, bruto 100, final 79.
  -- A regra invertida. Zero quase-acidentes nao e uma linha segura, e uma linha que
  -- nao reporta, e o score paga por isso mesmo com volume e qualidade perfeitos.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE week_ending = '2026-07-12';
  PERFORM pg_temp.expect_num ('W2 score_bruto', r.score_bruto, 100);
  PERFORM pg_temp.expect_num ('W2 score_final', r.score_final, 79);
  PERFORM pg_temp.expect     ('W2 hs_rag',      r.hs_rag,      'Amber');
  PERFORM pg_temp.expect_true('W2 cap_reason nomeia o H&S', r.cap_reason LIKE '%Health & Safety%');
  PERFORM pg_temp.expect     ('W2 overall_rag', r.overall_rag, 'Amber');

  -- CASO: um check "Fail" -> final <= 49 e RAG Red. E a Documentation NAO paga por
  -- ele: o check foi feito e registado, reprovou. Só o Quality paga.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE week_ending = '2026-07-19';
  PERFORM pg_temp.expect_num ('W3 qual_score',  r.qual_score,  50);
  PERFORM pg_temp.expect_num ('W3 doc_score',   r.doc_score,   100);
  PERFORM pg_temp.expect_num ('W3 score_bruto', r.score_bruto, 82.5);
  PERFORM pg_temp.expect_num ('W3 score_final', r.score_final, 49);
  PERFORM pg_temp.expect_true('W3 final <= 49', r.score_final <= 49);
  PERFORM pg_temp.expect     ('W3 quality_fail_type', r.quality_fail_type, 'Fail');
  PERFORM pg_temp.expect     ('W3 capa_required',     r.capa_required::text, 'true');
  PERFORM pg_temp.expect     ('W3 overall_rag',       r.overall_rag, 'Red');

  -- CASO: um check "Not Done" -> MESMO RAG (Red), tipo de falha diferente, teto
  -- diferente (69) e CAPA nao obrigatoria. Aqui paga a Documentation, nao a Quality.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE week_ending = '2026-07-26';
  PERFORM pg_temp.expect_num ('W4 qual_score',  r.qual_score,  100);
  PERFORM pg_temp.expect_num ('W4 doc_score',   r.doc_score,   66.67);
  PERFORM pg_temp.expect_num ('W4 score_bruto', r.score_bruto, 91.67);
  PERFORM pg_temp.expect_num ('W4 score_final', r.score_final, 69);
  PERFORM pg_temp.expect     ('W4 quality_fail_type', r.quality_fail_type, 'Not Done');
  PERFORM pg_temp.expect     ('W4 capa_required',     r.capa_required::text, 'false');
  PERFORM pg_temp.expect     ('W4 overall_rag',       r.overall_rag, 'Red');

  -- CASO: volume 108% -> ProdScore < 100 e RAG Amber. Superproducao nunca pontua a
  -- cheio, porque e stock que ninguem encomendou.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE week_ending = '2026-08-02';
  PERFORM pg_temp.expect_num ('W5 prod_score',  r.prod_score, 70);
  PERFORM pg_temp.expect_true('W5 prod_score < 100', r.prod_score < 100);
  PERFORM pg_temp.expect     ('W5 volume_rag',  r.volume_rag, 'Amber');

  -- CASO: LTI = 1 com volume 100% e qualidade Green -> final 49 e RAG Red.
  -- O bruto e 100 e nao serve de nada: o gate e um teto, e um teto nao se compensa.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE week_ending = '2026-08-09';
  PERFORM pg_temp.expect_num ('W6 score_bruto', r.score_bruto, 100);
  PERFORM pg_temp.expect_num ('W6 score_final', r.score_final, 49);
  PERFORM pg_temp.expect_true('W6 cap_reason nomeia o acidente', r.cap_reason LIKE '%afastamento%');
  PERFORM pg_temp.expect     ('W6 volume_rag',  r.volume_rag,  'Green');
  PERFORM pg_temp.expect     ('W6 quality_rag', r.quality_rag, 'Green');
  PERFORM pg_temp.expect     ('W6 overall_rag', r.overall_rag, 'Red');

  -- CASO: semana sem checks preenchidos -> score NULO, nao zero, e sem teto.
  -- Um pilar sem dados tratado como zero fica invisivel dentro de uma soma ponderada:
  -- 0 e "nao informado" colapsam no mesmo numero.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE week_ending = '2026-08-16';
  PERFORM pg_temp.expect_num('W7 qual_score',  r.qual_score,  NULL);
  PERFORM pg_temp.expect_num('W7 doc_score',   r.doc_score,   NULL);
  PERFORM pg_temp.expect_num('W7 score_bruto', r.score_bruto, NULL);
  PERFORM pg_temp.expect_num('W7 score_final', r.score_final, NULL);
  PERFORM pg_temp.expect    ('W7 cap_reason',  r.cap_reason,  NULL);
  -- O ProdScore existe: o volume foi informado. E o score ponderado que nao existe.
  PERFORM pg_temp.expect_num('W7 prod_score',  r.prod_score,  100);
END $$;

-- ==============================================================
-- A semana sem score nao entra no denominador da media
-- ==============================================================
DO $$
DECLARE r record; _manual numeric;
BEGIN
  SELECT * INTO r FROM public.v_scorecard_rollup_leader
   WHERE leader_id = '44444444-4444-4444-4444-444444444401'
     AND period_type = 'mensal' AND period_start = '2026-08-01';

  -- Agosto tem tres semanas: 108% (sem teto), LTI (49) e a semana sem checks (nula).
  PERFORM pg_temp.expect('rollup weeks_recorded', r.weeks_recorded::text, '3');

  -- A media e sobre DUAS semanas, nao tres. Se a semana nula contasse como zero, a
  -- media cairia para dois tercos do valor certo — e ninguem veria porque.
  SELECT avg(score_final) INTO _manual
    FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '44444444-4444-4444-4444-444444444401'
     AND week_ending IN ('2026-08-02', '2026-08-09');
  PERFORM pg_temp.expect_num('rollup avg_score_final exclui a semana nula',
                             r.avg_score_final, _manual);
  PERFORM pg_temp.expect_true('rollup avg_score_final acima de 2/3 da media certa',
                              r.avg_score_final > _manual * 2 / 3);

  PERFORM pg_temp.expect('rollup weeks_with_cap_applied', r.weeks_with_cap_applied::text, '1');
END $$;

-- ==============================================================
-- Os pesos: soma 100, rejeicao no banco, e vigencia
-- ==============================================================
DO $$
DECLARE _ok boolean := false; _before numeric; _after numeric;
BEGIN
  -- 40/35/25 soma 100 -> aceite.
  UPDATE public.leader_score_weights
     SET production_pct = 40, quality_pct = 35, documentation_pct = 25 WHERE id;

  -- 40/35/30 soma 105 -> REJEITADO, e rejeitado pelo banco, nao pela UI.
  BEGIN
    UPDATE public.leader_score_weights
       SET production_pct = 40, quality_pct = 35, documentation_pct = 30 WHERE id;
  EXCEPTION WHEN check_violation THEN _ok := true;
  END;
  PERFORM pg_temp.expect_true('pesos que nao somam 100 sao rejeitados', _ok);

  -- Vigencia. Uma semana de Julho tem de sobreviver a uma mudanca de pesos feita hoje.
  SELECT score_final INTO _before FROM public.v_leader_weekly_scorecard
   WHERE week_ending = '2026-07-26';

  UPDATE public.leader_score_weights
     SET production_pct = 60, quality_pct = 20, documentation_pct = 20 WHERE id;

  SELECT score_final INTO _after FROM public.v_leader_weekly_scorecard
   WHERE week_ending = '2026-07-26';

  PERFORM pg_temp.expect_num('score historico inalterado por re-pesagem posterior',
                             _after, _before);

  -- E a versao nova existe mesmo, com data de hoje: o teste acima falharia por engano
  -- se a gravacao nao tivesse chegado a lado nenhum.
  PERFORM pg_temp.expect_true('a re-pesagem abriu uma versao datada de hoje', EXISTS (
    SELECT 1 FROM public.leader_scorecard_threshold
     WHERE name = 'W_Production' AND value = 60
       AND valid_from = current_date AND valid_to IS NULL));

  -- E a versao antiga ficou fechada ontem, nao apagada.
  PERFORM pg_temp.expect_true('a versao antiga foi fechada, nao reescrita', EXISTS (
    SELECT 1 FROM public.leader_scorecard_threshold
     WHERE name = 'W_Production' AND value = 40 AND valid_to = current_date - 1));
END $$;

-- ==============================================================
-- O gate da CAPA continua a valer com o score por cima dele
-- ==============================================================
DO $$
DECLARE _ok boolean := false;
BEGIN
  -- A semana com Fail (W3) tem CAPA preenchida e pode ser aprovada.
  UPDATE public.leader_weekly_scorecard
     SET approved_by = '44444444-4444-4444-4444-444444444401', approved_at = now()
   WHERE week_ending = '2026-07-19';

  -- A mesma semana sem a investigacao escrita nao pode.
  BEGIN
    UPDATE public.leader_weekly_scorecard
       SET root_cause = NULL
     WHERE week_ending = '2026-07-19';
  EXCEPTION WHEN check_violation THEN _ok := true;
  END;
  PERFORM pg_temp.expect_true('Fail aprovado nao pode ficar sem root_cause', _ok);
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
