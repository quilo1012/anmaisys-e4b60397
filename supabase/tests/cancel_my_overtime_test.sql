-- Tests for cancel_my_overtime (an employee takes back their own confirmed booking).
--
-- Run this WHOLE file in one go, in the SQL editor, after the cancel_my_overtime
-- migration. One transaction, its own throwaway people and asks, ROLLBACK at the end.
-- The last statement prints 'ALL TESTS PASSED'; any failure raises first, naming the
-- case. It must run as a role that bypasses RLS (the SQL editor's postgres role does).

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

DO $$
DECLARE
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  e1 uuid; e2 uuid; e3 uuid;
  ask uuid; ask2 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid;
  v_outcome text; v_promoted uuid; v_promoted_emp uuid;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
    (u1, 'zz-' || u1 || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u2, 'zz-' || u2 || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (u3, 'zz-' || u3 || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Cancel One', 'Production', 'Day', true, u1) RETURNING id INTO e1;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Cancel Two', 'Production', 'Day', true, u2) RETURNING id INTO e2;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Cancel Three', 'Production', 'Day', true, u3) RETURNING id INTO e3;

  -- An open ask a week out, one place. e1 is booked, e2 and e3 are reserves.
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, created_by)
  VALUES (current_date + 7, '06:00', '14:00', 1, 'Production', u1) RETURNING id INTO ask;

  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at)
  VALUES (ask, e1, 'yes', 'accepted', now() - interval '3 hours') RETURNING id INTO r1;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at)
  VALUES (ask, e2, 'yes', 'reserve', now() - interval '2 hours') RETURNING id INTO r2;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at)
  VALUES (ask, e3, 'yes', 'reserve', now() - interval '1 hour') RETURNING id INTO r3;

  -- 1. Somebody with no answer on the ask is refused.
  PERFORM pg_temp.as_user(u1);
  PERFORM pg_temp.expect_refused('a stranger to the ask cannot cancel',
    format('select * from public.cancel_my_overtime(%L)', gen_random_uuid()), 'no answer');

  -- 2. A reserve has an answer but no booking: refused.
  PERFORM pg_temp.as_user(u3);
  PERFORM pg_temp.expect_refused('a reserve cannot cancel',
    format('select * from public.cancel_my_overtime(%L)', ask), 'confirmed booking');

  -- 3. The booked person cancels: outcome written, board row gone, oldest reserve promoted.
  PERFORM pg_temp.as_user(u1);
  SELECT outcome, promoted_response_id, promoted_employee_id
    INTO v_outcome, v_promoted, v_promoted_emp
    FROM public.cancel_my_overtime(ask);
  PERFORM pg_temp.expect_true('cancel in time when the rule is off', v_outcome = 'cancelled_in_time');
  PERFORM pg_temp.expect_true('the oldest reserve is promoted', v_promoted = r2 AND v_promoted_emp = e2);
  PERFORM pg_temp.expect_true('the outcome row is written',
    exists (select 1 from public.overtime_outcomes where response_id = r1 and outcome = 'cancelled_in_time'));
  PERFORM pg_temp.expect_true('the promoted reserve is now accepted',
    exists (select 1 from public.overtime_responses where id = r2 and decision = 'accepted'));
  PERFORM pg_temp.expect_true('the board row is removed',
    not exists (select 1 from public.daily_allocations where overtime_request_id = ask and employee_id = e1));

  -- 4. Cancelling again answers with what the first tap wrote, instead of failing.
  SELECT outcome INTO v_outcome FROM public.cancel_my_overtime(ask);
  PERFORM pg_temp.expect_true('a second cancel is idempotent', v_outcome = 'cancelled_in_time');

  -- 5. Once the supervisor recorded something else, the employee cannot overwrite it.
  INSERT INTO public.overtime_outcomes (response_id, outcome, recorded_by, recorded_at)
  VALUES (r3, 'attended', u1, now());
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = r3;
  PERFORM pg_temp.as_user(u3);
  PERFORM pg_temp.expect_refused('a recorded outcome cannot be overwritten',
    format('select * from public.cancel_my_overtime(%L)', ask), 'already recorded');

  -- 6. Inside the late-cancellation window the outcome says so.
  UPDATE public.overtime_rules SET late_cancel_hours = 4 WHERE id;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, created_by)
  VALUES (current_date, to_char(now() + interval '1 hour', 'HH24:MI'), to_char(now() + interval '9 hours', 'HH24:MI'),
          1, 'Production', u1) RETURNING id INTO ask2;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at)
  VALUES (ask2, e2, 'yes', 'accepted', now()) RETURNING id INTO r4;
  PERFORM pg_temp.as_user(u2);
  SELECT outcome INTO v_outcome FROM public.cancel_my_overtime(ask2);
  PERFORM pg_temp.expect_true('close to the shift it counts as late', v_outcome = 'cancelled_late');
END $$;

ROLLBACK;
SELECT 'ALL TESTS PASSED' AS result;
