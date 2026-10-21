-- Tests for 20261021190000_an_ask_can_skip_a_crew.sql (BLOCO 116).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 116. One transaction,
-- throwaway people and asks, ROLLBACK at the end; the last statement prints
-- 'ALL TESTS PASSED' and any failure raises first, naming the case.
--
--   1. An ask that skips the Night crew: the bell does not target Night people, targets the rest.
--   2. A Night person cannot answer it (yes or no); a Day person can; a supervisor can still
--      add a desk yes for the Night person.
--   3. An ask that skips nobody (the default) takes a Night answer, exactly as before.
--   4. Skipping two crews, and a person with no crew set is never skipped.
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
  -- A Wednesday, at least nine days ahead: no weekend rota, no board rows near it.
  d date := current_date + 9 + (((3 - extract(isodow from current_date + 9)::int) + 7) % 7);
  u_day uuid := gen_random_uuid(); u_night uuid := gen_random_uuid();
  u_wk uuid := gen_random_uuid();  u_none uuid := gen_random_uuid();
  e_day uuid; e_night uuid; e_wk uuid; e_none uuid;
  a_skip_night uuid; a_all uuid; a_skip_two uuid;
  targets uuid[]; all_t uuid[]; msg text;
BEGIN
  SELECT id INTO v_creator FROM auth.users LIMIT 1;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'No auth.users row exists to own the test ask'; END IF;
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-crew-' || left(u::text, 8) || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_day, u_night, u_wk, u_none]) u;
  DELETE FROM public.user_roles WHERE user_id IN (u_day, u_night, u_wk, u_none);
  INSERT INTO public.user_roles (user_id, role) SELECT u, 'employee' FROM unnest(ARRAY[u_day, u_night, u_wk, u_none]) u;

  INSERT INTO public.employees (full_name, employee_ref, active, user_id, shift_group) VALUES ('ZZ Crew Day', 'ZZ9301', true, u_day, 'Day') RETURNING id INTO e_day;
  INSERT INTO public.employees (full_name, employee_ref, active, user_id, shift_group) VALUES ('ZZ Crew Night', 'ZZ9302', true, u_night, 'Night') RETURNING id INTO e_night;
  INSERT INTO public.employees (full_name, employee_ref, active, user_id, shift_group) VALUES ('ZZ Crew Weekend', 'ZZ9303', true, u_wk, 'Weekend') RETURNING id INTO e_wk;
  INSERT INTO public.employees (full_name, employee_ref, active, user_id, shift_group) VALUES ('ZZ Crew None', 'ZZ9304', true, u_none, NULL) RETURNING id INTO e_none;

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by, excluded_shift_groups)
  VALUES (d, '06:00', '18:00', NULL, v_creator, ARRAY['Night']) RETURNING id INTO a_skip_night;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (d, '06:00', '18:00', NULL, v_creator) RETURNING id INTO a_all;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by, excluded_shift_groups)
  VALUES (d, '06:00', '18:00', NULL, v_creator, ARRAY['Night', 'Weekend']) RETURNING id INTO a_skip_two;

  -- The same ask without any skip is the yardstick: what the rota and the rules already
  -- let through. Skipping a crew must remove exactly that crew from it, and nobody else.
  SELECT coalesce(array_agg(t.employee_id), '{}') INTO all_t FROM public.overtime_notify_targets(a_all) t;
  PERFORM pg_temp.ok('0 the yardstick reaches somebody', cardinality(all_t) > 0);

  -- 1. The bell
  SELECT coalesce(array_agg(t.employee_id), '{}') INTO targets FROM public.overtime_notify_targets(a_skip_night) t;
  PERFORM pg_temp.ok('1a the skipped crew is not told', NOT (e_night = ANY (targets)));
  PERFORM pg_temp.ok('1b nobody else is dropped',
    (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(all_t) x WHERE x <> e_night)
    = (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(targets) x));
  PERFORM pg_temp.ok('1c a person with no crew set is never skipped', (e_none = ANY (all_t)) = (e_none = ANY (targets)));

  -- 2. Answering
  msg := pg_temp.refusal(u_night, a_skip_night, 'yes');
  PERFORM pg_temp.ok('2a a Night person cannot say yes (' || coalesce(msg, 'accepted') || ')', msg LIKE 'This overtime is not being asked of the Night crew%');
  msg := pg_temp.refusal(u_night, a_skip_night, 'no');
  PERFORM pg_temp.ok('2b ... nor no', msg LIKE 'This overtime is not being asked of the Night crew%');
  msg := pg_temp.refusal(u_day, a_skip_night, 'no');
  PERFORM pg_temp.ok('2c a Day person can answer (' || coalesce(msg, 'accepted') || ')', msg IS NULL);

  -- A supervisor adding a yes given at the desk can still put a skipped crew's person on it.
  PERFORM pg_temp.as_user(v_creator);
  INSERT INTO public.overtime_responses (request_id, employee_id, answer) VALUES (a_skip_night, e_night, 'yes');
  PERFORM pg_temp.ok('2d a desk yes for a skipped crew is still possible', EXISTS (
    SELECT 1 FROM public.overtime_responses WHERE request_id = a_skip_night AND employee_id = e_night));

  -- 3. Nobody skipped: the Night person can answer, as before
  msg := pg_temp.refusal(u_night, a_all, 'no');
  PERFORM pg_temp.ok('3 an ask that skips nobody takes a Night answer (' || coalesce(msg, 'accepted') || ')', msg IS NULL);

  -- 4. Two crews skipped
  SELECT coalesce(array_agg(t.employee_id), '{}') INTO targets FROM public.overtime_notify_targets(a_skip_two) t;
  PERFORM pg_temp.ok('4 two crews skipped, nobody else dropped',
    NOT (e_night = ANY (targets)) AND NOT (e_wk = ANY (targets))
    AND (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(all_t) x WHERE x NOT IN (e_night, e_wk))
      = (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(targets) x));
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
