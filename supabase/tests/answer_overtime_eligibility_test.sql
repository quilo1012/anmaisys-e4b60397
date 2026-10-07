-- Tests for the eligibility guard inside answer_overtime (#1).
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after
-- 20261007090000_an_ask_checks_who_is_answering.sql has been applied. It opens a
-- transaction, creates its own throwaway employees and asks, calls the RPC the way a
-- phone calls it, asserts, and ROLLBACKs: nothing survives it. The last statement
-- prints 'ALL TESTS PASSED'; any failure raises and aborts before that line, naming
-- the case that failed.
--
-- WHY THIS FILE EXISTS AND THE VITEST ONE IS NOT ENOUGH. The repository can run no
-- SQL: `theAskChecksWhoIsAnswering.test.ts` reads the function's text and proves the
-- guard is written and is written before the insert. It cannot prove Postgres refuses
-- anybody, because nothing in CI has a database. This does, by being the thing that
-- the floor's phone does — `select answer_overtime(...)` with somebody's session.
--
-- Being that session is the one trick here: auth.uid() reads request.jwt.claims, so
-- setting that setting is enough to be a given person. No auth.users row is needed,
-- because my_employee_id() joins employees.user_id and stops there.
--
-- It must run as a role that bypasses RLS (the SQL Editor's postgres role does).
-- Every name below is a placeholder: no real employee appears here.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

-- Calls the RPC as the given person and reports whether it was refused.
CREATE FUNCTION pg_temp.refused(_user uuid, _request uuid, _answer text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user)::text, true);
  PERFORM public.answer_overtime(_request, _answer);
  RETURN false;
EXCEPTION WHEN others THEN
  RETURN true;
END $$;

DO $$
DECLARE
  u_day_prod   uuid := gen_random_uuid();   -- Day crew, Production
  u_night_prod uuid := gen_random_uuid();   -- Night crew, Production
  u_day_wh     uuid := gen_random_uuid();   -- Day crew, Warehouse
  e_day_prod   uuid;
  e_night_prod uuid;
  e_day_wh     uuid;
  ask_both     uuid;   -- narrowed to Production AND Day
  ask_open     uuid;   -- narrowed to nobody
  ask_cancelled uuid;
  n int;
BEGIN
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Test Day Production',   'Production', 'Day',   true, u_day_prod)
  RETURNING id INTO e_day_prod;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Test Night Production', 'Production', 'Night', true, u_night_prod)
  RETURNING id INTO e_night_prod;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Test Day Warehouse',    'Warehouse',  'Day',   true, u_day_wh)
  RETURNING id INTO e_day_wh;

  INSERT INTO public.overtime_requests
    (on_date, starts_at, ends_at, headcount, department, shift_group, status, created_by)
  VALUES (current_date + 1, '06:00', '14:00', 4, 'Production', 'Day', 'open', u_day_prod)
  RETURNING id INTO ask_both;

  INSERT INTO public.overtime_requests
    (on_date, starts_at, ends_at, headcount, department, shift_group, status, created_by)
  VALUES (current_date + 1, '06:00', '14:00', 4, NULL, NULL, 'open', u_day_prod)
  RETURNING id INTO ask_open;

  INSERT INTO public.overtime_requests
    (on_date, starts_at, ends_at, headcount, department, shift_group, status, created_by)
  VALUES (current_date + 1, '06:00', '14:00', 4, NULL, NULL, 'cancelled', u_day_prod)
  RETURNING id INTO ask_cancelled;

  -- The person the ask is for gets in.
  PERFORM pg_temp.expect_true('the matching employee may answer',
    NOT pg_temp.refused(u_day_prod, ask_both, 'yes'));

  -- The two narrowings, each on its own.
  PERFORM pg_temp.expect_true('another shift group is refused',
    pg_temp.refused(u_night_prod, ask_both, 'yes'));
  PERFORM pg_temp.expect_true('another department is refused',
    pg_temp.refused(u_day_wh, ask_both, 'yes'));

  -- A refusal must leave nothing behind: the guard runs before the write.
  SELECT count(*) INTO n FROM public.overtime_responses
   WHERE request_id = ask_both AND employee_id IN (e_night_prod, e_day_wh);
  PERFORM pg_temp.expect_true('a refused answer writes no row', n = 0);

  -- An ask nobody was named on reaches everybody — and more than one of them.
  PERFORM pg_temp.expect_true('an unnarrowed ask takes the night crew',
    NOT pg_temp.refused(u_night_prod, ask_open, 'yes'));
  PERFORM pg_temp.expect_true('an unnarrowed ask takes the warehouse too',
    NOT pg_temp.refused(u_day_wh, ask_open, 'yes'));

  -- Scenario C, at the row level: one ask, several people, nobody overwritten.
  SELECT count(*) INTO n FROM public.overtime_responses WHERE request_id = ask_open;
  PERFORM pg_temp.expect_true('several employees answer the same ask', n = 2);

  -- An ask that is no longer open takes nobody, however eligible they are.
  PERFORM pg_temp.expect_true('a cancelled ask is refused',
    pg_temp.refused(u_day_prod, ask_cancelled, 'yes'));

  -- Changing your own mind is not a second row.
  PERFORM pg_temp.expect_true('answering twice is still one row',
    NOT pg_temp.refused(u_day_prod, ask_both, 'no'));
  SELECT count(*) INTO n FROM public.overtime_responses
   WHERE request_id = ask_both AND employee_id = e_day_prod;
  PERFORM pg_temp.expect_true('the second answer replaced the first', n = 1);
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
