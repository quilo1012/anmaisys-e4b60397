-- Tests for 20261029220000_leaving_the_reserve_is_a_plain_no.sql, and for the whole
-- "no, then yes" path an employee has in My Overtime.
--
-- Run this WHOLE file in one go, in the SQL editor, after that migration. One
-- transaction, its own throwaway people and asks, ROLLBACK at the end, so nothing it
-- writes (bells, booking notices, queued pushes) survives. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case. It must run as a role
-- that bypasses RLS (the SQL editor's postgres role does); the RLS cases switch to
-- `authenticated` themselves.
--
-- The story is the one seen on 29/10: a full ask, a yes that lands on the reserve, the
-- reserve left nine seconds later — and then no way back to yes.
--
-- Written against production's functions as of 29/10/2026 (BLOCOS 129–134 and the
-- booking notices). Without the migration it fails at case 3.

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

CREATE FUNCTION pg_temp.resp(_ask uuid, _emp uuid) RETURNS public.overtime_responses
LANGUAGE sql AS $$ SELECT * FROM public.overtime_responses WHERE request_id = _ask AND employee_id = _emp $$;

CREATE FUNCTION pg_temp.bells(_user uuid, _kind text) RETURNS integer
LANGUAGE sql AS $$ SELECT count(*)::int FROM public.notifications WHERE user_id = _user AND kind = _kind $$;

DO $$
DECLARE
  -- Next Monday at least two days out, so no guard sees a shift already under way.
  mon date := current_date + 2 + ((8 - extract(isodow from current_date + 2)::int) % 7);
  tue date; fri date; sat date; sun date;
  u_admin uuid := gen_random_uuid();
  u_ros uuid := gen_random_uuid();
  u_col uuid := gen_random_uuid();
  u_res uuid := gen_random_uuid();
  pat uuid; area uuid;
  e_admin uuid; e_ros uuid; e_col uuid; e_res uuid;
  ask_room uuid; ask_full uuid; ask_closed uuid; ask_night uuid;
  ask_rest uuid; ask_rota uuid; ask_crew uuid; ask_dept uuid; ask_past uuid;
  r public.overtime_responses;
  n int; n2 int; sup_before int; conf_before int;
  t_res timestamptz;
