-- Tests for 20261018090000_overtime_is_not_offered_on_hours_already_rostered.sql
-- (and, from BLOCO 112, the rest rule: adjacent shifts that leave under 11 h of rest are hidden too).
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after that block has been
-- applied. Same shape as answer_overtime_eligibility_test.sql: one transaction, its own
-- throwaway people, asks and board rows, calls the functions the way the phone and the
-- supervisor's screen call them, and ROLLBACKs. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case.
--
-- Every date is a Saturday at least a week ahead, so the asks are "open and upcoming"
-- whatever day this is run, and no real board row is anywhere near them.
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

-- The answer, or the refusal's message. Null when accepted.
CREATE FUNCTION pg_temp.refusal(_user uuid, _request uuid, _answer text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_user);
  PERFORM public.answer_overtime(_request, _answer);
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN SQLERRM;
END $$;

-- Whether the phone of this person hides this ask.
CREATE FUNCTION pg_temp.hidden(_user uuid, _request uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_user);
  RETURN EXISTS (SELECT 1 FROM public.my_overtime_clashes() c WHERE c.request_id = _request);
END $$;

DO $$
DECLARE
  v_creator uuid;
  sat date := current_date + (((6 - extract(isodow from current_date)::int) + 7) % 7) + 7;
  p_wkend_short uuid;                         -- Fri–Mon, 06:00–14:00
  p_mon_thu uuid;                             -- Mon–Thu, 06:00–18:00
  u_weekend uuid := gen_random_uuid();        -- Weekend crew, no rota pattern: Fri–Mon by crew
  u_weekday uuid := gen_random_uuid();        -- Day crew on Mon–Thu
  u_short   uuid := gen_random_uuid();        -- Weekend crew on the 06:00–14:00 pattern
  u_night   uuid := gen_random_uuid();        -- Night crew, rostered Friday night on the board
  u_away    uuid := gen_random_uuid();        -- Weekend crew, on holiday that Saturday
  u_moved   uuid := gen_random_uuid();        -- Day crew now, but only from the week after Saturday
  u_ot      uuid := gen_random_uuid();        -- already given Saturday-morning overtime
  e_weekend uuid; e_weekday uuid; e_short uuid; e_night uuid; e_away uuid; e_moved uuid; e_ot uuid;
  ask_sat_day   uuid;   -- Sat 06:00–18:00, the case from the report
  ask_sat_night uuid;   -- Sat 18:00–06:00
  ask_sat_dawn  uuid;   -- Sat 05:00–09:00, inside Friday's night
  ask_sat_late  uuid;   -- Sat 14:00–18:00, after a 06:00–14:00 shift
  ask_sat_mid   uuid;   -- Sat 12:00–16:00, across the end of it
  ask_sat_morn  uuid;   -- Sat 08:00–12:00, the overtime already given
  ask_sat_ten   uuid;   -- Sat 10:00–14:00, on top of that overtime
  resp_morn uuid;
  msg text;
  n int;
