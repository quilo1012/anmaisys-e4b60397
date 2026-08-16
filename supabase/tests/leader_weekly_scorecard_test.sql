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

-- ==============================================================
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

-- ==============================================================END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
