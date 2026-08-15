-- Tests for the weekly Line Leader scorecard, v2 (two gates).
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after
-- 20260815140000_health_and_safety_is_the_second_gate.sql has been applied. It opens a
-- transaction, writes throwaway rows, asserts, and ROLLBACKs: nothing survives it. The
-- last statement prints 'ALL TESTS PASSED'; any failure raises and aborts before that
-- line, naming the case that failed.
--
-- It must run as a role that bypasses RLS (the SQL Editor's postgres role does).
-- Leader and line names are placeholders: no real leader and no real line appears here.
--
-- The rollup cases assume the scorecard table is otherwise empty, because the period
-- spine takes its calendar from min/max week_ending across the whole table. If real
-- weeks already exist, the spine widens and the "no weeks recorded" case has more
-- periods to be absent from — the assertions below still hold, they just cover less.

BEGIN;

CREATE FUNCTION pg_temp.expect(_case text, _got text, _want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'FAILED %  — esperado [%], obtido [%]',
      _case, COALESCE(_want, '<NULL>'), COALESCE(_got, '<NULL>');
  END IF;
END $$;

CREATE FUNCTION pg_temp.expect_like(_case text, _got text, _pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NULL OR _got NOT LIKE _pattern THEN
    RAISE EXCEPTION 'FAILED %  — esperado conter [%], obtido [%]',
      _case, _pattern, COALESCE(_got, '<NULL>');
  END IF;
END $$;

-- =====================================================================
-- Fixtures. One leader per case, so no case can disturb another.
-- =====================================================================

INSERT INTO public.lines (id, name, active) VALUES
  ('11111111-1111-1111-1111-111111111101', 'LINHA_TESTE_1', true),
  ('11111111-1111-1111-1111-111111111102', 'LINHA_TESTE_2', true);

INSERT INTO public.line_leaders (id, name, shift, active) VALUES
  ('22222222-2222-2222-2222-2222222222a1', 'LIDER_A', 'Teste', true),  -- volume
  ('22222222-2222-2222-2222-2222222222a2', 'LIDER_B', 'Teste', true),  -- volume/downtime
  ('22222222-2222-2222-2222-2222222222a3', 'LIDER_C', 'Teste', true),  -- Fail
  ('22222222-2222-2222-2222-2222222222a4', 'LIDER_D', 'Teste', true),  -- Not Done
  ('22222222-2222-2222-2222-2222222222a5', 'LIDER_E', 'Teste', true),  -- near-miss zero
  ('22222222-2222-2222-2222-2222222222a6', 'LIDER_F', 'Teste', true),  -- LTI
  ('22222222-2222-2222-2222-2222222222a7', 'LIDER_G', 'Teste', true),  -- sem semanas
  ('22222222-2222-2222-2222-2222222222a8', 'LIDER_H', 'Teste', true),  -- sem dados de H&S
  ('22222222-2222-2222-2222-2222222222a9', 'LIDER_I', 'Teste', true);  -- troca de linha

INSERT INTO public.leader_line_assignment (leader_id, line_id, valid_from, valid_to) VALUES
  ('22222222-2222-2222-2222-2222222222a1', '11111111-1111-1111-1111-111111111101', '2026-07-01', NULL),
  ('22222222-2222-2222-2222-2222222222a2', '11111111-1111-1111-1111-111111111101', '2026-07-01', NULL),
  ('22222222-2222-2222-2222-2222222222a3', '11111111-1111-1111-1111-111111111101', '2026-07-01', NULL),
  ('22222222-2222-2222-2222-2222222222a4', '11111111-1111-1111-1111-111111111101', '2026-07-01', NULL),
  ('22222222-2222-2222-2222-2222222222a5', '11111111-1111-1111-1111-111111111101', '2026-07-01', NULL),
  ('22222222-2222-2222-2222-2222222222a6', '11111111-1111-1111-1111-111111111101', '2026-07-01', NULL),
  -- LIDER_G is assigned and never records a week: the whole point of guard 1.
  ('22222222-2222-2222-2222-2222222222a7', '11111111-1111-1111-1111-111111111101', '2026-07-01', NULL),
  ('22222222-2222-2222-2222-2222222222a8', '11111111-1111-1111-1111-111111111101', '2026-07-01', NULL),
  -- LIDER_I moves line mid-quarter.
  ('22222222-2222-2222-2222-2222222222a9', '11111111-1111-1111-1111-111111111101', '2026-07-01', '2026-07-31'),
  ('22222222-2222-2222-2222-2222222222a9', '11111111-1111-1111-1111-111111111102', '2026-08-01', NULL);

-- A clean H&S block, reused by the cases that are not about H&S: everything at or
-- above the minimum so that hs_rag is Green and the case under test is the only thing
-- that can move the overall band.
-- (lti, reportable, first_aid, near, obs, toolbox, ppe, training, overdue)
--  0, 0, 0, 1, 2, 1, 1.0, 1.0, 0

INSERT INTO public.leader_weekly_scorecard
  (leader_id, line_id, week_ending, planned_volume, actual_volume,
   unplanned_downtime_minutes, downtime_reason,
   ccp_check_status, starter_check_status, volume_weight_check_status,
   lost_time_injuries, reportable_accidents, first_aid_cases, near_misses_reported,
   safety_observations_done, toolbox_talks_done, ppe_compliance_pct,
   hs_training_compliance_pct, overdue_hs_actions,
   root_cause, corrective_action, capa_owner, capa_due_date)
VALUES
  -- 1. Superproducao: 108,2% do plano.
  ('22222222-2222-2222-2222-2222222222a1', '11111111-1111-1111-1111-111111111101',
   '2026-07-05', 1000, 1082, NULL, NULL, 'Pass','Pass','Pass',
   0,0,0,1,2,1,1.0,1.0,0, NULL,NULL,NULL,NULL),

  -- 2. Downtime nao planeado: bruto 90%, ajustado 100%.
  ('22222222-2222-2222-2222-2222222222a2', '11111111-1111-1111-1111-111111111101',
   '2026-07-05', 1000, 900, 240, 'Falta de Materia Prima', 'Pass','Pass','Pass',
   0,0,0,1,2,1,1.0,1.0,0, NULL,NULL,NULL,NULL),

  -- 3. Fail: mesmo Red, mas com CAPA obrigatoria. O volume esta em 100%.
  ('22222222-2222-2222-2222-2222222222a3', '11111111-1111-1111-1111-111111111101',
   '2026-07-05', 1000, 1000, NULL, NULL, 'Fail','Pass','Pass',
   0,0,0,1,2,1,1.0,1.0,0,
   'Causa de teste', 'Accao de teste', 'DONO_TESTE', '2026-07-31'),

  -- 4. Not Done: mesmo Red, sem CAPA obrigatoria.
  ('22222222-2222-2222-2222-2222222222a4', '11111111-1111-1111-1111-111111111101',
   '2026-07-05', 1000, 1000, NULL, NULL, 'Pass','Pass','Not Done',
   0,0,0,1,2,1,1.0,1.0,0, NULL,NULL,NULL,NULL),

  -- 5. Zero near-miss reportado, tudo o resto em ordem.
  ('22222222-2222-2222-2222-2222222222a5', '11111111-1111-1111-1111-111111111101',
   '2026-07-05', 1000, 1000, NULL, NULL, 'Pass','Pass','Pass',
   0,0,0,0,2,1,1.0,1.0,0, NULL,NULL,NULL,NULL),

  -- 6. Um acidente com afastamento, volume em 100% e qualidade Green.
  ('22222222-2222-2222-2222-2222222222a6', '11111111-1111-1111-1111-111111111101',
   '2026-07-05', 1000, 1000, NULL, NULL, 'Pass','Pass','Pass',
   1,0,0,1,2,1,1.0,1.0,0, NULL,NULL,NULL,NULL),

  -- 7. Semana registada SEM nenhum campo de H&S. Os nove ficam NULL.
  ('22222222-2222-2222-2222-2222222222a8', '11111111-1111-1111-1111-111111111101',
   '2026-07-05', 1000, 1000, NULL, NULL, 'Pass','Pass','Pass',
   NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL, NULL,NULL,NULL,NULL),

  -- 8. Troca de linha a meio do trimestre: uma semana de cada lado da mudanca.
  ('22222222-2222-2222-2222-2222222222a9', '11111111-1111-1111-1111-111111111101',
   '2026-07-05', 1000, 1000, NULL, NULL, 'Pass','Pass','Pass',
   0,0,0,1,2,1,1.0,1.0,0, NULL,NULL,NULL,NULL),
  ('22222222-2222-2222-2222-2222222222a9', '11111111-1111-1111-1111-111111111102',
   '2026-08-09', 1000, 1000, NULL, NULL, 'Pass','Pass','Pass',
   0,0,0,1,2,1,1.0,1.0,0, NULL,NULL,NULL,NULL);

-- =====================================================================
-- Weekly assertions
-- =====================================================================

DO $$
DECLARE w record;
BEGIN
  -- CASO 1 — superproducao e Amber, nao Green.
  SELECT * INTO w FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a1';
  PERFORM pg_temp.expect('1 superproducao volume_rag',  w.volume_rag,  'Amber');
  PERFORM pg_temp.expect('1 superproducao overall_rag', w.overall_rag, 'Amber');
  PERFORM pg_temp.expect_like('1 superproducao driver', w.rag_driver, '%108,2% (superproducao).%');

  -- CASO 2 — o downtime nao mexe no bruto e levanta o ajustado.
  SELECT * INTO w FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a2';
  PERFORM pg_temp.expect('2 downtime volume_pct bruto',
    round(w.volume_pct, 4)::text, '0.9000');
  PERFORM pg_temp.expect('2 downtime volume_pct ajustado',
    round(w.volume_pct_adjusted, 4)::text, '1.0000');
  -- O RAG oficial le o BRUTO. Se lesse o ajustado, esta semana seria Green.
  PERFORM pg_temp.expect('2 downtime volume_rag usa o bruto', w.volume_rag, 'Red');

  -- CASO 3 — Fail.
  SELECT * INTO w FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a3';
  PERFORM pg_temp.expect('3 Fail quality_rag',       w.quality_rag,       'Red');
  PERFORM pg_temp.expect('3 Fail quality_fail_type', w.quality_fail_type, 'Fail');
  PERFORM pg_temp.expect('3 Fail capa_required',     w.capa_required::text, 'true');
  PERFORM pg_temp.expect('3 Fail overall (gate)',    w.overall_rag,       'Red');
  PERFORM pg_temp.expect_like('3 Fail driver', w.rag_driver, '%CCP reprovado; CAPA obrigatoria.%');

  -- CASO 4 — Not Done: mesmo RAG, outro tipo, sem CAPA.
  SELECT * INTO w FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a4';
  PERFORM pg_temp.expect('4 NotDone quality_rag',       w.quality_rag,       'Red');
  PERFORM pg_temp.expect('4 NotDone quality_fail_type', w.quality_fail_type, 'Not Done');
  PERFORM pg_temp.expect('4 NotDone capa_required',     w.capa_required::text, 'false');
  PERFORM pg_temp.expect_like('4 NotDone driver', w.rag_driver, '%Vol&Peso nao realizado.%');

  -- CASO 5 — zero near-miss reportado e Amber (sub-reporte), nunca um bom resultado.
  SELECT * INTO w FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a5';
  PERFORM pg_temp.expect('5 near-miss zero hs_rag',      w.hs_rag,      'Amber');
  PERFORM pg_temp.expect('5 near-miss zero overall_rag', w.overall_rag, 'Amber');
  PERFORM pg_temp.expect_like('5 near-miss zero driver', w.rag_driver, '%sub-reporte%');

  -- CASO 6 — LTI com volume em 100% e qualidade Green da Red na mesma.
  SELECT * INTO w FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a6';
  PERFORM pg_temp.expect('6 LTI volume_rag',  w.volume_rag,  'Green');
  PERFORM pg_temp.expect('6 LTI quality_rag', w.quality_rag, 'Green');
  PERFORM pg_temp.expect('6 LTI hs_rag',      w.hs_rag,      'Red');
  PERFORM pg_temp.expect('6 LTI overall_rag', w.overall_rag, 'Red');
  PERFORM pg_temp.expect_like('6 LTI driver', w.rag_driver, '%acidente(s) com afastamento%');

  -- CASO 7 — semana sem nenhum campo de H&S: hs_rag NULL, nunca Green e nunca Amber.
  SELECT * INTO w FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a8';
  PERFORM pg_temp.expect('7 sem H&S hs_rag e nulo', w.hs_rag, NULL);
  -- E o overall cai para a regra de volume/qualidade, sem ser bloqueado.
  PERFORM pg_temp.expect('7 sem H&S overall_rag',   w.overall_rag, 'Green');
  PERFORM pg_temp.expect_like('7 sem H&S driver', w.rag_driver, '%Dados de H&S ausentes.%');
END $$;

-- =====================================================================
-- Rollups — os dois guards
-- =====================================================================

DO $$
DECLARE r record;
BEGIN
  -- GUARD 1 — LIDER_G tem atribuicao e zero semanas: 'Sem dados', nunca Green.
  SELECT * INTO r FROM public.v_scorecard_rollup_leader
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a7'
     AND period_type = 'mensal' AND period_start = '2026-07-01';
  IF r IS NULL THEN
    RAISE EXCEPTION 'FAILED guard 1 — o grupo sem semanas nem sequer produziu linha';
  END IF;
  PERFORM pg_temp.expect('guard 1 weeks_recorded', r.weeks_recorded::text, '0');
  PERFORM pg_temp.expect('guard 1 quality_rag',    r.quality_rag,  'Sem dados');
  PERFORM pg_temp.expect('guard 1 hs_rag',         r.hs_rag,       'Sem dados');
  PERFORM pg_temp.expect('guard 1 overall_rag',    r.overall_rag,  NULL);
  -- Uma taxa sobre nada nao e uma taxa de zero.
  PERFORM pg_temp.expect('guard 1 near_misses_per_week', r.near_misses_per_week::text, NULL);

  -- GUARD 2 — LIDER_H tem uma semana registada mas nenhum dado de H&S nela.
  -- Sem o guard, near_misses_per_week = 0 dispararia a regra de sub-reporte e isto
  -- viria Amber, escondendo que ninguem preencheu.
  SELECT * INTO r FROM public.v_scorecard_rollup_leader
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a8'
     AND period_type = 'mensal' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('guard 2 weeks_recorded', r.weeks_recorded::text, '1');
  PERFORM pg_temp.expect('guard 2 quality_rag',    r.quality_rag, 'Green');
  PERFORM pg_temp.expect('guard 2 hs_rag',         r.hs_rag,      'Sem dados');
  -- H&S 'Sem dados' nao bloqueia o overall: cai para volume/qualidade.
  PERFORM pg_temp.expect('guard 2 overall_rag',    r.overall_rag, 'Green');
END $$;

-- =====================================================================
-- Troca de linha a meio do trimestre — agregacao em A, B e C
-- =====================================================================

DO $$
DECLARE _weeks bigint; _rows bigint;
BEGIN
  -- A) por lider: as duas semanas contam uma vez so, no mesmo trimestre.
  SELECT weeks_recorded INTO _weeks FROM public.v_scorecard_rollup_leader
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a9'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('troca A lider Q3 weeks', _weeks::text, '2');

  -- B) por linha: uma semana em cada linha.
  SELECT weeks_recorded INTO _weeks FROM public.v_scorecard_rollup_line
   WHERE line_id = '11111111-1111-1111-1111-111111111101'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('troca B linha 1 Q3 weeks (7 semanas de outros lideres + 1)',
    _weeks::text, '8');
  SELECT weeks_recorded INTO _weeks FROM public.v_scorecard_rollup_line
   WHERE line_id = '11111111-1111-1111-1111-111111111102'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('troca B linha 2 Q3 weeks', _weeks::text, '1');

  -- C) por lider x linha: duas linhas, uma semana cada, no mesmo trimestre.
  SELECT count(*) INTO _rows FROM public.v_scorecard_rollup_leader_line
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a9'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('troca C linhas no trimestre', _rows::text, '2');

  SELECT weeks_recorded INTO _weeks FROM public.v_scorecard_rollup_leader_line
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a9'
     AND line_id = '11111111-1111-1111-1111-111111111101'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('troca C linha antiga', _weeks::text, '1');

  SELECT weeks_recorded INTO _weeks FROM public.v_scorecard_rollup_leader_line
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a9'
     AND line_id = '11111111-1111-1111-1111-111111111102'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('troca C linha nova', _weeks::text, '1');

  -- E o mes de agosto so tem a linha nova: a atribuicao antiga ja fechou.
  SELECT count(*) INTO _rows FROM public.v_scorecard_rollup_leader_line
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a9'
     AND period_type = 'mensal' AND period_start = '2026-08-01';
  PERFORM pg_temp.expect('troca C agosto so tem a linha nova', _rows::text, '1');
