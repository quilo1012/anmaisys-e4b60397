-- Tests for 20261023200000_cancelled_overtime_leaves_where_im_working.sql.
--
-- Run this WHOLE file in one go, in the SQL editor, after that migration. One
-- transaction, its own throwaway people and asks, ROLLBACK at the end. The last
-- statement prints 'ALL TESTS PASSED'; any failure raises first, naming the case. It
-- must run as a role that bypasses RLS (the SQL editor's postgres role does); the RLS
-- cases switch to `authenticated` themselves.
--
-- The story is the one reported on 23/10: an employee on a Tue–Thu Day rota books a
-- Monday 06:00–18:00 overtime, cancels it in My Overtime, and "Where I'm working"
-- must stop listing it — while her Tuesday shift, a colleague's booking on the same
-- ask, the audit and the permissions stay exactly as they were.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

-- Runs _sql and fails the case unless it raises with a message containing _like.
CREATE FUNCTION pg_temp.expect_refused(_case text, _sql text, _like text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN others THEN
    IF position(_like in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FAILED % (refused for the wrong reason: %)', _case, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAILED % (was not refused)', _case;
END $$;

-- Being that session: auth.uid() reads request.jwt.claims.
CREATE FUNCTION pg_temp.as_user(_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user, 'role', 'authenticated')::text, true);
END $$;

-- What "Where I'm working" receives for the signed-in person over 14 days from _from.
CREATE FUNCTION pg_temp.page(_from date) RETURNS jsonb
LANGUAGE sql AS $$ SELECT public.my_attendance(_from, _from + 13) $$;

-- Overtime entries on one date in that payload.
CREATE FUNCTION pg_temp.ot_on(_page jsonb, _date date) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::int FROM jsonb_array_elements(coalesce(_page -> 'overtime', '[]')) o
   WHERE (o ->> 'on_date')::date = _date
$$;

-- Board rows with a given status on one date in that payload.
CREATE FUNCTION pg_temp.board_on(_page jsonb, _date date, _status text) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::int FROM jsonb_array_elements(coalesce(_page -> 'board', '[]')) b
   WHERE (b ->> 'on_date')::date = _date AND b ->> 'status' = _status
$$;

DO $$
DECLARE
  -- Next Monday at least two days out, so no guard sees a shift already under way.
  mon date := current_date + 2 + ((8 - extract(isodow from current_date + 2)::int) % 7);
  tue date;
  sat date;
  u_admin uuid := gen_random_uuid();
  u_ros uuid := gen_random_uuid();
  u_col uuid := gen_random_uuid();
  u_owl uuid := gen_random_uuid();
  pat uuid; area uuid;
  e_ros uuid; e_col uuid; e_owl uuid;
  ask uuid; ask_night uuid;
  resp public.overtime_responses;
  r_ros uuid; r_col uuid; r_owl uuid;
  v_outcome text;
  p jsonb;
  n int; n2 int;
  audit_before int;
BEGIN
  tue := mon + 1;
  sat := mon + 5;
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_admin, u_ros, u_col, u_owl]) u;
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_admin, 'admin'), (u_ros, 'employee'), (u_col, 'employee'), (u_owl, 'employee');

  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at)
  VALUES ('ZZ Tue–Thu days ' || u_ros, ARRAY[2,3,4]::smallint[], '06:00', '18:00') RETURNING id INTO pat;
  INSERT INTO public.headcount_areas (name, kind) VALUES ('ZZ Gel Packing ' || u_ros, 'production') RETURNING id INTO area;

  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Rosana ' || left(u_ros::text, 8), 'Production', 'Day', pat, true, u_ros) RETURNING id INTO e_ros;
  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Colleague ' || left(u_col::text, 8), 'Production', 'Day', pat, true, u_col) RETURNING id INTO e_col;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Nightowl ' || left(u_owl::text, 8), 'Production', 'Night', true, u_owl) RETURNING id INTO e_owl;

  -- Her normal Tuesday, placed by the planner: no overtime_request_id on it.
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, area_id, status)
  VALUES (tue, 'Day', e_ros, area, 'assigned');

  -- 1. A valid booking. The supervisor posts Monday 06:00–18:00; a yes books at once.
  PERFORM pg_temp.as_user(u_admin);
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (mon, '06:00', '18:00', u_admin) RETURNING id INTO ask;

  PERFORM pg_temp.as_user(u_ros);
  resp := public.answer_overtime(ask, 'yes');
  r_ros := resp.id;
  PERFORM pg_temp.expect_true('1. her yes is a booking', resp.decision = 'accepted');
  PERFORM pg_temp.as_user(u_col);
  resp := public.answer_overtime(ask, 'yes');
  r_col := resp.id;
  PERFORM pg_temp.expect_true('1b. the colleague is booked too', resp.decision = 'accepted');

  -- 2. It reaches the board and Where I'm working.
  PERFORM pg_temp.expect_true('2. the Headcount Board holds her Monday as overtime',
    exists (select 1 from public.daily_allocations
             where employee_id = e_ros and on_date = mon and shift = 'Day'
               and status = 'overtime' and overtime_request_id = ask));
  PERFORM pg_temp.as_user(u_ros);
  p := pg_temp.page(current_date);
  PERFORM pg_temp.expect_true('2b. Where I''m working lists the Monday overtime with its hours',
    pg_temp.ot_on(p, mon) = 1 AND pg_temp.board_on(p, mon, 'overtime') = 1
    AND exists (select 1 from jsonb_array_elements(p -> 'overtime') o
                 where (o ->> 'on_date')::date = mon and o ->> 'starts_at' = '06:00:00' and o ->> 'ends_at' = '18:00:00'));
  PERFORM pg_temp.expect_true('2c. and her Tuesday rota day', pg_temp.board_on(p, tue, 'assigned') = 1);

  -- 3. She cancels through My Overtime's own call.
  SELECT c.outcome INTO v_outcome FROM public.cancel_my_overtime(ask) c;
  PERFORM pg_temp.expect_true('3. the cancellation is in time', v_outcome = 'cancelled_in_time');

  -- 4. It persists: the outcome, the original decision and the audit trail.
  PERFORM pg_temp.expect_true('4. the outcome row is written',
    exists (select 1 from public.overtime_outcomes where response_id = r_ros and outcome = 'cancelled_in_time'));
  PERFORM pg_temp.expect_true('4b. the decision stays as the record of what was agreed',
    exists (select 1 from public.overtime_responses where id = r_ros and decision = 'accepted'));
  PERFORM pg_temp.expect_true('4c. the audit has her yes, the booking and the cancellation',
    (select count(*) from public.overtime_audit where response_id = r_ros
      and event_type in ('answered_yes', 'assigned', 'employee_cancelled')) = 3);

  -- 5. Out of planning, out of the headcount, out of Where I'm working.
  PERFORM pg_temp.expect_true('5. her board row is gone',
    not exists (select 1 from public.daily_allocations where employee_id = e_ros and on_date = mon));
  PERFORM pg_temp.expect_true('5b. the place no longer counts', public.overtime_places_taken(ask) = 1);
  p := pg_temp.page(current_date);
  PERFORM pg_temp.expect_true('5c. Where I''m working no longer lists the Monday',
    pg_temp.ot_on(p, mon) = 0 AND pg_temp.board_on(p, mon, 'overtime') = 0);

  -- 6. Her normal shift is untouched.
  PERFORM pg_temp.expect_true('6. her Tuesday is still on the board and on her phone',
    pg_temp.board_on(p, tue, 'assigned') = 1
    AND exists (select 1 from public.daily_allocations where employee_id = e_ros and on_date = tue and status = 'assigned'));
  PERFORM pg_temp.expect_true('6b. her rota still says Tue–Thu', (p -> 'pattern' -> 'days') = '[2,3,4]'::jsonb);

  -- 7. Other people are unaffected.
  PERFORM pg_temp.as_user(u_col);
  p := pg_temp.page(current_date);
  PERFORM pg_temp.expect_true('7. the colleague still has the Monday overtime',
    pg_temp.ot_on(p, mon) = 1 AND pg_temp.board_on(p, mon, 'overtime') = 1);

  -- 8. It does not come back. An edited ask and an ask cancelled then taken back both
  --    replay the accepted answers onto the board.
  PERFORM pg_temp.as_user(u_admin);
  UPDATE public.overtime_requests SET starts_at = '07:00' WHERE id = ask;
  PERFORM pg_temp.expect_true('8. editing the ask does not put her back on the board',
    not exists (select 1 from public.daily_allocations where employee_id = e_ros and on_date = mon));
  PERFORM pg_temp.expect_true('8b. and does move the colleague',
    exists (select 1 from public.daily_allocations where employee_id = e_col and on_date = mon and overtime_request_id = ask));
  UPDATE public.overtime_requests SET status = 'cancelled' WHERE id = ask;
  UPDATE public.overtime_requests SET status = 'open' WHERE id = ask;
  PERFORM pg_temp.expect_true('8c. cancelling and reopening the ask does not either',
    not exists (select 1 from public.daily_allocations where employee_id = e_ros and on_date = mon)
    AND exists (select 1 from public.daily_allocations where employee_id = e_col and on_date = mon));
  PERFORM public.overtime_board_apply(ask, e_ros, true);
  PERFORM pg_temp.expect_true('8d. nor does a backfill replaying every accepted answer',
    not exists (select 1 from public.daily_allocations where employee_id = e_ros and on_date = mon));
  PERFORM pg_temp.as_user(u_ros);
  audit_before := (select count(*) from public.overtime_audit where response_id = r_ros);
  p := pg_temp.page(current_date);
  PERFORM pg_temp.expect_true('8e. a fresh read still leaves it out', pg_temp.ot_on(p, mon) = 0);
  SELECT c.outcome INTO v_outcome FROM public.cancel_my_overtime(ask) c;
  PERFORM pg_temp.expect_true('8f. a second cancel answers the same and writes nothing new',
    v_outcome = 'cancelled_in_time'
    AND (select count(*) from public.overtime_audit where response_id = r_ros) = audit_before);

  -- 9. A cancellation recorded at the desk leaves the board as well; undoing it brings
  --    the booking back.
  PERFORM pg_temp.as_user(u_admin);
  PERFORM public.record_overtime_outcome(r_col, 'cancelled');
  PERFORM pg_temp.expect_true('9. the supervisor''s cancel takes the colleague off the board',
    not exists (select 1 from public.daily_allocations where employee_id = e_col and on_date = mon));
  PERFORM pg_temp.as_user(u_col);
  PERFORM pg_temp.expect_true('9b. and off their Where I''m working', pg_temp.ot_on(pg_temp.page(current_date), mon) = 0);
  PERFORM pg_temp.as_user(u_admin);
  PERFORM public.record_overtime_outcome(r_col, 'attended');
  PERFORM pg_temp.expect_true('9c. changed to attended, the booking is back on the board',
    exists (select 1 from public.daily_allocations where employee_id = e_col and on_date = mon and status = 'overtime'));
  PERFORM pg_temp.as_user(u_col);
  PERFORM pg_temp.expect_true('9d. and on their phone', pg_temp.ot_on(pg_temp.page(current_date), mon) = 1);
  PERFORM pg_temp.expect_true('9e. the audit kept every step',
    (select count(*) from public.overtime_audit where response_id = r_col
      and event_type in ('employee_cancelled', 'attended')) = 2);

  -- 10. Overnight: Saturday 18:00 to Sunday 06:00 sits on Saturday's Night board.
  PERFORM pg_temp.as_user(u_admin);
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (sat, '18:00', '06:00', u_admin) RETURNING id INTO ask_night;
  PERFORM pg_temp.as_user(u_owl);
  resp := public.answer_overtime(ask_night, 'yes');
  r_owl := resp.id;
  p := pg_temp.page(current_date);
  PERFORM pg_temp.expect_true('10. the night booking is on Saturday''s Night board',
    pg_temp.ot_on(p, sat) = 1
    AND exists (select 1 from public.daily_allocations where employee_id = e_owl and on_date = sat and shift = 'Night'));
  PERFORM public.cancel_my_overtime(ask_night);
  p := pg_temp.page(current_date);
  PERFORM pg_temp.expect_true('10b. cancelled, it leaves both days of the window',
    pg_temp.ot_on(p, sat) = 0 AND pg_temp.ot_on(p, sat + 1) = 0
    AND not exists (select 1 from public.daily_allocations where employee_id = e_owl and on_date in (sat, sat + 1)));

  -- 11. Permissions and RLS are as they were.
  PERFORM pg_temp.as_user(u_ros);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.overtime_responses WHERE request_id = ask;
  SELECT count(*) INTO n2 FROM public.daily_allocations;
  RESET ROLE;
  PERFORM pg_temp.expect_true('11. she reads her own response on the ask, not the colleague''s', n = 1);
  PERFORM pg_temp.expect_true('11b. an employee still cannot read the board table', n2 = 0);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.overtime_outcomes o JOIN public.overtime_responses r ON r.id = o.response_id
   WHERE r.request_id = ask;
  SELECT count(*) INTO n2 FROM public.overtime_audit WHERE employee_id = e_col;
  RESET ROLE;
  PERFORM pg_temp.expect_true('11c. she sees her own outcome only', n = 1);
  PERFORM pg_temp.expect_true('11d. and none of the colleague''s audit', n2 = 0);
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM public.overtime_outcomes WHERE response_id = r_ros;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp.expect_true('11e. she cannot delete her cancellation record', n = 0
    AND exists (select 1 from public.overtime_outcomes where response_id = r_ros));
  PERFORM pg_temp.expect_refused('11f. she cannot record outcomes',
    format('select * from public.record_overtime_outcome(%L, %L)', r_col, 'cancelled'), 'Only somebody who manages overtime');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.overtime_board_apply(ask, e_ros, true);
    n := 1;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp.expect_true('11g. the board writer stays out of reach of a login', n = 0);
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.my_attendance(current_date, current_date + 13);
    n := 1;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp.expect_true('11h. anon cannot call my_attendance', n = 0);
  PERFORM pg_temp.expect_refused('11i. the audit is append-only',
    format('update public.overtime_audit set note = %L where response_id = %L', 'x', r_ros), '');
END $$;

ROLLBACK;
SELECT 'ALL TESTS PASSED' AS result;
