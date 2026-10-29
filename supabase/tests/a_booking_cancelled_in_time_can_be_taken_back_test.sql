-- Tests for 20261029230000_a_booking_cancelled_in_time_can_be_taken_back.sql.
--
-- Run this WHOLE file in one go, in the SQL editor, after that migration. One
-- transaction, its own throwaway people and asks, ROLLBACK at the end, so nothing it
-- writes (bells, booking notices, queued pushes) survives. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case. It must run as a role
-- that bypasses RLS (the SQL editor's postgres role does).
--
-- The story is the one seen on 29/10: Rosana booked Monday 06:00–18:00, cancelled it
-- herself twelve minutes later, and days after wanted to go after all.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

-- Runs _sql and fails the case unless it raises with a message containing _like. The
-- block is a savepoint, as a PostgREST call is its own transaction: what the call did
-- before it raised is undone, which is what the "nothing changed" cases then check.
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

CREATE FUNCTION pg_temp.as_user(_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user, 'role', 'authenticated')::text, true);
END $$;

CREATE FUNCTION pg_temp.resp(_ask uuid, _emp uuid) RETURNS public.overtime_responses
LANGUAGE sql AS $$ SELECT * FROM public.overtime_responses WHERE request_id = _ask AND employee_id = _emp $$;

CREATE FUNCTION pg_temp.outcome(_ask uuid, _emp uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT o.outcome FROM public.overtime_outcomes o
    JOIN public.overtime_responses r ON r.id = o.response_id
   WHERE r.request_id = _ask AND r.employee_id = _emp
$$;

CREATE FUNCTION pg_temp.on_board(_ask uuid, _emp uuid) RETURNS boolean
LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.daily_allocations WHERE overtime_request_id = _ask AND employee_id = _emp)
$$;

DO $$
DECLARE
  mon date := current_date + 2 + ((8 - extract(isodow from current_date + 2)::int) % 7);
  sat date; sun date;
  u_admin uuid := gen_random_uuid();
  u_ros uuid := gen_random_uuid();
  u_col uuid := gen_random_uuid();
  u_res uuid := gen_random_uuid();
  u_blk uuid := gen_random_uuid();
  pat uuid;
  e_admin uuid; e_ros uuid; e_col uuid; e_res uuid; e_blk uuid;
  ask_mon uuid; ask_full uuid; ask_closed uuid; ask_late uuid; ask_past uuid; ask_gone uuid;
  r public.overtime_responses;
  p jsonb;
  n int; sup_before int;