END $$;

-- =====================================================================
-- Ranking — amostra insuficiente nao entra
-- =====================================================================

DO $$
DECLARE _rows bigint;
BEGIN
  -- Todos os lideres deste teste tem 1 ou 2 semanas, abaixo de THR_MinWeeks = 4.
  SELECT count(*) INTO _rows FROM public.v_scorecard_ranking_leader
   WHERE period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('ranking exclui amostra insuficiente', _rows::text, '0');
END $$;

-- =====================================================================
-- A CAPA obrigatoria e a trilha de auditoria
-- =====================================================================

DO $$
DECLARE _blocked boolean := false;
BEGIN
  -- Uma semana com Fail e sem CAPA nao pode ser aprovada.
  BEGIN
    UPDATE public.leader_weekly_scorecard
       SET root_cause = NULL, corrective_action = NULL, capa_owner = NULL,
           capa_due_date = NULL,
           approved_by = '33333333-3333-3333-3333-333333333333',
           approved_at = now()
     WHERE leader_id = '22222222-2222-2222-2222-2222222222a3';
  EXCEPTION WHEN check_violation THEN
    _blocked := true;
  END;
  IF NOT _blocked THEN
    RAISE EXCEPTION 'FAILED CAPA — semana com Fail foi aprovada sem CAPA';
  END IF;
