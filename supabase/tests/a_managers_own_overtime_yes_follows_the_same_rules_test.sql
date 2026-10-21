-- Tests for 20261021210000_a_managers_own_overtime_yes_follows_the_same_rules.sql (BLOCO 118).
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after BLOCO 112 and 117 have been
-- applied. One transaction, throwaway people and asks, ROLLBACK at the end; the last statement
-- prints 'ALL TESTS PASSED' and any failure raises first, naming the case.
--
-- The report: two asks on the same day (06:00-18:00 and 06:00-14:00) and the person could
-- say yes to both. A manager who is also an employee skipped the schedule guard.

BEGIN;

CREATE FUNCTION pg_temp.ok(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user)::text, true);
END $$;

CREATE FUNCTION pg_temp.refusal(_user uuid, _request uuid, _answer text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_user);
  PERFORM public.answer_overtime(_request, _answer);
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN SQLERRM;
END $$;

DO $$
DECLARE
  v_creator uuid;
  sat date := current_date + (((6 - extract(isodow from current_date)::int) + 7) % 7) + 7;
  u_emp uuid := gen_random_uuid();  e_emp uuid;
  u_adm uuid := gen_random_uuid();  e_adm uuid;
  u_oth uuid := gen_random_uuid();  e_oth uuid;
  u_dec uuid := gen_random_uuid();  e_dec uuid;
  ask_long uuid; ask_short uuid;
  msg text;
BEGIN
  SELECT id INTO v_creator FROM auth.users LIMIT 1;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'No auth.users row exists to own the test ask'; END IF;

  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_emp, u_adm, u_oth, u_dec]) u;
  INSERT INTO public.user_roles (user_id, role) VALUES (u_emp, 'employee'), (u_adm, 'admin'), (u_oth, 'employee'), (u_dec, 'employee');

  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id) VALUES ('ZZ One Plain', 'Day', NULL, true, u_emp) RETURNING id INTO e_emp;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id) VALUES ('ZZ One Admin', 'Day', NULL, true, u_adm) RETURNING id INTO e_adm;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id) VALUES ('ZZ One Other', 'Day', NULL, true, u_oth) RETURNING id INTO e_oth;

  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id) VALUES ('ZZ One Declined', 'Day', NULL, true, u_dec) RETURNING id INTO e_dec;

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '06:00', '18:00', 5, 'open', v_creator) RETURNING id INTO ask_long;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '06:00', '14:00', 5, 'open', v_creator) RETURNING id INTO ask_short;

  -- 1. An ordinary employee: the second yes the same day is refused.
  PERFORM pg_temp.ok('1a first yes is accepted', pg_temp.refusal(u_emp, ask_long, 'yes') IS NULL);
  msg := pg_temp.refusal(u_emp, ask_short, 'yes');
  PERFORM pg_temp.ok('1b a second yes the same day is refused (got: ' || coalesce(msg,'NULL') || ')', msg LIKE '%already yours%');

  -- 2. A manager answering for themselves: the same rule.
  PERFORM pg_temp.ok('2a manager first yes is accepted', pg_temp.refusal(u_adm, ask_long, 'yes') IS NULL);
  msg := pg_temp.refusal(u_adm, ask_short, 'yes');
  PERFORM pg_temp.ok('2b manager second yes the same day is refused', msg LIKE '%already yours%');

  -- 3. A manager writing somebody else's yes at the desk is still allowed.
  PERFORM pg_temp.ok('3a the other person has the long ask', pg_temp.refusal(u_oth, ask_long, 'yes') IS NULL);
  PERFORM pg_temp.as_user(u_adm);
  INSERT INTO public.overtime_responses (request_id, employee_id, answer) VALUES (ask_short, e_oth, 'yes');
  PERFORM pg_temp.ok('3b a desk yes for another person goes through', EXISTS (
    SELECT 1 FROM public.overtime_responses WHERE request_id = ask_short AND employee_id = e_oth));

  -- 4. A yes the supervisor declined does not hold the slot: the person can pick the other ask.
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision) VALUES (ask_long, e_dec, 'yes', 'declined');
  PERFORM pg_temp.ok('4a a declined yes does not block the other ask', pg_temp.refusal(u_dec, ask_short, 'yes') IS NULL);

  -- 5. A yes left on the reserve list still holds the slot.
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision) VALUES (ask_long, e_oth, 'yes', 'reserve')
    ON CONFLICT (request_id, employee_id) DO UPDATE SET decision = 'reserve';
  DELETE FROM public.overtime_responses WHERE request_id = ask_short AND employee_id = e_oth;
  msg := pg_temp.refusal(u_oth, ask_short, 'yes');
  PERFORM pg_temp.ok('5a a reserve yes holds the slot (got: ' || coalesce(msg, 'NULL') || ')', msg LIKE '%already yours%');
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
