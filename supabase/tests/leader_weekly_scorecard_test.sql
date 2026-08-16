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
-- This file also seeds its own weeks (below), and those weeks widen the spine the same
-- way: every assertion here is written against the rows this file itself produced, not
-- against an assumed-empty table.

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

-- ==============================================================
-- Fixtures. Placeholder names only.
--
-- Four leaders, each carrying the case(s) that need it apart from the others:
--   LIDER_A — assigned to a line, zero weeks ever recorded.       (case 1)
--   LIDER_B — one week recorded, but no H&S field filled in it.   (case 2)
--   LIDER_C — one line, seven weeks, one case per week.           (cases 3-6, 8, 9)
--   LIDER_D — two lines, one assignment ending mid-quarter,
--             the other starting where it left off.               (case 7)
-- ==============================================================

INSERT INTO public.lines (id, name) VALUES
  ('11111111-1111-1111-1111-1111111111a1', 'LINHA_A'),
  ('11111111-1111-1111-1111-1111111111b1', 'LINHA_B'),
  ('11111111-1111-1111-1111-1111111111c1', 'LINHA_C'),
  ('11111111-1111-1111-1111-1111111111d1', 'LINHA_D1'),
  ('11111111-1111-1111-1111-1111111111d2', 'LINHA_D2');

INSERT INTO public.line_leaders (id, name, shift) VALUES
  ('22222222-2222-2222-2222-2222222222a1', 'LIDER_A', 'DAY'),
  ('22222222-2222-2222-2222-2222222222b1', 'LIDER_B', 'DAY'),
  ('22222222-2222-2222-2222-2222222222c1', 'LIDER_C', 'DAY'),
  ('22222222-2222-2222-2222-2222222222d1', 'LIDER_D', 'DAY');

INSERT INTO public.leader_line_assignment (leader_id, line_id, valid_from, valid_to) VALUES
  ('22222222-2222-2222-2222-2222222222a1', '11111111-1111-1111-1111-1111111111a1', DATE '2026-07-01', NULL),
  ('22222222-2222-2222-2222-2222222222b1', '11111111-1111-1111-1111-1111111111b1', DATE '2026-07-01', NULL),
  ('22222222-2222-2222-2222-2222222222c1', '11111111-1111-1111-1111-1111111111c1', DATE '2026-07-01', NULL),
  -- LIDER_D covers LINHA_D1 through the middle of July, then LINHA_D2 for the rest of
  -- the quarter. Non-overlapping in time, so no exclusion constraint fires.
  ('22222222-2222-2222-2222-2222222222d1', '11111111-1111-1111-1111-1111111111d1', DATE '2026-07-01', DATE '2026-07-15'),
  ('22222222-2222-2222-2222-2222222222d1', '11111111-1111-1111-1111-1111111111d2', DATE '2026-07-16', NULL);

-- LIDER_A gets no row in leader_weekly_scorecard at all — that absence is the point of
-- case 1: an assignment with zero weeks still has to produce a rollup row.

-- LIDER_B — one week, quality perfect, and every H&S field left NULL.
INSERT INTO public.leader_weekly_scorecard (
  leader_id, line_id, week_ending,
  planned_volume, actual_volume, unplanned_downtime_minutes, downtime_reason,
  ccp_check_status, starter_check_status, volume_weight_check_status,
  lost_time_injuries, reportable_accidents, first_aid_cases, near_misses_reported,
  safety_observations_done, toolbox_talks_done, ppe_compliance_pct,
  hs_training_compliance_pct, overdue_hs_actions,
  root_cause, corrective_action, capa_owner, capa_due_date)