END $$;

DO $$
DECLARE _blocked boolean := false;
BEGIN
  -- A mesma semana, COM a CAPA preenchida, aprova.
  UPDATE public.leader_weekly_scorecard
     SET approved_by = '33333333-3333-3333-3333-333333333333', approved_at = now()
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a3';

  -- E uma semana de Not Done nao exige CAPA nenhuma para ser aprovada.
  UPDATE public.leader_weekly_scorecard
     SET approved_by = '33333333-3333-3333-3333-333333333333', approved_at = now()
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a4';

  -- Mas uma aprovacao sem assinatura continua a ser recusada pelo CHECK do par.
  BEGIN
    UPDATE public.leader_weekly_scorecard
       SET approved_by = NULL, approved_at = now()
     WHERE leader_id = '22222222-2222-2222-2222-2222222222a5';
  EXCEPTION WHEN check_violation THEN
    _blocked := true;
  END;
  IF NOT _blocked THEN
    RAISE EXCEPTION 'FAILED trilha — aprovacao sem approved_by foi aceite';
  END IF;
END $$;

-- =====================================================================
-- A atribuicao versionada nao aceita sobreposicao do mesmo par
-- =====================================================================

DO $$
DECLARE _blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.leader_line_assignment (leader_id, line_id, valid_from, valid_to)
    VALUES ('22222222-2222-2222-2222-2222222222a1',
            '11111111-1111-1111-1111-111111111101', '2026-09-01', NULL);
  EXCEPTION WHEN exclusion_violation THEN
    _blocked := true;
  END;
  IF NOT _blocked THEN
    RAISE EXCEPTION 'FAILED atribuicao — sobreposicao do mesmo lider+linha foi aceite';
  END IF;