BEGIN
  sat := mon + 5; sun := mon + 6;
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_admin, u_ros, u_col, u_res, u_blk]) u;
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_admin, 'admin'), (u_ros, 'employee'), (u_col, 'employee'), (u_res, 'employee'), (u_blk, 'employee');
  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at)
  VALUES ('ZZ Tue–Thu days ' || u_ros, ARRAY[2,3,4]::smallint[], '06:00', '18:00') RETURNING id INTO pat;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Supervisor ' || left(u_admin::text, 8), 'Production', 'Day', true, u_admin) RETURNING id INTO e_admin;
  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Rosana ' || left(u_ros::text, 8), 'Production', 'Day', pat, true, u_ros) RETURNING id INTO e_ros;
  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Colleague ' || left(u_col::text, 8), 'Production', 'Day', pat, true, u_col) RETURNING id INTO e_col;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Late ' || left(u_res::text, 8), 'Production', 'Day', true, u_res) RETURNING id INTO e_res;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Blocked ' || left(u_blk::text, 8), 'Production', 'Day', true, u_blk) RETURNING id INTO e_blk;
  INSERT INTO public.employee_supervisors (employee_id, supervisor_id, position)
  SELECT e, e_admin, 1 FROM unnest(ARRAY[e_ros, e_col, e_res, e_blk]) e;

  PERFORM pg_temp.as_user(u_admin);
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (mon, '06:00', '18:00', u_admin) RETURNING id INTO ask_mon;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, created_by)
  VALUES (sat, '06:00', '18:00', 1, u_admin) RETURNING id INTO ask_full;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (sun, '06:00', '14:00', u_admin) RETURNING id INTO ask_closed;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (sun, '18:00', '23:00', u_admin) RETURNING id INTO ask_late;

  -- ── 1. The reported case: booked, cancelled in time, booked again ─────────────────
  PERFORM pg_temp.as_user(u_ros);
  r := public.answer_overtime(ask_mon, 'yes');
  PERFORM pg_temp.expect_true('1. her yes is a booking', r.decision = 'accepted' AND pg_temp.on_board(ask_mon, e_ros));
  PERFORM public.cancel_my_overtime(ask_mon);
  PERFORM pg_temp.expect_true('1b. she cancels in time: off the board, Where I''m working empty',
    pg_temp.outcome(ask_mon, e_ros) = 'cancelled_in_time' AND NOT pg_temp.on_board(ask_mon, e_ros)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_attendance(mon, mon) -> 'overtime')));
  sup_before := (SELECT count(*) FROM public.notifications WHERE user_id = u_admin AND kind = 'overtime_yes');
  r := public.rebook_my_overtime(ask_mon);
  PERFORM pg_temp.expect_true('1c. booked again, on the same row', r.answer = 'yes' AND r.decision = 'accepted'
    AND (SELECT count(*) FROM public.overtime_responses WHERE request_id = ask_mon AND employee_id = e_ros) = 1);
  PERFORM pg_temp.expect_true('1d. the cancellation is gone, the board row is back, one place taken',
    pg_temp.outcome(ask_mon, e_ros) IS NULL AND pg_temp.on_board(ask_mon, e_ros)
    AND public.overtime_places_taken(ask_mon) = 1);
  p := public.my_attendance(mon, mon);
  PERFORM pg_temp.expect_true('1e. Where I''m working lists the Monday again',
    (SELECT count(*) FROM jsonb_array_elements(p -> 'overtime') o WHERE (o ->> 'on_date')::date = mon) = 1);
  PERFORM pg_temp.expect_true('1f. the audit keeps the first booking, the cancellation and the second booking',
    (SELECT string_agg(event_type, ',' ORDER BY id) FROM public.overtime_audit WHERE response_id = r.id)
      = 'answered_yes,assigned,employee_cancelled,answered_no,removed_from_overtime,outcome_removed,answered_yes,assigned'
    AND EXISTS (SELECT 1 FROM public.overtime_audit WHERE response_id = r.id AND event_type = 'outcome_removed'
                 AND old_value ->> 'outcome' = 'cancelled_in_time'));
  PERFORM pg_temp.expect_true('1g. the supervisor is told she is coming in again, once',
    (SELECT count(*) FROM public.notifications WHERE user_id = u_admin AND kind = 'overtime_yes') = sup_before + 1);
  PERFORM pg_temp.expect_refused('1h. a second tap finds nothing to take back, and changes nothing',
    format('select public.rebook_my_overtime(%L)', ask_mon), 'Only a booking you cancelled');
  PERFORM pg_temp.expect_true('1i. still one booking, one place',
    (pg_temp.resp(ask_mon, e_ros)).decision = 'accepted' AND public.overtime_places_taken(ask_mon) = 1);

  -- ── 2. Full: back on the reserve, never past the headcount ────────────────────────
  r := public.answer_overtime(ask_full, 'yes');
  PERFORM pg_temp.as_user(u_col);
  r := public.answer_overtime(ask_full, 'yes');
  PERFORM pg_temp.expect_true('2. the colleague waits on the reserve', r.decision = 'reserve');
  PERFORM pg_temp.as_user(u_ros);
  PERFORM public.cancel_my_overtime(ask_full);
  PERFORM pg_temp.expect_true('2b. her place went to the colleague',
    (pg_temp.resp(ask_full, e_col)).decision = 'accepted' AND public.overtime_places_taken(ask_full) = 1);
  r := public.rebook_my_overtime(ask_full);
  PERFORM pg_temp.expect_true('2c. booked again on a full ask means the reserve list, not a place',
    r.decision = 'reserve' AND public.overtime_places_taken(ask_full) = 1
    AND (pg_temp.resp(ask_full, e_col)).decision = 'accepted' AND NOT pg_temp.on_board(ask_full, e_ros));

  -- ── 3. Closed, started: the cancellation stays ────────────────────────────────────
  r := public.answer_overtime(ask_closed, 'yes');
  PERFORM public.cancel_my_overtime(ask_closed);
  PERFORM pg_temp.as_user(u_admin);
  UPDATE public.overtime_requests SET status = 'closed', closed_at = now() WHERE id = ask_closed;
  PERFORM pg_temp.as_user(u_ros);
  PERFORM pg_temp.expect_refused('3. a closed ask is not booked again',
    format('select public.rebook_my_overtime(%L)', ask_closed), 'no longer open');
  PERFORM pg_temp.expect_true('3b. and the cancellation is untouched', pg_temp.outcome(ask_closed, e_ros) = 'cancelled_in_time');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (current_date - 1, '06:00', '18:00', u_admin) RETURNING id INTO ask_past;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, decided_at)
  VALUES (ask_past, e_ros, 'yes', 'accepted', now()) RETURNING * INTO r;
  INSERT INTO public.overtime_outcomes (response_id, outcome, recorded_by) VALUES (r.id, 'cancelled_in_time', u_ros);
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.expect_refused('3c. a shift that has started is not booked again',
    format('select public.rebook_my_overtime(%L)', ask_past), 'already started');

  -- ── 4. A late cancellation stands, and so does its block ──────────────────────────
  PERFORM pg_temp.as_user(u_res);
  r := public.answer_overtime(ask_late, 'yes');
  -- Late as the rule counts it (the shift within late_cancel_hours), written as the
  -- function writes it: by her, about her own booking.
  INSERT INTO public.overtime_outcomes (response_id, outcome, recorded_by) VALUES (r.id, 'cancelled_late', u_res);
  PERFORM pg_temp.expect_refused('4. a late cancellation is not taken back by the employee',
    format('select public.rebook_my_overtime(%L)', ask_late), 'cancelled this late');
  -- Production's rules on 29/10: a late cancellation blocks for 2 days after the shift.
  PERFORM pg_temp.expect_true('4b. it is still there, and still blocks',
    pg_temp.outcome(ask_late, e_res) = 'cancelled_late'
    AND (SELECT blocked_until FROM public.overtime_block_for(e_res)) IS NOT NULL);

  -- ── 5. A cancellation the supervisor recorded is theirs to undo ───────────────────
  PERFORM pg_temp.as_user(u_col);
  r := public.answer_overtime(ask_mon, 'yes');
  PERFORM pg_temp.as_user(u_admin);
  PERFORM public.record_overtime_outcome(r.id, 'cancelled');
  PERFORM pg_temp.as_user(u_col);
  PERFORM pg_temp.expect_refused('5. a desk cancellation is not undone by the employee',
    format('select public.rebook_my_overtime(%L)', ask_mon), 'Your supervisor cancelled');
  PERFORM pg_temp.expect_true('5b. it stands', pg_temp.outcome(ask_mon, e_col) IN ('cancelled_in_time', 'cancelled_late'));

  -- ── 6. Every first-yes rule still applies, and a refusal changes nothing ──────────
  PERFORM pg_temp.as_user(u_blk);
  r := public.answer_overtime(ask_mon, 'yes');
  PERFORM public.cancel_my_overtime(ask_mon);
  -- A no-show on an earlier ask: the block answer_overtime checks.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, created_by)
  VALUES (current_date - 1, '18:00', '23:00', u_admin) RETURNING id INTO ask_gone;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, decided_at)
  VALUES (ask_gone, e_blk, 'yes', 'accepted', now()) RETURNING * INTO r;
  INSERT INTO public.overtime_outcomes (response_id, outcome, recorded_by) VALUES (r.id, 'no_show', u_admin);
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.expect_refused('6. a no-show block refuses the booking again',
    format('select public.rebook_my_overtime(%L)', ask_mon), 'can''t sign up');
  PERFORM pg_temp.expect_true('6b. and nothing was changed: the cancellation and the decision are as they were',
    pg_temp.outcome(ask_mon, e_blk) = 'cancelled_in_time'
    AND (pg_temp.resp(ask_mon, e_blk)).answer = 'yes' AND (pg_temp.resp(ask_mon, e_blk)).decision = 'accepted'
    AND NOT pg_temp.on_board(ask_mon, e_blk));

  -- ── 7. Only one's own, only signed in ─────────────────────────────────────────────
  PERFORM pg_temp.as_user(u_res);
  PERFORM pg_temp.expect_refused('7. nobody books again an ask they never answered',
    format('select public.rebook_my_overtime(%L)', ask_closed), 'no answer on this overtime ask');
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.rebook_my_overtime(ask_mon);
    n := 1;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp.expect_true('7b. anon cannot call rebook_my_overtime', n = 0);
  PERFORM pg_temp.as_user(u_blk);
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM public.overtime_outcomes o USING public.overtime_responses x
     WHERE x.id = o.response_id AND x.employee_id = e_blk;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  RESET ROLE;
  PERFORM pg_temp.expect_true('7c. the table itself still refuses an employee''s delete', n = 0
    AND pg_temp.outcome(ask_mon, e_blk) = 'cancelled_in_time');
  PERFORM pg_temp.expect_refused('7d. the audit is append-only',
    format('update public.overtime_audit set note = %L where employee_id = %L', 'x', e_ros), '');
END $$;

ROLLBACK;
SELECT 'ALL TESTS PASSED' AS result;
