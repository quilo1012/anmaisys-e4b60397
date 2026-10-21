-- Tests for 20261018090000_overtime_is_not_offered_on_hours_already_rostered.sql, from
-- the report of 18/10/2026: somebody rostered Tuesday to Thursday on days was still
-- offered Tuesday-to-Thursday Day overtime on the phone.
--
-- overtime_schedule_clash_test.sql proves the rule on Saturdays. This file proves it on
-- a midweek rota, on the hours (not the crew label), across midnight, with a date-only
-- change on the board, and through the door a phone does not use: a direct insert into
-- overtime_responses. It also checks, ask by ask, that what the phone hides is exactly
-- what the database refuses.
--
-- Synthetic people only. Run the WHOLE file in one go, in the Supabase SQL Editor, after
-- BLOCO 95 (APLICAR-95) has been applied. One transaction, ROLLBACK at the end. The last
-- statement prints 'ALL TESTS PASSED'; any failure raises first, naming the case.
--
-- It must run as a role that bypasses RLS (the SQL Editor's postgres role does).

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user)::text, true);
END $$;

-- The phone's answer: null when the yes went through, otherwise the refusal.
CREATE FUNCTION pg_temp.refusal(_user uuid, _request uuid, _answer text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_user);
  PERFORM public.answer_overtime(_request, _answer);
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN SQLERRM;
END $$;

-- The same yes, written straight into the table as the employee, as a hand-made API
-- call would. Null when it went through.
CREATE FUNCTION pg_temp.direct_yes(_user uuid, _employee uuid, _request uuid)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_user);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (_request, _employee, 'yes');
  RESET ROLE;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RESET ROLE;
  RETURN SQLERRM;
END $$;

CREATE FUNCTION pg_temp.hidden(_user uuid, _request uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_user);
  RETURN EXISTS (SELECT 1 FROM public.my_overtime_clashes() c WHERE c.request_id = _request);
END $$;

DO $$
DECLARE
  v_creator uuid;
  -- The Tuesday at least a week ahead, so every ask is open and upcoming.
  tue date := current_date + (((2 - extract(isodow from current_date)::int) + 7) % 7) + 7;
  wed date; thu date; fri date; mon date;
  p_tue_thu_day   uuid;                     -- Tue–Thu, 06:00–18:00
  p_tue_thu_night uuid;                     -- Tue–Thu, 18:00–06:00
  u_mid   uuid := gen_random_uuid();        -- Day crew on Tue–Thu
  u_nite  uuid := gen_random_uuid();        -- Night crew on Tue–Thu nights
  u_free  uuid := gen_random_uuid();        -- Day crew, no rota on file, nothing on the board
  e_mid uuid; e_nite uuid; e_free uuid;
  a_tue_day uuid; a_wed_day uuid; a_thu_day uuid;   -- 06:00–18:00 on each rostered day
  a_mon_day uuid; a_fri_day uuid;                   -- days the rota leaves free
  a_tue_night uuid;   -- Tue 18:00–Wed 06:00: touches both day shifts, overlaps neither
  a_wed_late  uuid;   -- Wed 17:00–Thu 05:00: one hour inside Wednesday's day shift
  a_tue_short uuid;   -- Tue 10:00–14:00: inside the shift, not the whole of it
  a_fri_dawn  uuid;   -- Fri 04:00–08:00: inside Thursday's night, after midnight
  a_fri_morn  uuid;   -- Fri 06:00–10:00: after Thursday's night has ended
  a uuid;
  msg text;
  n int;