END $$;

-- =====================================================================
-- Resumo executivo — integridade dos dados
-- =====================================================================

DO $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM public.leader_scorecard_summary('2026-07-01', '2026-09-30');
  PERFORM pg_temp.expect('resumo weeks_recorded',  s.weeks_recorded::text, '9');
  PERFORM pg_temp.expect('resumo weeks_with_fail', s.weeks_with_fail::text, '1');
  PERFORM pg_temp.expect('resumo weeks_with_not_done', s.weeks_with_not_done::text, '1');
  PERFORM pg_temp.expect('resumo total_lti',       s.total_lti::text, '1');
  PERFORM pg_temp.expect('resumo rows_missing_hs_data', s.rows_missing_hs_data::text, '1');
  PERFORM pg_temp.expect('resumo weeks_overproduction', s.weeks_overproduction::text, '1');
  PERFORM pg_temp.expect('resumo weeks_with_fail_without_capa',
    s.weeks_with_fail_without_capa::text, '0');
  -- Um periodo vazio devolve uma linha a dizer zero, e a taxa vem NULL e nao 0%.
  SELECT * INTO s FROM public.leader_scorecard_summary('2020-01-01', '2020-01-31');
  PERFORM pg_temp.expect('resumo periodo vazio weeks', s.weeks_recorded::text, '0');
  PERFORM pg_temp.expect('resumo periodo vazio pct_weeks_red', s.pct_weeks_red::text, NULL);
END $$;

-- =====================================================================
-- O quadro da semana (Task 1)
-- =====================================================================

DO $$
DECLARE r record; _rows bigint;
BEGIN
  -- Uma linha por lider x linha ESPERADA na semana, mesmo sem registo.
  SELECT count(*) INTO _rows FROM public.scorecard_week_board('2026-07-05');
  PERFORM pg_temp.expect('board linhas esperadas', _rows::text, '9');

  -- LIDER_G tem atribuicao e nao preencheu: aparece, e aparece como vazio.
  SELECT * INTO r FROM public.scorecard_week_board('2026-07-05')
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a7';
  PERFORM pg_temp.expect('board por preencher state', r.state, 'por preencher');
  PERFORM pg_temp.expect('board por preencher rag',   r.overall_rag, NULL);

  -- LIDER_C submeteu e foi aprovada nos testes da CAPA.
  SELECT * INTO r FROM public.scorecard_week_board('2026-07-05')
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a3';
  PERFORM pg_temp.expect('board aprovada state',  r.state, 'aprovada');
  PERFORM pg_temp.expect('board aprovada rag',    r.overall_rag, 'Red');
  PERFORM pg_temp.expect('board aprovada capa',   r.capa_required::text, 'true');
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
