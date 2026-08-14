-- Tests for the weekly Line Leader scorecard.
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after the migration
-- 20260814090000_the_week_is_red_when_the_check_is_missed.sql has been applied.
-- It opens a transaction, writes throwaway rows, asserts, and ROLLBACKs: nothing
-- survives it. The last statement prints 'ALL TESTS PASSED'; any failure raises and
-- aborts before that line, naming the case that failed.
--
-- It must run as a role that bypasses RLS (the SQL Editor's postgres role does).
-- Leader names are placeholders: no real leader appears here.

BEGIN;

CREATE FUNCTION pg_temp.expect(_case text, _got text, _want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'FAILED %  — expected [%], got [%]',
      _case, COALESCE(_want, '<NULL>'), COALESCE(_got, '<NULL>');
  END IF;
END $$;

-- =====================================================================
-- Weekly rows, one leader per case so no case can disturb another.
-- =====================================================================
INSERT INTO public.leader_weekly_scorecard
  (line_leader, week_ending, planned_volume, actual_volume,
   ccp_check_completed, starter_check_completed, volume_weight_check_completed,
   leader_attendance_pct, team_attendance_pct, training_compliance_pct,
   leader_lateness_incidents, team_lateness_incidents, hs_near_misses_reported)
VALUES
  -- volume bands (cases 1-6)
  ('LIDER_A', '2026-07-05', 1000, 1000, 'Y','Y','Y', 1.0, 1.0, 1.0, 0,0,0),
  ('LIDER_B', '2026-07-05', 1000, 1050, 'Y','Y','Y', 1.0, 1.0, 1.0, 0,0,0),
  ('LIDER_C', '2026-07-05', 1000,  999, 'Y','Y','Y', 1.0, 1.0, 1.0, 0,0,0),
  ('LIDER_D', '2026-07-05', 1000,  970, 'Y','Y','Y', 1.0, 1.0, 1.0, 0,0,0),
  ('LIDER_E', '2026-07-05', 1000,  969, 'Y','Y','Y', 1.0, 1.0, 1.0, 0,0,0),
  ('LIDER_F', '2026-07-05', NULL,  900, 'Y','Y','Y', 1.0, 1.0, 1.0, 0,0,0),
  -- quality (cases 8-13)
  ('LIDER_G', '2026-07-05', 1000, 1000, 'Y','N','Y', 1.0, 1.0, 1.0, 0,0,0),
  ('LIDER_H', '2026-07-05', 1000, 1000, 'N','N','N', 1.0, 1.0, 1.0, 0,0,0),
  ('LIDER_I', '2026-07-05', 1000, 1000, NULL,NULL,NULL, 1.0, 1.0, 1.0, 0,0,0),
  ('LIDER_J', '2026-07-05', 1000, 1000, 'Y',NULL,NULL, 1.0, 1.0, 1.0, 0,0,0),
  ('LIDER_K', '2026-07-05', 1000, 1200, 'Y','N','Y', 1.0, 1.0, 1.0, 0,0,0),
  -- attendance and training (cases 14-22)
  ('LIDER_L', '2026-07-05', 1000, 1000, 'Y','Y','Y', 0.9990, 0.9960, 1.0, 0,0,0),
  ('LIDER_M', '2026-07-05', 1000, 1000, 'Y','Y','Y', 0.9950, 0.9950, 1.0, 0,0,0),
  ('LIDER_N', '2026-07-05', 1000, 1000, 'Y','Y','Y', 1.0000, 0.9940, 1.0, 0,0,0),
  ('LIDER_O', '2026-07-05', 1000, 1000, 'Y','Y','Y', NULL,   NULL,   1.0, 0,0,0),
  ('LIDER_P', '2026-07-05', 1000, 1000, 'Y','Y','Y', 0.9900, NULL,   1.0, 0,0,0),
  ('LIDER_Q', '2026-07-05', 1000, 1000, 'Y','Y','Y', 1.0, 1.0, NULL,  0,0,0),
  ('LIDER_R', '2026-07-05', 1000, 1000, 'Y','Y','Y', 1.0, 1.0, 0.0,   0,0,0),
  ('LIDER_S', '2026-07-05', 1000,  950, 'Y','N','Y', NULL, NULL, NULL, 0,0,0);

-- =====================================================================
-- 1-6  volume
-- =====================================================================
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_A';
  PERFORM pg_temp.expect('1 volume at plan / pct',  round(r.volume_pct,4)::text, '1.0000');
  PERFORM pg_temp.expect('1 volume at plan / rag',  r.volume_rag, 'Green');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_B';
  PERFORM pg_temp.expect('2 volume above plan',     r.volume_rag, 'Green');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_C';
  PERFORM pg_temp.expect('3 amber upper edge',      r.volume_rag, 'Amber');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_D';
  PERFORM pg_temp.expect('4 amber lower edge (inclusive)', r.volume_rag, 'Amber');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_E';
  PERFORM pg_temp.expect('5 red edge',              r.volume_rag, 'Red');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_F';
  PERFORM pg_temp.expect('6 plan missing / pct',    r.volume_pct::text,  NULL);
  PERFORM pg_temp.expect('6 plan missing / rag',    r.volume_rag,        NULL);
  PERFORM pg_temp.expect('6 plan missing / overall',r.overall_rag,       NULL);
END $$;

-- 7  plan = 0 is refused
DO $$
DECLARE raised boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.leader_weekly_scorecard (line_leader, week_ending, planned_volume)
    VALUES ('LIDER_ZERO', '2026-07-05', 0);
  EXCEPTION WHEN check_violation THEN raised := true;
  END;
  PERFORM pg_temp.expect('7 planned_volume = 0 rejected', raised::text, 'true');
END $$;

-- =====================================================================
-- 8-13  quality, including the gate
-- =====================================================================
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_A';
  PERFORM pg_temp.expect('8 all checks Y',           r.quality_rag, 'Green');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_G';
  PERFORM pg_temp.expect('9 one check N / rag',      r.quality_rag, 'Red');
  PERFORM pg_temp.expect('9 one check N / driver',   r.rag_driver,  'Qualidade: Starter não concluído.');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_H';
  PERFORM pg_temp.expect('10 three checks N / driver',
    r.rag_driver, 'Qualidade: CCP, Starter, Vol&Peso não concluído.');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_I';
  PERFORM pg_temp.expect('11 checks all blank / quality', r.quality_rag, NULL);
  PERFORM pg_temp.expect('11 checks all blank / overall', r.overall_rag, NULL);

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_J';
  PERFORM pg_temp.expect('12 checks partly filled is not Green', r.quality_rag, NULL);

  -- The one that matters: volume 120% of plan, one check missed.
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_K';
  PERFORM pg_temp.expect('13 GATE / volume', r.volume_rag,  'Green');
  PERFORM pg_temp.expect('13 GATE / overall', r.overall_rag, 'Red');
END $$;

-- =====================================================================
-- 14-22  attendance, training, driver
-- =====================================================================
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_L';
  PERFORM pg_temp.expect('14 attendance ok',        r.attendance_status, 'Met');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_M';
  PERFORM pg_temp.expect('15 attendance on the line', r.attendance_status, 'Met');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_N';
  PERFORM pg_temp.expect('16 team below / status', r.attendance_status, 'Not Met');
  PERFORM pg_temp.expect('16 team below / driver', r.rag_driver, 'Assiduidade abaixo de 99,5%.');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_O';
  PERFORM pg_temp.expect('17 attendance blank / status',  r.attendance_status, NULL);
  PERFORM pg_temp.expect('17 attendance blank / flag',    r.missing_attendance_data::text, 'true');
  PERFORM pg_temp.expect('17 attendance blank / driver',  r.rag_driver, 'Dados de assiduidade ausentes.');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_P';
  PERFORM pg_temp.expect('18 one side blank, other fails', r.attendance_status, 'Not Met');
  PERFORM pg_temp.expect('18 one side blank is not missing data', r.missing_attendance_data::text, 'false');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_Q';
  PERFORM pg_temp.expect('19 training blank / flag',   r.missing_training_data::text, 'true');
  PERFORM pg_temp.expect('19 training blank / driver', r.rag_driver, 'Treinamento não informado.');

  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_R';
  PERFORM pg_temp.expect('20 training zero is not missing', r.missing_training_data::text, 'false');
  PERFORM pg_temp.expect('20 training zero / no driver',    r.rag_driver, NULL);

  -- 21 every clause at once, in the order the sheet writes them
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_S';
  PERFORM pg_temp.expect('21 composite driver', r.rag_driver,
    'Qualidade: Starter não concluído. Volume 95,0% do plano (>3% abaixo).'
    || ' Dados de assiduidade ausentes. Treinamento não informado.');

  -- 22 a clean week says nothing
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_A';
  PERFORM pg_temp.expect('22 clean week / driver',  r.rag_driver,  NULL);
  PERFORM pg_temp.expect('22 clean week / overall', r.overall_rag, 'Green');
END $$;

-- =====================================================================
-- 23-28  rollups, including the group with no weeks at all
-- =====================================================================
INSERT INTO public.leader_weekly_scorecard
  (line_leader, week_ending, planned_volume, actual_volume,
   ccp_check_completed, starter_check_completed, volume_weight_check_completed,
   team_lateness_incidents, hs_near_misses_reported)
VALUES
  -- 23/26  four weeks averaging 0.99 -> Amber, quality clean
  ('LIDER_AVG', '2026-07-05', 1000, 1000, 'Y','Y','Y', 1, 0),
  ('LIDER_AVG', '2026-07-12', 1000,  980, 'Y','Y','Y', 1, 0),
  ('LIDER_AVG', '2026-07-19', 1000,  960, 'Y','Y','Y', 1, 1),
  ('LIDER_AVG', '2026-07-26', 1000, 1020, 'Y','Y','Y', 1, 0),
  -- 25  strong volume, one quality failure
  ('LIDER_FAIL','2026-07-05', 1000, 1050, 'Y','Y','Y', 0, 0),
  ('LIDER_FAIL','2026-07-12', 1000, 1050, 'Y','Y','Y', 0, 0),
  ('LIDER_FAIL','2026-07-19', 1000, 1050, 'N','Y','Y', 0, 0),
  ('LIDER_FAIL','2026-07-26', 1000, 1050, 'Y','Y','Y', 0, 0),
  -- 27  three weeks with quality never recorded
  ('LIDER_BLNK','2026-07-05', 1000, 1000, NULL,NULL,NULL, 0, 0),
  ('LIDER_BLNK','2026-07-12', 1000, 1000, NULL,NULL,NULL, 0, 0),
  ('LIDER_BLNK','2026-07-19', 1000, 1000, NULL,NULL,NULL, 0, 0),
  -- 24  JUL only, while LIDER_AUG exists only in AUG
  ('LIDER_JUL', '2026-07-05', 1000, 1000, 'Y','Y','Y', 0, 0),
  ('LIDER_AUG', '2026-08-02', 1000, 1000, 'Y','Y','Y', 0, 0),
  -- 28  the quarter has to hold all three months
  ('LIDER_QTR', '2026-07-05', 1000, 1000, 'Y','Y','Y', 0, 0),
  ('LIDER_QTR', '2026-08-02', 1000, 1000, 'Y','Y','Y', 0, 0),
  ('LIDER_QTR', '2026-09-06', 1000, 1000, 'Y','Y','Y', 0, 0);

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.v_leader_scorecard_monthly
   WHERE line_leader='LIDER_AVG' AND month_start='2026-07-01';
  PERFORM pg_temp.expect('23 monthly avg / weeks',  r.weeks_recorded::text, '4');
  PERFORM pg_temp.expect('23 monthly avg / value',  round(r.avg_volume_pct,4)::text, '0.9900');
  PERFORM pg_temp.expect('23 monthly avg / band',   r.volume_rag, 'Amber');
  PERFORM pg_temp.expect('26 monthly clean quality', r.quality_rag, 'Green');
  PERFORM pg_temp.expect('23 monthly overall',      r.overall_rag, 'Amber');
  PERFORM pg_temp.expect('23 monthly sums',         r.total_team_lateness::text, '4');
  PERFORM pg_temp.expect('23 monthly near misses',  r.total_near_misses::text, '1');

  SELECT * INTO r FROM public.v_leader_scorecard_monthly
   WHERE line_leader='LIDER_FAIL' AND month_start='2026-07-01';
  PERFORM pg_temp.expect('25 rollup gate / fails',   r.weeks_with_quality_fail::text, '1');
  PERFORM pg_temp.expect('25 rollup gate / quality', r.quality_rag, 'Red');
  PERFORM pg_temp.expect('25 rollup gate / volume',  r.volume_rag,  'Green');
  PERFORM pg_temp.expect('25 rollup gate / overall', r.overall_rag, 'Red');

  SELECT * INTO r FROM public.v_leader_scorecard_monthly
   WHERE line_leader='LIDER_BLNK' AND month_start='2026-07-01';
  PERFORM pg_temp.expect('27 quality never recorded / rag',     r.quality_rag, 'Sem dados');
  PERFORM pg_temp.expect('27 quality never recorded / overall', r.overall_rag, NULL);

  -- 24  THE ONE THIS DESIGN EXISTS FOR: a group with no weeks at all.
  SELECT * INTO r FROM public.v_leader_scorecard_monthly
   WHERE line_leader='LIDER_JUL' AND month_start='2026-08-01';
  PERFORM pg_temp.expect('24 empty group / row exists', (r.line_leader IS NOT NULL)::text, 'true');
  PERFORM pg_temp.expect('24 empty group / weeks',      r.weeks_recorded::text, '0');
  PERFORM pg_temp.expect('24 empty group / fails',      r.weeks_with_quality_fail::text, '0');
  PERFORM pg_temp.expect('24 empty group / NOT Green',  r.quality_rag, 'Sem dados');
  PERFORM pg_temp.expect('24 empty group / overall',    r.overall_rag, NULL);

  -- 28  quarter spans the three months
  SELECT * INTO r FROM public.v_leader_scorecard_quarterly
   WHERE line_leader='LIDER_QTR' AND quarter_start='2026-07-01';
  PERFORM pg_temp.expect('28 quarter / label', r.quarter, 'Q3-2026');
  PERFORM pg_temp.expect('28 quarter / weeks', r.weeks_recorded::text, '3');

  -- 29  derived labels
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_JUL';
  PERFORM pg_temp.expect('29 month label',   r.month,   'Jul-2026');
  PERFORM pg_temp.expect('29 quarter label', r.quarter, 'Q3-2026');
END $$;

-- =====================================================================
-- 30  summary. Its own month, 2027-03, so nothing else lands in the period.
-- =====================================================================
INSERT INTO public.leader_weekly_scorecard
  (line_leader, week_ending, planned_volume, actual_volume,
   ccp_check_completed, starter_check_completed, volume_weight_check_completed,
   leader_attendance_pct, team_attendance_pct, training_compliance_pct,
   team_lateness_incidents, hs_near_misses_reported)
VALUES
  ('LIDER_T', '2027-03-07', 1000, 1000, 'Y','Y','Y', 1.0, 1.0, 1.0, 2, 1),
  ('LIDER_U', '2027-03-07', 1000,  900, 'Y','N','Y', 1.0, 1.0, 1.0, 3, 0),
  ('LIDER_V', '2027-03-07', 1000,  980, 'Y','Y','Y', NULL, NULL, NULL, NULL, NULL);

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.leader_scorecard_summary('2027-03-01','2027-03-31');
  PERFORM pg_temp.expect('summary / weeks',          r.weeks_recorded::text, '3');
  PERFORM pg_temp.expect('summary / green',          r.weeks_green::text, '1');
  PERFORM pg_temp.expect('summary / amber',          r.weeks_amber::text, '1');
  PERFORM pg_temp.expect('summary / red',            r.weeks_red::text, '1');
  PERFORM pg_temp.expect('summary / pct red',        round(r.pct_weeks_red,4)::text, '0.3333');
  PERFORM pg_temp.expect('summary / avg vs plan',    round(r.avg_volume_vs_plan,4)::text, '0.9600');
  PERFORM pg_temp.expect('summary / quality fails',  r.weeks_with_quality_fail::text, '1');
  PERFORM pg_temp.expect('summary / below 97',       r.weeks_volume_below_97pct::text, '1');
  PERFORM pg_temp.expect('summary / team lateness',  r.total_team_lateness::text, '5');
  PERFORM pg_temp.expect('summary / near misses',    r.total_near_misses::text, '1');
  PERFORM pg_temp.expect('summary / missing attend', r.rows_missing_attendance_data::text, '1');
  PERFORM pg_temp.expect('summary / missing train',  r.rows_missing_training_data::text, '1');

  -- 30  an empty period returns one row of zeros, and NULL where nothing divides
  SELECT * INTO r FROM public.leader_scorecard_summary('2020-01-01','2020-12-31');
  PERFORM pg_temp.expect('30 empty period / row',   (r.weeks_recorded IS NOT NULL)::text, 'true');
  PERFORM pg_temp.expect('30 empty period / weeks',  r.weeks_recorded::text, '0');
  PERFORM pg_temp.expect('30 empty period / pct',    r.pct_weeks_red::text, NULL);
END $$;

-- =====================================================================
-- per-leader view: worst_rag
-- =====================================================================
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.v_leader_scorecard_by_leader WHERE leader='LIDER_FAIL';
  PERFORM pg_temp.expect('by_leader / worst is Red',   r.worst_rag, 'Red');
  SELECT * INTO r FROM public.v_leader_scorecard_by_leader WHERE leader='LIDER_AVG';
  PERFORM pg_temp.expect('by_leader / worst is Amber', r.worst_rag, 'Amber');
  PERFORM pg_temp.expect('by_leader / weeks',          r.weeks::text, '4');
  SELECT * INTO r FROM public.v_leader_scorecard_by_leader WHERE leader='LIDER_BLNK';
  PERFORM pg_temp.expect('by_leader / nothing decided', r.worst_rag, 'Sem dados');
END $$;

-- =====================================================================
-- 31  the same leader and week twice, spelled differently
-- =====================================================================
DO $$
DECLARE raised boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.leader_weekly_scorecard (line_leader, week_ending)
    VALUES ('lider_a', '2026-07-05');
  EXCEPTION WHEN unique_violation THEN raised := true;
  END;
  PERFORM pg_temp.expect('31 duplicate leader/week, other casing, rejected', raised::text, 'true');
END $$;

-- =====================================================================
-- 32-33  thresholds
-- =====================================================================
DO $$
DECLARE r record; raised boolean := false;
BEGIN
  -- 32  LIDER_E was Red at 0.969; widening the amber band moves it, with no backfill
  UPDATE public.leader_scorecard_thresholds SET volume_amber_min = 0.9500 WHERE id;
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_E';
  PERFORM pg_temp.expect('32 threshold edit moves history', r.volume_rag, 'Amber');
  UPDATE public.leader_scorecard_thresholds SET volume_amber_min = 0.9700 WHERE id;
  SELECT * INTO r FROM public.v_leader_weekly_scorecard WHERE line_leader='LIDER_E';
  PERFORM pg_temp.expect('32 threshold restored', r.volume_rag, 'Red');

  -- 33  amber above green would leave the band inverted
  BEGIN
    UPDATE public.leader_scorecard_thresholds SET volume_amber_min = 1.1000 WHERE id;
  EXCEPTION WHEN check_violation THEN raised := true;
  END;
  PERFORM pg_temp.expect('33 inverted band rejected', raised::text, 'true');
END $$;

-- =====================================================================
-- 34-35  domain constraints
-- =====================================================================
DO $$
DECLARE raised boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.leader_weekly_scorecard (line_leader, week_ending, team_attendance_pct)
    VALUES ('LIDER_OOR', '2026-07-05', 1.2);
  EXCEPTION WHEN check_violation OR numeric_value_out_of_range THEN raised := true;
  END;
  PERFORM pg_temp.expect('34 attendance above 1 rejected', raised::text, 'true');

  raised := false;
  BEGIN
    INSERT INTO public.leader_weekly_scorecard (line_leader, week_ending, ccp_check_completed)
    VALUES ('LIDER_BADY', '2026-07-05', 'S');
  EXCEPTION WHEN check_violation THEN raised := true;
  END;
  PERFORM pg_temp.expect('35 check value other than Y/N rejected', raised::text, 'true');

  raised := false;
  BEGIN
    INSERT INTO public.leader_weekly_scorecard (line_leader, week_ending)
    VALUES ('   ', '2026-07-05');
  EXCEPTION WHEN check_violation THEN raised := true;
  END;
  PERFORM pg_temp.expect('35b blank leader name rejected', raised::text, 'true');
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