BEGIN
  tue := mon + 1; fri := mon + 4; sat := mon + 5; sun := mon + 6;
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_admin, u_ros, u_col, u_res]) u;
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_admin, 'admin'), (u_ros, 'employee'), (u_col, 'employee'), (u_res, 'employee');

  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at)
  VALUES ('ZZ Tue–Thu days ' || u_ros, ARRAY[2,3,4]::smallint[], '06:00', '18:00') RETURNING id INTO pat;
  INSERT INTO public.headcount_areas (name, kind) VALUES ('ZZ Gel Packing ' || u_ros, 'production') RETURNING id INTO area;

  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Supervisor ' || left(u_admin::text, 8), 'Production', 'Day', true, u_admin) RETURNING id INTO e_admin;
  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Rosana ' || left(u_ros::text, 8), 'Production', 'Day', pat, true, u_ros) RETURNING id INTO e_ros;
  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Colleague ' || left(u_col::text, 8), 'Production', 'Day', pat, true, u_col) RETURNING id INTO e_col;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Reserve ' || left(u_res::text, 8), 'Production', 'Day', true, u_res) RETURNING id INTO e_res;
  INSERT INTO public.employee_supervisors (employee_id, supervisor_id, position)
  SELECT e, e_admin, 1 FROM unnest(ARRAY[e_ros, e_col, e_res]) e;

  -- Her normal Tuesday, placed by the planner.
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, area_id, status)
  VALUES (tue, 'Day', e_ros, area, 'assigned');

  PERFORM pg_temp.as_user(u_admin);
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (mon, '06:00', '18:00', 2, u_admin) RETURNING id INTO ask_room;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sun, '06:00', '18:00', 1, u_admin) RETURNING id INTO ask_full;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (sun, '06:00', '14:00', u_admin) RETURNING id INTO ask_closed;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (fri, '18:00', '02:00', u_admin) RETURNING id INTO ask_night;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (mon, '20:00', '04:00', u_admin) RETURNING id INTO ask_rest;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (tue, '06:00', '14:00', u_admin) RETURNING id INTO ask_rota;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, shift_group, created_by)
  VALUES (sat, '18:00', '06:00', 'Night', u_admin) RETURNING id INTO ask_crew;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, department, created_by)
  VALUES (sun, '18:00', '02:00', 'Warehouse', u_admin) RETURNING id INTO ask_dept;

  -- ── 1. A plain no becomes a yes, and the yes is a booking ─────────────────────────
  PERFORM pg_temp.as_user(u_ros);
  r := public.answer_overtime(ask_room, 'no');
  PERFORM pg_temp.expect_true('1. her no is recorded, undecided', r.answer = 'no' AND r.decision IS NULL);
  PERFORM pg_temp.expect_true('1b. a no is not on the board',
    NOT EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_ros AND on_date = mon));
  sup_before := pg_temp.bells(u_admin, 'overtime_yes');
  r := public.answer_overtime(ask_room, 'yes');
  PERFORM pg_temp.expect_true('1c. the same row, now a booking', r.answer = 'yes' AND r.decision = 'accepted'
    AND (SELECT count(*) FROM public.overtime_responses WHERE request_id = ask_room AND employee_id = e_ros) = 1);
  PERFORM pg_temp.expect_true('1d. on the Monday Day board, as overtime from the ask',
    EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_ros AND on_date = mon
             AND shift = 'Day' AND status = 'overtime' AND overtime_request_id = ask_room));
  PERFORM pg_temp.expect_true('1e. one place taken', public.overtime_places_taken(ask_room) = 1);
  PERFORM pg_temp.expect_true('1f. audit keeps the no, the change and the booking',
    (SELECT string_agg(event_type, ',' ORDER BY id) FROM public.overtime_audit WHERE response_id = r.id)
      = 'answered_no,answered_yes,assigned'
    AND EXISTS (SELECT 1 FROM public.overtime_audit WHERE response_id = r.id AND event_type = 'answered_yes'
                 AND old_value ->> 'answer' = 'no' AND new_value ->> 'answer' = 'yes'));
  PERFORM pg_temp.expect_true('1g. she gets one confirmation, the supervisor one bell',
    pg_temp.bells(u_ros, 'overtime_confirmed') = 1 AND pg_temp.bells(u_admin, 'overtime_yes') = sup_before + 1);

  -- A second tap changes nothing and rings nobody.
  conf_before := pg_temp.bells(u_ros, 'overtime_confirmed');
  sup_before := pg_temp.bells(u_admin, 'overtime_yes');
  BEGIN
    PERFORM public.answer_overtime(ask_room, 'yes');
  EXCEPTION WHEN others THEN NULL;
  END;
  PERFORM pg_temp.expect_true('1h. a repeated yes is still one row, one place, no new bells',
    (SELECT count(*) FROM public.overtime_responses WHERE request_id = ask_room AND employee_id = e_ros) = 1
    AND public.overtime_places_taken(ask_room) = 1
    AND pg_temp.bells(u_ros, 'overtime_confirmed') = conf_before
    AND pg_temp.bells(u_admin, 'overtime_yes') = sup_before);

  -- ── 2. Full: the yes waits on the reserve list, it is never confirmed ─────────────
  PERFORM pg_temp.as_user(u_col);
  r := public.answer_overtime(ask_full, 'yes');
  PERFORM pg_temp.expect_true('2. the colleague takes the only place', r.decision = 'accepted');
  PERFORM pg_temp.as_user(u_ros);
  r := public.answer_overtime(ask_full, 'no');
  r := public.answer_overtime(ask_full, 'yes');
  PERFORM pg_temp.expect_true('2b. her no turned yes waits on the reserve, not confirmed',
    r.decision = 'reserve' AND public.overtime_places_taken(ask_full) = 1
    AND NOT EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_ros AND on_date = sun));
  PERFORM pg_temp.expect_true('2c. she is told she is on the reserve, not confirmed',
    pg_temp.bells(u_ros, 'overtime_booked') = 1
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_ros AND kind = 'overtime_confirmed'
                     AND overtime_request_id = ask_full));
  PERFORM pg_temp.as_user(u_res);
  r := public.answer_overtime(ask_full, 'yes');
  PERFORM pg_temp.expect_true('2d. a third person queues behind her', r.decision = 'reserve');
  -- One transaction has one now(), so every answer here carries the same time. Put the
  -- two reserve answers where real minutes would have: hers first, then the other one.
  UPDATE public.overtime_responses SET answered_at = now() - interval '2 minutes' WHERE request_id = ask_full AND employee_id = e_ros;
  UPDATE public.overtime_responses SET answered_at = now() - interval '1 minute' WHERE request_id = ask_full AND employee_id = e_res;
  t_res := now() - interval '1 minute';

  -- ── 3-5. The reported case: leave the reserve, then say yes again ─────────────────
  PERFORM pg_temp.as_user(u_ros);
  PERFORM public.leave_my_reserve(ask_full);
  r := pg_temp.resp(ask_full, e_ros);
  PERFORM pg_temp.expect_true('3. leaving the reserve is a plain no: no decision left behind',
    r.answer = 'no' AND r.decision IS NULL AND r.decided_at IS NULL AND r.decided_by IS NULL);
  PERFORM pg_temp.expect_true('3b. the audit says so: answered no, decision cleared',
    EXISTS (SELECT 1 FROM public.overtime_audit WHERE response_id = r.id AND event_type = 'answered_no'
             AND old_value ->> 'answer' = 'yes')
    AND EXISTS (SELECT 1 FROM public.overtime_audit WHERE response_id = r.id AND event_type = 'decision_cleared'
                 AND old_value ->> 'decision' = 'reserve'));
  PERFORM pg_temp.expect_true('4. the reserve list is the other person alone',
    (SELECT count(*) FROM public.overtime_responses WHERE request_id = ask_full AND decision = 'reserve') = 1);
  r := public.answer_overtime(ask_full, 'yes');
  PERFORM pg_temp.expect_true('5. a yes again, on the reserve',
    r.answer = 'yes' AND r.decision = 'reserve');
  PERFORM pg_temp.expect_true('5b. at the END of the list: behind who stayed on it', r.answered_at > t_res);

  -- A place frees: the person who stayed moves up first, then her.
  PERFORM pg_temp.as_user(u_col);
  PERFORM public.cancel_my_overtime(ask_full);
  PERFORM pg_temp.expect_true('5c. the place goes to who stayed on the reserve',
    (pg_temp.resp(ask_full, e_res)).decision = 'accepted' AND (pg_temp.resp(ask_full, e_ros)).decision = 'reserve'
    AND public.overtime_places_taken(ask_full) = 1);
  PERFORM pg_temp.as_user(u_res);
  PERFORM public.cancel_my_overtime(ask_full);
  PERFORM pg_temp.expect_true('5d. and the next place to her, onto the board',
    (pg_temp.resp(ask_full, e_ros)).decision = 'accepted' AND public.overtime_places_taken(ask_full) = 1
    AND EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_ros AND on_date = sun
                 AND status = 'overtime' AND overtime_request_id = ask_full));

  -- ── 6. Closed, cancelled, started: a no stays a no ────────────────────────────────
  PERFORM pg_temp.as_user(u_ros);
  PERFORM public.answer_overtime(ask_closed, 'no');
  PERFORM pg_temp.as_user(u_admin);
  UPDATE public.overtime_requests SET status = 'closed', closed_at = now() WHERE id = ask_closed;
  PERFORM pg_temp.as_user(u_ros);
  PERFORM pg_temp.expect_refused('6. a closed ask refuses the yes',
    format('select public.answer_overtime(%L, %L)', ask_closed, 'yes'), 'no longer open');
  PERFORM pg_temp.as_user(u_admin);
  UPDATE public.overtime_requests SET status = 'cancelled' WHERE id = ask_closed;
  PERFORM pg_temp.as_user(u_ros);
  PERFORM pg_temp.expect_refused('6b. a cancelled ask refuses the yes',
    format('select public.answer_overtime(%L, %L)', ask_closed, 'yes'), 'no longer open');
  PERFORM pg_temp.expect_true('6c. and the no is still the answer', (pg_temp.resp(ask_closed, e_ros)).answer = 'no');
  -- An ask whose shift began yesterday, answered no while it was still ahead.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (current_date - 1, '06:00', '18:00', u_admin) RETURNING id INTO ask_past;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer) VALUES (ask_past, e_ros, 'no');
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.expect_refused('6d. a shift that has started refuses the yes',
    format('select public.answer_overtime(%L, %L)', ask_past, 'yes'), 'already started');

  -- ── 7. Eligibility, rota and rest are checked on the change as on a first yes ─────
  PERFORM public.answer_overtime(ask_rota, 'no');
  PERFORM pg_temp.expect_refused('7. not on hours that are already hers (her Tuesday)',
    format('select public.answer_overtime(%L, %L)', ask_rota, 'yes'), 'These hours are already yours');
  PERFORM pg_temp.expect_true('7b. her Tuesday rota row is untouched',
    (SELECT count(*) FROM public.daily_allocations WHERE employee_id = e_ros AND on_date = tue) = 1
    AND (pg_temp.resp(ask_rota, e_ros)).answer = 'no');
  PERFORM public.answer_overtime(ask_rest, 'no');
  PERFORM pg_temp.expect_refused('7c. not without the rest between shifts (ends 04:00, rota 06:00)',
    format('select public.answer_overtime(%L, %L)', ask_rest, 'yes'), 'Not enough rest');
  PERFORM pg_temp.expect_refused('7d. not for another crew',
    format('select public.answer_overtime(%L, %L)', ask_crew, 'yes'), 'Night crew');
  PERFORM pg_temp.expect_refused('7e. not for another department',
    format('select public.answer_overtime(%L, %L)', ask_dept, 'yes'), 'Warehouse');

  -- ── 8. Overnight: Friday 18:00–02:00 lands on Friday's Night board ─────────────────
  PERFORM public.answer_overtime(ask_night, 'no');
  r := public.answer_overtime(ask_night, 'yes');
  PERFORM pg_temp.expect_true('8. a no turned yes overnight is booked on the Night board of the start date',
    r.decision = 'accepted'
    AND EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_ros AND on_date = fri
                 AND shift = 'Night' AND overtime_request_id = ask_night)
    AND NOT EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_ros AND on_date = fri + 1));

  -- ── 9. Yes back to no: the rules that already govern it ───────────────────────────
  PERFORM pg_temp.expect_refused('9. a booking is not undone by a no; it is cancelled',
    format('select public.answer_overtime(%L, %L)', ask_room, 'no'), 'already decided');
  PERFORM public.cancel_my_overtime(ask_room);
  PERFORM pg_temp.expect_true('9b. cancelled: off the board, the place free, the decision kept as the record',
    NOT EXISTS (SELECT 1 FROM public.daily_allocations WHERE employee_id = e_ros AND on_date = mon)
    AND public.overtime_places_taken(ask_room) = 0
    AND (pg_temp.resp(ask_room, e_ros)).decision = 'accepted');
  PERFORM pg_temp.expect_refused('9c. a cancelled booking is not re-taken by a yes (the cancellation stands)',
    format('select public.answer_overtime(%L, %L)', ask_room, 'yes'), 'already decided');
  PERFORM pg_temp.expect_true('9d. the cancellation record is still there',
    EXISTS (SELECT 1 FROM public.overtime_outcomes o WHERE o.response_id = (pg_temp.resp(ask_room, e_ros)).id
             AND o.outcome IN ('cancelled_in_time', 'cancelled_late')));
  PERFORM pg_temp.expect_refused('9e. only a reserve place is left with leave_my_reserve',
    format('select public.leave_my_reserve(%L)', ask_night), 'Only a place on the reserve list');

  -- ── 10. A supervisor's decline is theirs; a no is never attendance ────────────────
  PERFORM pg_temp.as_user(u_col);
  PERFORM public.answer_overtime(ask_night, 'no');
  PERFORM pg_temp.as_user(u_admin);
  PERFORM pg_temp.expect_refused('10. attendance cannot be recorded against a no',
    format('select * from public.record_overtime_outcome(%L, %L)', (pg_temp.resp(ask_night, e_col)).id, 'attended'),
    'did not say yes');
  UPDATE public.overtime_responses SET answer = 'yes', decision = 'declined', decided_at = now(), decided_by = u_admin
   WHERE request_id = ask_night AND employee_id = e_col;
  PERFORM pg_temp.as_user(u_col);
  PERFORM pg_temp.expect_refused('10b. a yes the supervisor declined is not re-opened by the employee',
    format('select public.answer_overtime(%L, %L)', ask_night, 'yes'), 'already decided');
  PERFORM pg_temp.expect_refused('10c. nor left as if it were a reserve place',
    format('select public.leave_my_reserve(%L)', ask_night), 'Only a place on the reserve list');

  -- ── 11. Permissions and RLS are as they were ──────────────────────────────────────
  PERFORM pg_temp.as_user(u_ros);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.overtime_responses WHERE request_id = ask_full;
  SELECT count(*) INTO n2 FROM public.daily_allocations;
  RESET ROLE;
  PERFORM pg_temp.expect_true('11. she reads only her own answer on the ask', n = 1);
  PERFORM pg_temp.expect_true('11b. she cannot read the board table', n2 = 0);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.overtime_responses SET decision = 'accepted' WHERE request_id = ask_closed AND employee_id = e_ros;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp.expect_true('11c. she cannot write a decision herself', n = 0
    AND (pg_temp.resp(ask_closed, e_ros)).decision IS NULL);
  PERFORM pg_temp.as_user(u_col);
  PERFORM pg_temp.expect_refused('11d. nobody leaves somebody else''s reserve place',
    format('select public.leave_my_reserve(%L)', ask_closed), 'no answer on this overtime ask');
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.leave_my_reserve(ask_full);
    n := 1;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp.expect_true('11e. anon cannot call leave_my_reserve', n = 0);
  PERFORM pg_temp.expect_refused('11f. the audit is append-only',
    format('update public.overtime_audit set note = %L where response_id = %L', 'x', (pg_temp.resp(ask_full, e_ros)).id), '');
END $$;

ROLLBACK;
SELECT 'ALL TESTS PASSED' AS result;