VALUES
  ('22222222-2222-2222-2222-2222222222b1', '11111111-1111-1111-1111-1111111111b1', DATE '2026-07-05',
   1000, 1000, NULL, NULL, 'Pass', 'Pass', 'Pass',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

-- LIDER_C — one case per week, all on the same line.
INSERT INTO public.leader_weekly_scorecard (
  leader_id, line_id, week_ending,
  planned_volume, actual_volume, unplanned_downtime_minutes, downtime_reason,
  ccp_check_status, starter_check_status, volume_weight_check_status,
  lost_time_injuries, reportable_accidents, first_aid_cases, near_misses_reported,
  safety_observations_done, toolbox_talks_done, ppe_compliance_pct,
  hs_training_compliance_pct, overdue_hs_actions,
  root_cause, corrective_action, capa_owner, capa_due_date)
VALUES
  -- W0 — volume no plano, qualidade toda Pass, H&S completamente por preencher.
  -- hs_rag fica NULL (nunca Amber/Green sem dados) e o overall NAO fica bloqueado por
  -- isso: cai para a regra de volume/qualidade. (caso 9)
  ('22222222-2222-2222-2222-2222222222c1', '11111111-1111-1111-1111-1111111111c1', DATE '2026-07-05',
   1000, 1000, NULL, NULL, 'Pass', 'Pass', 'Pass',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),

  -- W1 — H&S recolhido, mas ZERO near-misses reportados. A regra invertida: reportar e
  -- o comportamento desejado, zero e sub-reporte, nao uma linha segura. (caso 3)
  ('22222222-2222-2222-2222-2222222222c1', '11111111-1111-1111-1111-1111111111c1', DATE '2026-07-12',
   1000, 1000, NULL, NULL, 'Pass', 'Pass', 'Pass',
   0, 0, 0, 0, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL),

  -- W2 — 108% do plano. Superproducao e desperdicio, entao Amber, nao Green. (caso 4)
  ('22222222-2222-2222-2222-2222222222c1', '11111111-1111-1111-1111-1111111111c1', DATE '2026-07-19',
   1000, 1080, NULL, NULL, 'Pass', 'Pass', 'Pass',
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL),

  -- W3 — um check "Fail": desvio de produto, CAPA obrigatoria. (caso 5, metade Fail)
  ('22222222-2222-2222-2222-2222222222c1', '11111111-1111-1111-1111-1111111111c1', DATE '2026-07-26',
   1000, 1000, NULL, NULL, 'Fail', 'Pass', 'Pass',
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0,
   'causa', 'accao', 'DONO_PLACEHOLDER', DATE '2026-08-31'),

  -- W4 — o mesmo check "Not Done": falha de disciplina, mesmo RAG Vermelho, mas sem
  -- CAPA obrigatoria. (caso 5, metade Not Done)
  ('22222222-2222-2222-2222-2222222222c1', '11111111-1111-1111-1111-1111111111c1', DATE '2026-08-02',
   1000, 1000, NULL, NULL, 'Not Done', 'Pass', 'Pass',
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL),

  -- W5 — acidente com afastamento, com volume perfeito e qualidade Green. O gate de
  -- H&S e absoluto: nada disto compra de volta o overall. (caso 6)
  ('22222222-2222-2222-2222-2222222222c1', '11111111-1111-1111-1111-1111111111c1', DATE '2026-08-09',
   1000, 1000, NULL, NULL, 'Pass', 'Pass', 'Pass',
   1, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL),

  -- W6 — downtime nao planeado. O RAG oficial le o volume_pct BRUTO; o ajustado e so
  -- informativo, e sobe porque o tempo produtivo disponivel encolheu. (caso 8)
  ('22222222-2222-2222-2222-2222222222c1', '11111111-1111-1111-1111-1111111111c1', DATE '2026-08-16',
   1000, 900, 400, 'Quebra', 'Pass', 'Pass', 'Pass',
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL);

-- LIDER_D — a mesma semana-tipo (volume no plano, qualidade e H&S Green), uma vez em
-- cada linha, dos dois lados da troca. (caso 7)
INSERT INTO public.leader_weekly_scorecard (
  leader_id, line_id, week_ending,
  planned_volume, actual_volume, unplanned_downtime_minutes, downtime_reason,
  ccp_check_status, starter_check_status, volume_weight_check_status,
  lost_time_injuries, reportable_accidents, first_aid_cases, near_misses_reported,
  safety_observations_done, toolbox_talks_done, ppe_compliance_pct,
  hs_training_compliance_pct, overdue_hs_actions,
  root_cause, corrective_action, capa_owner, capa_due_date)
VALUES
  ('22222222-2222-2222-2222-2222222222d1', '11111111-1111-1111-1111-1111111111d1', DATE '2026-07-05',
   1000, 1000, NULL, NULL, 'Pass', 'Pass', 'Pass',
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL),
  ('22222222-2222-2222-2222-2222222222d1', '11111111-1111-1111-1111-1111111111d2', DATE '2026-08-02',
   1000, 1000, NULL, NULL, 'Pass', 'Pass', 'Pass',
   0, 0, 0, 1, 2, 1, 1.0000, 1.0000, 0, NULL, NULL, NULL, NULL);

-- ==============================================================
-- Caso 1 — grupo com atribuicao e ZERO semanas registadas.
-- Sem isto, um GROUP BY sobre a view semanal nao produziria linha nenhuma, e o "nada
-- foi preenchido" desapareceria em vez de aparecer como 'Sem dados'.
-- ==============================================================
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.v_scorecard_rollup_leader
   WHERE leader_id = '22222222-2222-2222-2222-2222222222a1'
     AND period_type = 'mensal' AND period_start = '2026-07-01';
  IF r IS NULL THEN
    RAISE EXCEPTION 'FAILED caso 1 — o grupo sem semanas nem sequer produziu linha';
  END IF;
  PERFORM pg_temp.expect('caso 1 weeks_recorded', r.weeks_recorded::text, '0');
  PERFORM pg_temp.expect('caso 1 quality_rag',    r.quality_rag,  'Sem dados');
  PERFORM pg_temp.expect('caso 1 hs_rag',         r.hs_rag,       'Sem dados');
  PERFORM pg_temp.expect('caso 1 overall_rag',    r.overall_rag,  NULL);
  -- Uma taxa sobre nada nao e uma taxa de zero.
  PERFORM pg_temp.expect('caso 1 near_misses_per_week', r.near_misses_per_week::text, NULL);
END $$;

-- ==============================================================
-- Caso 2 — grupo com semanas mas sem NENHUM dado de H&S nelas.
-- Sem este guard, near_misses_per_week = 0 dispararia a regra de sub-reporte e o grupo
-- que ninguem preencheu apareceria meramente Amber.
-- ==============================================================
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.v_scorecard_rollup_leader
   WHERE leader_id = '22222222-2222-2222-2222-2222222222b1'
     AND period_type = 'mensal' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('caso 2 weeks_recorded', r.weeks_recorded::text, '1');
  PERFORM pg_temp.expect('caso 2 quality_rag',    r.quality_rag, 'Green');
  PERFORM pg_temp.expect('caso 2 hs_rag',         r.hs_rag,      'Sem dados');
  -- H&S 'Sem dados' nao bloqueia o overall: cai para volume/qualidade.
  PERFORM pg_temp.expect('caso 2 overall_rag',    r.overall_rag, 'Green');
END $$;

-- ==============================================================
-- Casos 3, 4, 5, 6, 8, 9 — semana a semana, sobre a view base de LIDER_C.
-- ==============================================================
DO $$
DECLARE r record;
BEGIN
  -- CASO 9 — H&S nao informado em nada. hs_rag fica NULO (nunca Green, nunca Amber) e
  -- o overall nao e bloqueado por isso: cai para a regra de volume/qualidade, e por
  -- isso e igual ao volume_rag desta semana — comparacao contra o proprio resultado,
  -- nao contra uma banda escrita a mao aqui.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222c1' AND week_ending = '2026-07-05';
  PERFORM pg_temp.expect('caso 9 hs_rag', r.hs_rag, NULL);
  PERFORM pg_temp.expect('caso 9 quality_rag', r.quality_rag, 'Green');
  PERFORM pg_temp.expect('caso 9 overall_rag cai para o volume', r.overall_rag, r.volume_rag);

  -- CASO 3 — zero near-misses reportados numa semana em que o H&S FOI recolhido.
  -- Amber, e o driver nomeia o sub-reporte em vez de ficar mudo.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222c1' AND week_ending = '2026-07-12';
  PERFORM pg_temp.expect('caso 3 hs_rag', r.hs_rag, 'Amber');
  PERFORM pg_temp.expect_true('caso 3 hs_driver nomeia o sub-reporte',
                               r.hs_driver::text LIKE '%sub-reporte%');

  -- CASO 4 — 108% do plano. Superproducao: Amber, nao Green.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222c1' AND week_ending = '2026-07-19';
  PERFORM pg_temp.expect('caso 4 volume_rag', r.volume_rag, 'Amber');

  -- CASO 5 — "Fail" faz a linha de CAPA obrigatoria; "Not Done" nao, mas ambos ficam
  -- Vermelhos por igual. Sao o mesmo RAG e um evento diferente.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222c1' AND week_ending = '2026-07-26';
  PERFORM pg_temp.expect('caso 5 (Fail) quality_rag',       r.quality_rag,       'Red');
  PERFORM pg_temp.expect('caso 5 (Fail) quality_fail_type', r.quality_fail_type, 'Fail');
  PERFORM pg_temp.expect('caso 5 (Fail) capa_required',     r.capa_required::text, 'true');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222c1' AND week_ending = '2026-08-02';
  PERFORM pg_temp.expect('caso 5 (Not Done) quality_rag',       r.quality_rag,       'Red');
  PERFORM pg_temp.expect('caso 5 (Not Done) quality_fail_type', r.quality_fail_type, 'Not Done');
  PERFORM pg_temp.expect('caso 5 (Not Done) capa_required',     r.capa_required::text, 'false');

  -- CASO 6 — LTI = 1, volume 100%, qualidade Green. O gate de H&S e um teto absoluto:
  -- nem volume nem qualidade perfeitos compram o overall de volta.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222c1' AND week_ending = '2026-08-09';
  PERFORM pg_temp.expect('caso 6 volume_rag',  r.volume_rag,  'Green');
  PERFORM pg_temp.expect('caso 6 quality_rag', r.quality_rag, 'Green');
  PERFORM pg_temp.expect('caso 6 overall_rag', r.overall_rag, 'Red');

  -- CASO 8 — downtime nao planeado. O RAG oficial le o volume_pct BRUTO, que e so
  -- actual/planned e nao muda com o downtime; o ajustado e informativo e sobe, porque o
  -- tempo produtivo disponivel encolheu.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard
   WHERE leader_id = '22222222-2222-2222-2222-2222222222c1' AND week_ending = '2026-08-16';
  PERFORM pg_temp.expect_true('caso 8 volume_pct inalterado', round(r.volume_pct, 4) = 0.9000);
  PERFORM pg_temp.expect_true('caso 8 volume_pct_adjusted maior', r.volume_pct_adjusted > r.volume_pct);
END $$;

-- ==============================================================
-- Caso 7 — lider que troca de linha a meio do trimestre. Aparece sob as duas linhas,
-- cada uma com as semanas que lhe cairam, e a agregacao bate nos rollups A, B e C.
-- ==============================================================
DO $$
DECLARE r record;
BEGIN
  -- Rollup C: uma linha de cada lado da troca, cada uma com UMA semana.
  SELECT * INTO r FROM public.v_scorecard_rollup_leader_line
   WHERE leader_id = '22222222-2222-2222-2222-2222222222d1'
     AND line_id   = '11111111-1111-1111-1111-1111111111d1'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('caso 7 rollup C, LINHA_D1 weeks_recorded', r.weeks_recorded::text, '1');

  SELECT * INTO r FROM public.v_scorecard_rollup_leader_line
   WHERE leader_id = '22222222-2222-2222-2222-2222222222d1'
     AND line_id   = '11111111-1111-1111-1111-1111111111d2'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('caso 7 rollup C, LINHA_D2 weeks_recorded', r.weeks_recorded::text, '1');

  -- Rollup A: o lider e um so, e as suas duas semanas somam-se, nas duas linhas juntas.
  SELECT * INTO r FROM public.v_scorecard_rollup_leader
   WHERE leader_id = '22222222-2222-2222-2222-2222222222d1'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('caso 7 rollup A weeks_recorded', r.weeks_recorded::text, '2');
  PERFORM pg_temp.expect('caso 7 rollup A overall_rag',    r.overall_rag, 'Green');

  -- Rollup B: cada linha continua a ver apenas a semana que de facto lhe caiu.
  SELECT * INTO r FROM public.v_scorecard_rollup_line
   WHERE line_id = '11111111-1111-1111-1111-1111111111d1'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('caso 7 rollup B, LINHA_D1 weeks_recorded', r.weeks_recorded::text, '1');

  SELECT * INTO r FROM public.v_scorecard_rollup_line
   WHERE line_id = '11111111-1111-1111-1111-1111111111d2'
     AND period_type = 'trimestral' AND period_start = '2026-07-01';
  PERFORM pg_temp.expect('caso 7 rollup B, LINHA_D2 weeks_recorded', r.weeks_recorded::text, '1');
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