BEGIN
  wed := tue + 1; thu := tue + 2; fri := tue + 3; mon := tue - 1;

  SELECT id INTO v_creator FROM auth.users LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No auth.users row exists to own the test ask';
  END IF;

  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_mid, u_nite, u_free]) u;

  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at)
  VALUES ('ZZ Test Tue-Thu day', ARRAY[2,3,4]::smallint[], '06:00', '18:00')
  RETURNING id INTO p_tue_thu_day;
  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at)
  VALUES ('ZZ Test Tue-Thu night', ARRAY[2,3,4]::smallint[], '18:00', '06:00')
  RETURNING id INTO p_tue_thu_night;

  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Test Midweek', 'Day', p_tue_thu_day, true, u_mid) RETURNING id INTO e_mid;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Test Midweek Night', 'Night', p_tue_thu_night, true, u_nite) RETURNING id INTO e_nite;
  INSERT INTO public.employees (full_name, shift_group, active, user_id)
  VALUES ('ZZ Test Free', 'Day', true, u_free) RETURNING id INTO e_free;

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (tue, '06:00', '18:00', 2, 'open', v_creator) RETURNING id INTO a_tue_day;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (wed, '06:00', '18:00', 2, 'open', v_creator) RETURNING id INTO a_wed_day;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (thu, '06:00', '18:00', 2, 'open', v_creator) RETURNING id INTO a_thu_day;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (mon, '06:00', '18:00', 2, 'open', v_creator) RETURNING id INTO a_mon_day;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (fri, '06:00', '18:00', 2, 'open', v_creator) RETURNING id INTO a_fri_day;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (tue, '18:00', '06:00', 2, 'open', v_creator) RETURNING id INTO a_tue_night;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (wed, '17:00', '05:00', 2, 'open', v_creator) RETURNING id INTO a_wed_late;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (tue, '10:00', '14:00', 2, 'open', v_creator) RETURNING id INTO a_tue_short;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (fri, '04:00', '08:00', 2, 'open', v_creator) RETURNING id INTO a_fri_dawn;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by) VALUES
    (fri, '06:00', '10:00', 2, 'open', v_creator) RETURNING id INTO a_fri_morn;

  -- ── 1. Tue–Thu Day crew: Tue/Wed/Thu Day overtime is not offered ──────────────
  PERFORM pg_temp.expect_true('Tuesday Day overtime is hidden from the Tue–Thu Day rota',
    pg_temp.hidden(u_mid, a_tue_day));
  PERFORM pg_temp.expect_true('Wednesday Day overtime is hidden', pg_temp.hidden(u_mid, a_wed_day));
  PERFORM pg_temp.expect_true('Thursday Day overtime is hidden', pg_temp.hidden(u_mid, a_thu_day));
  PERFORM pg_temp.expect_true('four hours inside the Tuesday shift are hidden too',
    pg_temp.hidden(u_mid, a_tue_short));
  msg := pg_temp.refusal(u_mid, a_wed_day, 'yes');
  PERFORM pg_temp.expect_true('a yes to Wednesday is refused, naming the rota: ' || coalesce(msg, 'accepted'),
    msg LIKE 'These hours are already yours: Your rota has you on the day shift%');

  -- ── 2. Hours, not the crew label: Night is not refused wholesale ──────────────
  -- BLOCO 112: touching is not free. Tuesday 06:00–18:00 and then Tuesday night 18:00–06:00 is 24
  -- hours in a row, and Wednesday's shift starts as the night ends — so it is not offered.
  PERFORM pg_temp.expect_true('Tue 18:00–06:00 follows the Tuesday day shift straight on: not enough rest, hidden',
    pg_temp.hidden(u_mid, a_tue_night));
  PERFORM pg_temp.expect_true('Wed 17:00–05:00 overlaps Wednesday by an hour and is hidden',
    pg_temp.hidden(u_mid, a_wed_late));

  -- ── 3. Days the rota leaves free are still offered ────────────────────────────
  PERFORM pg_temp.expect_true('Monday Day is offered', NOT pg_temp.hidden(u_mid, a_mon_day));
  PERFORM pg_temp.expect_true('Friday Day is offered', NOT pg_temp.hidden(u_mid, a_fri_day));
  PERFORM pg_temp.expect_true('and a yes to Friday goes through',
    pg_temp.refusal(u_mid, a_fri_day, 'yes') IS NULL);
  PERFORM pg_temp.expect_true('nobody on file is blocked from Tuesday Day',
    NOT pg_temp.hidden(u_free, a_tue_day));

  -- ── 4. A change for one date, on the board, beats the rota for that date only ─
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (wed, 'Day', e_mid, 'holiday');
  PERFORM pg_temp.expect_true('on holiday on Wednesday: Wednesday Day is offered again',
    NOT pg_temp.hidden(u_mid, a_wed_day));
  PERFORM pg_temp.expect_true('Thursday is still the rota''s', pg_temp.hidden(u_mid, a_thu_day));
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (mon, 'Day', e_mid, 'assigned');
  PERFORM pg_temp.expect_true('put on Monday''s board: Monday Day is hidden',
    pg_temp.hidden(u_mid, a_mon_day));

  -- ── 5. Night crossing midnight ────────────────────────────────────────────────
  PERFORM pg_temp.expect_true('Fri 04:00–08:00 is inside Thursday''s night and hidden',
    pg_temp.hidden(u_nite, a_fri_dawn));
  -- BLOCO 112: a night that has just ended, then four more hours, is 16 hours in 24.
  PERFORM pg_temp.expect_true('Fri 06:00–10:00 starts when that night ends: 16 h in 24, hidden',
    pg_temp.hidden(u_nite, a_fri_morn));
  PERFORM pg_temp.expect_true('the night crew is not offered Tuesday Day either: it ends at 18:00 as their night starts',
    pg_temp.hidden(u_nite, a_tue_day));
  PERFORM pg_temp.expect_true('but not Tuesday night, which is their own shift',
    pg_temp.hidden(u_nite, a_tue_night));

  -- ── 6. Overtime already accepted still blocks an overlapping one ──────────────
  UPDATE public.overtime_responses SET decision = 'accepted'
   WHERE request_id = a_fri_day AND employee_id = e_mid;
  PERFORM pg_temp.expect_true('Friday 06–18 accepted: Friday 06–10 is hidden',
    pg_temp.hidden(u_mid, a_fri_morn));

  -- ── 7. The backend refuses a hand-made yes, whatever the phone shows ─────────
  msg := pg_temp.direct_yes(u_mid, e_mid, a_thu_day);
  PERFORM pg_temp.expect_true('a direct insert of yes on Thursday is refused: ' || coalesce(msg, 'accepted'),
    msg LIKE 'These hours are already yours:%');
  SELECT count(*) INTO n FROM public.overtime_responses WHERE request_id = a_thu_day;
  PERFORM pg_temp.expect_true('and wrote nothing', n = 0);
  PERFORM pg_temp.expect_true('a direct yes on hours that are free goes through',
    pg_temp.direct_yes(u_free, e_free, a_thu_day) IS NULL);

  -- ── 8. The phone and the database agree, ask by ask ──────────────────────────
  -- Everything u_nite has not answered: hidden on the phone ⇔ the yes is refused.
  FOREACH a IN ARRAY ARRAY[a_tue_day, a_wed_day, a_thu_day, a_mon_day, a_tue_night,
                           a_wed_late, a_tue_short, a_fri_dawn, a_fri_morn] LOOP
    n := (SELECT count(*) FROM public.overtime_responses WHERE request_id = a AND employee_id = e_nite);
    CONTINUE WHEN n > 0;
    PERFORM pg_temp.expect_true('phone and database agree on ask ' || a,
      pg_temp.hidden(u_nite, a) = (pg_temp.refusal(u_nite, a, 'yes') IS NOT NULL));
  END LOOP;
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
