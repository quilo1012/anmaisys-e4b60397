-- Tests for 20261021150000_overtime_keeps_a_rest_between_shifts.sql.
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after BLOCO 112 has been applied.
-- Same shape as overtime_schedule_clash_test.sql: one transaction, its own throwaway people,
-- rotas and asks, ROLLBACK at the end; the last statement prints 'ALL TESTS PASSED' and any
-- failure raises first, naming the case. Needs a role that bypasses RLS (the SQL Editor's).
--
-- The case from the report: a Day-crew person on 06:00–18:00 was offered the Night ask on
-- 18:00–06:00 the same day — 24 hours in a row, with no overlap to stop it.

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

-- Why this person may not take this ask, or null when they may.
CREATE FUNCTION pg_temp.why(_emp uuid, _ask uuid) RETURNS text
LANGUAGE sql AS $$ SELECT public.overtime_schedule_clash(_emp, _ask) $$;

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
  fri smallint := 5; sa smallint := 6;
  p_sat_day uuid;     -- Saturday only, 06:00–18:00           (the report: Rosana's shape)
  p_fri_night uuid;   -- Friday only, 18:00–06:00 (into Saturday)
  p_short uuid;       -- Saturday only, 06:00–14:00
  p_fri_day uuid;     -- Friday only, 06:00–18:00
  u_day uuid := gen_random_uuid();    e_day uuid;
  u_night uuid := gen_random_uuid();  e_night uuid;
  u_short uuid := gen_random_uuid();  e_short uuid;
  u_fri uuid := gen_random_uuid();    e_fri uuid;
  u_ot uuid := gen_random_uuid();     e_ot uuid;
  ask_night uuid; ask_day uuid; ask_after uuid; ask_long uuid;
  ask_prev uuid; ask_dawn13 uuid; ask_dawn14 uuid; ask_ot_a uuid; ask_ot_b uuid; ask_ot_c uuid;
  msg text; n int;
BEGIN
  SELECT id INTO v_creator FROM auth.users LIMIT 1;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'No auth.users row exists to own the test ask'; END IF;

  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_day, u_night, u_short, u_fri, u_ot]) u;

  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at) VALUES ('ZZ rest sat day', ARRAY[sa], '06:00', '18:00') RETURNING id INTO p_sat_day;
  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at) VALUES ('ZZ rest fri night', ARRAY[fri], '18:00', '06:00') RETURNING id INTO p_fri_night;
  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at) VALUES ('ZZ rest sat short', ARRAY[sa], '06:00', '14:00') RETURNING id INTO p_short;
  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at) VALUES ('ZZ rest fri day', ARRAY[fri], '06:00', '18:00') RETURNING id INTO p_fri_day;

  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id) VALUES ('ZZ Rest Day',   'Day',   p_sat_day,   true, u_day)   RETURNING id INTO e_day;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id) VALUES ('ZZ Rest Night', 'Night', p_fri_night, true, u_night) RETURNING id INTO e_night;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id) VALUES ('ZZ Rest Short', 'Day',   p_short,     true, u_short) RETURNING id INTO e_short;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id) VALUES ('ZZ Rest Fri',   'Day',   p_fri_day,   true, u_fri)   RETURNING id INTO e_fri;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id) VALUES ('ZZ Rest OT',    'Day',   NULL,        true, u_ot)    RETURNING id INTO e_ot;
  -- Not rostered on Saturday at all: the person with no rota pattern and a Day crew is unknown, not working.
  UPDATE public.employees SET shift_group = 'Day' WHERE id = e_ot;

  -- Make sure nobody else's board interferes with our fixed Saturday.
  UPDATE public.overtime_rules SET min_rest_hours = 11 WHERE id;

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '18:00', '06:00', 3, 'open', v_creator) RETURNING id INTO ask_night;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '06:00', '18:00', 3, 'open', v_creator) RETURNING id INTO ask_day;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '14:00', '18:00', 3, 'open', v_creator) RETURNING id INTO ask_after;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '14:00', '20:00', 3, 'open', v_creator) RETURNING id INTO ask_long;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat - 1, '18:00', '06:00', 3, 'open', v_creator) RETURNING id INTO ask_prev;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '05:00', '17:00', 3, 'open', v_creator) RETURNING id INTO ask_dawn13;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '04:00', '16:00', 3, 'open', v_creator) RETURNING id INTO ask_dawn14;

  -- ── 1. The report ───────────────────────────────────────────────────────────
  PERFORM pg_temp.ok('1a Day 06:00–18:00 is not offered Night 18:00–06:00 the same day', pg_temp.why(e_day, ask_night) IS NOT NULL);
  PERFORM pg_temp.ok('1b ...and the reason says rest', pg_temp.why(e_day, ask_night) LIKE '%not enough rest%');
  PERFORM pg_temp.ok('1c the phone hides it',
    (SELECT count(*) = 1 FROM (SELECT set_config('request.jwt.claims', json_build_object('sub', u_day)::text, true)) s,
       LATERAL public.my_overtime_clashes() c WHERE c.request_id = ask_night));
  msg := pg_temp.refusal(u_day, ask_night, 'yes');
  PERFORM pg_temp.ok('1d a yes is refused, naming rest and not "already yours"', msg LIKE 'Not enough rest between your shifts:%');
  SELECT count(*) INTO n FROM public.overtime_responses WHERE request_id = ask_night;
  PERFORM pg_temp.ok('1e the refused yes wrote nothing', n = 0);
  PERFORM pg_temp.ok('1f a no is still allowed', pg_temp.refusal(u_day, ask_night, 'no') IS NULL);

  -- Overlap still reads as before.
  PERFORM pg_temp.ok('2 overlapping its own hours still says the rota has them',
    pg_temp.why(e_day, ask_day) LIKE 'Your rota has you on the day shift%' AND pg_temp.why(e_day, ask_day) NOT LIKE '%not enough rest%');

  -- ── 3. Night into day ───────────────────────────────────────────────────────
  PERFORM pg_temp.ok('3 Friday night ending 06:00 is not offered Saturday 06:00–18:00', pg_temp.why(e_night, ask_day) IS NOT NULL);

  PERFORM pg_temp.ok('3b ...and the night BEFORE a Saturday day shift is not offered either (the ask comes first)', pg_temp.why(e_day, ask_prev) IS NOT NULL);

  -- ── 4. A longer day is still allowed, up to 13 hours ───────────────────────
  PERFORM pg_temp.ok('4a 06:00–14:00 then 14:00–18:00 (12 h) is offered', pg_temp.why(e_short, ask_after) IS NULL);
  PERFORM pg_temp.ok('4b 06:00–14:00 then 14:00–20:00 (14 h) is not', pg_temp.why(e_short, ask_long) IS NOT NULL);

  -- ── 5. The morning after: 11 hours of rest is the line ─────────────────────
  PERFORM pg_temp.ok('5a Friday 06:00–18:00 then Saturday 05:00–17:00 (11 h rest) is offered', pg_temp.why(e_fri, ask_dawn13) IS NULL);
  PERFORM pg_temp.ok('5b Friday 06:00–18:00 then Saturday 04:00–16:00 (10 h rest) is not', pg_temp.why(e_fri, ask_dawn14) IS NOT NULL);

  -- ── 6. The setting ──────────────────────────────────────────────────────────
  UPDATE public.overtime_rules SET min_rest_hours = 0 WHERE id;
  PERFORM pg_temp.ok('6a 0 turns the rule off', pg_temp.why(e_day, ask_night) IS NULL AND pg_temp.why(e_fri, ask_dawn14) IS NULL);
  UPDATE public.overtime_rules SET min_rest_hours = 8 WHERE id;
  PERFORM pg_temp.ok('6b 8 h of rest allows a 16 h window', pg_temp.why(e_fri, ask_dawn14) IS NULL);
  PERFORM pg_temp.ok('6c ...but still not 24 h in a row', pg_temp.why(e_day, ask_night) IS NOT NULL);
  UPDATE public.overtime_rules SET min_rest_hours = 11 WHERE id;
  BEGIN
    UPDATE public.overtime_rules SET min_rest_hours = 24 WHERE id;
    RAISE EXCEPTION 'FAILED 6d 24 h of rest was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- ── 7. Overtime already given counts as work ───────────────────────────────
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '06:00', '14:00', 3, 'open', v_creator) RETURNING id INTO ask_ot_a;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '14:00', '22:00', 3, 'open', v_creator) RETURNING id INTO ask_ot_b;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES (sat, '14:00', '18:00', 3, 'open', v_creator) RETURNING id INTO ask_ot_c;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision) VALUES (ask_ot_a, e_ot, 'yes', 'accepted');
  PERFORM pg_temp.ok('7a 8 h accepted, then another 8 h straight after (16 h): not offered', pg_temp.why(e_ot, ask_ot_b) IS NOT NULL);
  PERFORM pg_temp.ok('7b 8 h accepted, then 4 h after (12 h): offered', pg_temp.why(e_ot, ask_ot_c) IS NULL);

  -- ── 8. The pure rule, on its own ───────────────────────────────────────────
  PERFORM pg_temp.ok('8a 24 h in 24 h is short of rest',
    public.overtime_rest_short('2030-01-05 06:00', '2030-01-05 18:00', '2030-01-05 18:00', '2030-01-06 06:00', 11));
  PERFORM pg_temp.ok('8b 12 h and 12 h a day apart is not',
    NOT public.overtime_rest_short('2030-01-05 06:00', '2030-01-05 18:00', '2030-01-06 06:00', '2030-01-06 18:00', 11));
  PERFORM pg_temp.ok('8c rest 0 never complains',
    NOT public.overtime_rest_short('2030-01-05 06:00', '2030-01-05 18:00', '2030-01-05 18:00', '2030-01-06 06:00', 0));
  PERFORM pg_temp.ok('8d an unset rest never complains',
    NOT public.overtime_rest_short('2030-01-05 06:00', '2030-01-05 18:00', '2030-01-05 18:00', '2030-01-06 06:00', NULL));
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