BEGIN
  SELECT id INTO v_creator FROM auth.users LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No auth.users row exists to own the test ask';
  END IF;

  -- Since 20261018100000_one_login_is_one_person.sql `employees.user_id` references
  -- auth.users, so each throwaway person needs a throwaway login. The ROLLBACK at the
  -- end takes them away with everything else.
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_weekend, u_weekday, u_short, u_night, u_away, u_moved, u_ot]) u;

  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at)
  VALUES ('ZZ Test Fri-Mon short', ARRAY[5,6,7,1]::smallint[], '06:00', '14:00')
  RETURNING id INTO p_wkend_short;
  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at)
  VALUES ('ZZ Test Mon-Thu', ARRAY[1,2,3,4]::smallint[], '06:00', '18:00')
  RETURNING id INTO p_mon_thu;

  INSERT INTO public.employees (full_name, shift_group, active, user_id)
  VALUES ('ZZ Test Weekend', 'Weekend', true, u_weekend) RETURNING id INTO e_weekend;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Test Weekday', 'Day', p_mon_thu, true, u_weekday) RETURNING id INTO e_weekday;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Test Short', 'Weekend', p_wkend_short, true, u_short) RETURNING id INTO e_short;
  INSERT INTO public.employees (full_name, shift_group, active, user_id)
  VALUES ('ZZ Test Night', 'Night', true, u_night) RETURNING id INTO e_night;
  INSERT INTO public.employees (full_name, shift_group, active, user_id)
  VALUES ('ZZ Test Away', 'Weekend', true, u_away) RETURNING id INTO e_away;
  INSERT INTO public.employees (full_name, shift_group, active, user_id)
  VALUES ('ZZ Test Moved', 'Day', true, u_moved) RETURNING id INTO e_moved;
  INSERT INTO public.employees (full_name, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Test Given OT', 'Day', p_mon_thu, true, u_ot) RETURNING id INTO e_ot;

  -- Moved: the employee row already says Day, but the move only takes effect the week
  -- after Saturday. On that Saturday they are still weekend crew.
  INSERT INTO public.employee_shift_history (employee_id, shift_group, shift_pattern_id, effective_from)
  VALUES (e_moved, 'Weekend', NULL, sat - 30), (e_moved, 'Day', NULL, sat + 7);

  -- The board: Friday night for the night person, a holiday on the Saturday for Away.
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (sat - 1, 'Night', e_night, 'assigned'),
         (sat,     'Day',   e_away,  'holiday');

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat, '06:00', '18:00', 3, 'open', v_creator) RETURNING id INTO ask_sat_day;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat, '18:00', '06:00', 3, 'open', v_creator) RETURNING id INTO ask_sat_night;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat, '05:00', '09:00', 3, 'open', v_creator) RETURNING id INTO ask_sat_dawn;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat, '14:00', '18:00', 3, 'open', v_creator) RETURNING id INTO ask_sat_late;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat, '12:00', '16:00', 3, 'open', v_creator) RETURNING id INTO ask_sat_mid;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat, '08:00', '12:00', 3, 'open', v_creator) RETURNING id INTO ask_sat_morn;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat, '10:00', '14:00', 3, 'open', v_creator) RETURNING id INTO ask_sat_ten;

  -- ── The acceptance criterion ────────────────────────────────────────────────
  PERFORM pg_temp.expect_true('Saturday Day overtime is hidden from the Saturday Day crew',
    pg_temp.hidden(u_weekend, ask_sat_day));
  msg := pg_temp.refusal(u_weekend, ask_sat_day, 'yes');
  PERFORM pg_temp.expect_true('and a yes to it is refused, naming the shift',
    msg LIKE 'These hours are already yours: Your rota has you on the day shift on %06:00–18:00');
  SELECT count(*) INTO n FROM public.overtime_responses WHERE request_id = ask_sat_day;
  PERFORM pg_temp.expect_true('the refused yes wrote nothing', n = 0);
  PERFORM pg_temp.expect_true('a no is still allowed',
    pg_temp.refusal(u_weekend, ask_sat_day, 'no') IS NULL);

  PERFORM pg_temp.expect_true('somebody not due on Saturday still sees it',
    NOT pg_temp.hidden(u_weekday, ask_sat_day));
  PERFORM pg_temp.expect_true('and may say yes',
    pg_temp.refusal(u_weekday, ask_sat_day, 'yes') IS NULL);

  -- ── Hours, not labels ───────────────────────────────────────────────────────
  -- BLOCO 112: 06:00–18:00 and then 18:00–06:00 do not overlap but are 24 hours in a row.
  PERFORM pg_temp.expect_true('the Saturday Day crew is not offered Saturday night: no rest between',
    pg_temp.hidden(u_weekend, ask_sat_night));
  PERFORM pg_temp.expect_true('a 06:00–14:00 rota leaves 14:00–18:00 open',
    NOT pg_temp.hidden(u_short, ask_sat_late));
  PERFORM pg_temp.expect_true('but not 12:00–16:00, which overlaps it',
    pg_temp.hidden(u_short, ask_sat_mid));

  -- A day-of-week override on the pattern moves the hours for that weekday only.
  INSERT INTO public.shift_pattern_days (pattern_id, weekday, starts_at, ends_at)
  VALUES (p_wkend_short, 6, '10:00', '18:00');
  PERFORM pg_temp.expect_true('a Saturday override is read: 14:00–18:00 now overlaps',
    pg_temp.hidden(u_short, ask_sat_late));
  DELETE FROM public.shift_pattern_days WHERE pattern_id = p_wkend_short;

  -- ── The board ───────────────────────────────────────────────────────────────
  PERFORM pg_temp.expect_true('Friday''s night shift covers Saturday 05:00',
    pg_temp.hidden(u_night, ask_sat_dawn));
  -- BLOCO 112: Friday night ends 06:00; 14:00–18:00 would make 16 hours in 24.
  PERFORM pg_temp.expect_true('and Saturday afternoon is not offered to the night crew either: under 11 h of rest',
    pg_temp.hidden(u_night, ask_sat_late));
  PERFORM pg_temp.expect_true('a holiday on the board means the rota is not read',
    NOT pg_temp.hidden(u_away, ask_sat_day));

  -- The board, once drawn, beats the rota: the weekday person put on Saturday's board.
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (sat, 'Day', e_weekday, 'assigned');
  PERFORM pg_temp.expect_true('rostered on the board on a day the rota does not cover',
    pg_temp.hidden(u_weekday, ask_sat_late));
  DELETE FROM public.daily_allocations WHERE employee_id = e_weekday AND on_date = sat;

  -- ── The rota held on the date, not today's ─────────────────────────────────
  PERFORM pg_temp.expect_true('the crew held on Saturday decides, not the one on file today',
    pg_temp.hidden(u_moved, ask_sat_day));

  -- ── Overtime already given ─────────────────────────────────────────────────
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision)
  VALUES (ask_sat_morn, e_ot, 'yes', 'accepted') RETURNING id INTO resp_morn;
  PERFORM pg_temp.expect_true('overlapping overtime already accepted hides the second ask',
    pg_temp.hidden(u_ot, ask_sat_ten));
  PERFORM pg_temp.expect_true('the accepted ask does not clash with itself',
    NOT pg_temp.hidden(u_ot, ask_sat_morn));
  PERFORM pg_temp.expect_true('overtime that does not overlap is still offered',
    NOT pg_temp.hidden(u_ot, ask_sat_late));
  -- The row the bridge writes for it (written here too, for a database without the
  -- bridge). It carries the ask's id and is read through the
  -- answer above, with the ask's own hours — not as a whole day shift.
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status, overtime_request_id)
  VALUES (sat, 'Day', e_ot, 'overtime', ask_sat_morn)
  ON CONFLICT (on_date, shift, employee_id) DO NOTHING;  -- already there where block 93 is live
  PERFORM pg_temp.expect_true('the bridged board row is not read as a 06:00–18:00 shift',
    NOT pg_temp.hidden(u_ot, ask_sat_late));
  INSERT INTO public.overtime_outcomes (response_id, outcome, recorded_by)
  VALUES (resp_morn, 'called_sick', v_creator);
  PERFORM pg_temp.expect_true('once they dropped out of it, the hours are free again',
    NOT pg_temp.hidden(u_ot, ask_sat_ten));

  -- Overtime put on the board by hand, with no ask behind it, is overtime given.
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (sat, 'Night', e_weekday, 'overtime');
  PERFORM pg_temp.expect_true('hand-placed night overtime hides Saturday night',
    pg_temp.hidden(u_weekday, ask_sat_night));

  -- ── The supervisor's screen ────────────────────────────────────────────────
  PERFORM pg_temp.as_user(u_weekend);
  BEGIN
    PERFORM * FROM public.overtime_schedule_clashes(ARRAY[ask_sat_day]);
    RAISE EXCEPTION 'FAILED an employee read the supervisor''s clash list';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
