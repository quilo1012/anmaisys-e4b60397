-- Tests for 20261018110000_overtime_keeps_its_own_record.sql (BLOCO 98).
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after that block has been
-- applied. Same shape as overtime_schedule_clash_test.sql: one transaction, its own
-- throwaway logins, people and asks, calls the functions the way the phone and the
-- supervisor's screen call them, and ROLLBACKs. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case.
--
-- WHY THIS FILE EXISTS. theOvertimeAuditIsAppendOnly.test.ts reads the migration's
-- text. It proves the policy and the triggers are written; it cannot prove that an
-- answer given on the phone lands as a row, that a sickness note stays out of it, or
-- that one employee's session is refused another's history. This does.
--
-- It must run as a role that bypasses RLS and may SET ROLE authenticated (the SQL
-- Editor's postgres role does).

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

-- How many audit rows this session can see about these people. Runs as
-- `authenticated`, so the policy decides, and goes back to the caller's role after.
CREATE FUNCTION pg_temp.visible(_user uuid, _employees uuid[], _event text DEFAULT NULL)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.as_user(_user);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.overtime_audit
   WHERE employee_id = ANY(_employees) AND (_event IS NULL OR event_type = _event);
  RESET ROLE;
  RETURN n;
END $$;

DO $$
DECLARE
  u_emp  uuid := gen_random_uuid();   -- the employee whose history this is
  u_peer uuid := gen_random_uuid();   -- somebody else on the same ask
  u_mgr  uuid := gen_random_uuid();   -- a manager, who runs overtime
  e_emp uuid; e_peer uuid;
  ask_a uuid;    -- answered yes, assigned, then cancelled by the person
  ask_b uuid;    -- answered yes, assigned, then called sick
  ask_c uuid;    -- answered no
  ask_d uuid;    -- a past ask, kept as history
  resp_a uuid; resp_b uuid; resp_c uuid; resp_peer uuid;
  ahead date := current_date + 21;
  n int;
  r record;
  msg text;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_emp, u_peer, u_mgr]) u;
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_emp, 'employee'), (u_peer, 'employee'), (u_mgr, 'manager');

  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Audit Employee', 'Production', 'Night', true, u_emp) RETURNING id INTO e_emp;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Audit Peer', 'Production', 'Night', true, u_peer) RETURNING id INTO e_peer;

  -- Asks made by the manager's session, as the supervisor's screen makes them.
  PERFORM pg_temp.as_user(u_mgr);
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (ahead, '06:00', '14:00', 2, 'open', u_mgr) RETURNING id INTO ask_a;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (ahead + 1, '06:00', '14:00', 2, 'open', u_mgr) RETURNING id INTO ask_b;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (ahead + 2, '06:00', '14:00', 2, 'open', u_mgr) RETURNING id INTO ask_c;

  PERFORM pg_temp.expect_true('creating an ask is recorded, with the manager as a supervisor',
    EXISTS (SELECT 1 FROM public.overtime_audit
             WHERE request_id = ask_a AND event_type = 'opportunity_created'
               AND actor_id = u_mgr AND actor_kind = 'supervisor'));

  -- ── Acceptance: the employee says yes on the phone ─────────────────────────
  PERFORM pg_temp.as_user(u_emp);
  PERFORM public.answer_overtime(ask_a, 'yes');
  PERFORM public.answer_overtime(ask_b, 'yes');
  SELECT id INTO resp_a FROM public.overtime_responses WHERE request_id = ask_a AND employee_id = e_emp;
  SELECT id INTO resp_b FROM public.overtime_responses WHERE request_id = ask_b AND employee_id = e_emp;

  SELECT * INTO r FROM public.overtime_audit WHERE response_id = resp_a AND event_type = 'answered_yes';
  PERFORM pg_temp.expect_true('a yes on the phone is recorded', r.id IS NOT NULL);
  PERFORM pg_temp.expect_true('the yes names the employee and the ask''s date and hours',
    r.employee_id = e_emp AND r.on_date = ahead AND r.starts_at = '06:00' AND r.ends_at = '14:00'
    AND r.shift = 'Day');
  PERFORM pg_temp.expect_true('the yes is the employee''s own, from the employee app',
    r.actor_id = u_emp AND r.actor_kind = 'employee' AND r.source = 'employee_app');

  -- ── Decline: the employee says no ──────────────────────────────────────────
  PERFORM public.answer_overtime(ask_c, 'no');
  SELECT id INTO resp_c FROM public.overtime_responses WHERE request_id = ask_c AND employee_id = e_emp;
  PERFORM pg_temp.expect_true('a no is recorded as a no',
    EXISTS (SELECT 1 FROM public.overtime_audit
             WHERE response_id = resp_c AND event_type = 'answered_no' AND actor_id = u_emp));

  -- A changed mind keeps both answers: the record is not the current state.
  PERFORM public.answer_overtime(ask_c, 'yes');
  SELECT * INTO r FROM public.overtime_audit
   WHERE response_id = resp_c AND event_type = 'answered_yes';
  PERFORM pg_temp.expect_true('changing a no to a yes adds a row, old beside new',
    r.old_value ->> 'answer' = 'no' AND r.new_value ->> 'answer' = 'yes');
  SELECT count(*) INTO n FROM public.overtime_audit WHERE response_id = resp_c;
  PERFORM pg_temp.expect_true('and the original no is still there', n = 2);

  -- The peer answers too, so there is somebody else's history to keep private.
  PERFORM pg_temp.as_user(u_peer);
  PERFORM public.answer_overtime(ask_a, 'yes');
  SELECT id INTO resp_peer FROM public.overtime_responses WHERE request_id = ask_a AND employee_id = e_peer;

  -- ── The supervisor assigns ─────────────────────────────────────────────────
  PERFORM pg_temp.as_user(u_mgr);
  UPDATE public.overtime_responses SET decision = 'accepted', decided_by = u_mgr, decided_at = now()
   WHERE id IN (resp_a, resp_b, resp_peer);
  PERFORM pg_temp.expect_true('assigning is recorded against the employee, by the supervisor',
    EXISTS (SELECT 1 FROM public.overtime_audit
             WHERE response_id = resp_a AND event_type = 'assigned' AND employee_id = e_emp
               AND actor_id = u_mgr AND source = 'supervisor_interface'));

  -- Accepted overtime is planned, not attendance: the board row says overtime.
  SELECT count(*) INTO n FROM public.daily_allocations
   WHERE employee_id = e_emp AND on_date = ahead AND status = 'present';
  PERFORM pg_temp.expect_true('an accepted ask does not mark the person present', n = 0);

  -- ── Cancellation ───────────────────────────────────────────────────────────
  PERFORM public.record_overtime_outcome(resp_a, 'cancelled', 'rang the office');
  SELECT * INTO r FROM public.overtime_audit WHERE response_id = resp_a AND event_type = 'employee_cancelled';
  PERFORM pg_temp.expect_true('a cancellation is recorded, in time three weeks ahead',
    r.id IS NOT NULL AND r.new_value ->> 'outcome' = 'cancelled_in_time' AND r.note = 'rang the office');

  -- ── Sickness: the outcome, and a sick day on the board ────────────────────
  PERFORM public.record_overtime_outcome(resp_b, 'called_sick', 'migraine, GP letter to follow');
  SELECT * INTO r FROM public.overtime_audit WHERE response_id = resp_b AND event_type = 'called_sick';
  PERFORM pg_temp.expect_true('calling in sick is recorded', r.id IS NOT NULL);
  PERFORM pg_temp.expect_true('the sickness note is not copied, only that one exists',
    r.note IS NULL AND (r.new_value ->> 'note_recorded')::boolean
    AND position('migraine' in coalesce(r.new_value::text, '') || coalesce(r.old_value::text, '')) = 0);

  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (ahead + 1, 'Night', e_emp, 'sick');
  -- ask_b was accepted and then called sick, so the outcome above did not remove the
  -- decision; a sick day on that date is the board affecting accepted overtime.
  SELECT * INTO r FROM public.overtime_audit
   WHERE employee_id = e_emp AND event_type = 'absence_affects_overtime';
  PERFORM pg_temp.expect_true('a sick day on a date with accepted overtime is recorded, as the word only',
    r.id IS NOT NULL AND r.request_id = ask_b AND r.new_value ->> 'board_status' = 'sick');

  -- ── Append-only, even for the owner ────────────────────────────────────────
  BEGIN
    UPDATE public.overtime_audit SET note = 'rewritten' WHERE employee_id = e_emp;
    RAISE EXCEPTION 'FAILED the audit could be rewritten';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.overtime_audit WHERE employee_id = e_emp;
    RAISE EXCEPTION 'FAILED the audit could be deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- ── Who reads it ───────────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.overtime_audit WHERE employee_id = e_emp;
  PERFORM pg_temp.expect_true('the employee has rows to read', n >= 8);
  PERFORM pg_temp.expect_true('the employee reads all of their own history',
    pg_temp.visible(u_emp, ARRAY[e_emp]) = n);
  PERFORM pg_temp.expect_true('the employee reads none of the peer''s history',
    pg_temp.visible(u_emp, ARRAY[e_peer]) = 0);
  PERFORM pg_temp.expect_true('and the peer none of the employee''s',
    pg_temp.visible(u_peer, ARRAY[e_emp]) = 0);
  PERFORM pg_temp.as_user(u_emp);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.overtime_audit WHERE employee_id IS NULL;
  RESET ROLE;
  PERFORM pg_temp.expect_true('the employee reads no rows about nobody (asks, rules, access)', n = 0);
  PERFORM pg_temp.expect_true('the manager reads both',
    pg_temp.visible(u_mgr, ARRAY[e_emp]) > 0 AND pg_temp.visible(u_mgr, ARRAY[e_peer]) > 0);

  PERFORM pg_temp.as_user(u_emp);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.overtime_audit (event_type, employee_id, actor_kind, source)
    VALUES ('attended', e_emp, 'employee', 'employee_app');
    RAISE EXCEPTION 'FAILED an employee wrote their own audit row';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- ── History stays history ─────────────────────────────────────────────────
  -- An ask whose date has gone is not deleted to hide it: the phone filters it out
  -- (upcomingForMe), the table and the record keep it.
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (current_date - 14, '18:00', '06:00', 1, 'closed', u_mgr) RETURNING id INTO ask_d;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision)
  VALUES (ask_d, e_emp, 'yes', 'accepted');
  PERFORM pg_temp.expect_true('a past ask is still in the table',
    EXISTS (SELECT 1 FROM public.overtime_requests WHERE id = ask_d));
  SELECT * INTO r FROM public.overtime_audit WHERE request_id = ask_d AND event_type = 'assigned';
  PERFORM pg_temp.expect_true('and its record says Night, across midnight',
    r.shift = 'Night' AND r.starts_at = '18:00' AND r.ends_at = '06:00');
  PERFORM pg_temp.expect_true('and the employee can still read it',
    pg_temp.visible(u_emp, ARRAY[e_emp], 'assigned') >= 2);

  -- Deleting an ask keeps what it was.
  PERFORM pg_temp.as_user(u_mgr);
  DELETE FROM public.overtime_requests WHERE id = ask_c;
  SELECT * INTO r FROM public.overtime_audit WHERE request_id = ask_c AND event_type = 'opportunity_deleted';
  PERFORM pg_temp.expect_true('a deleted ask leaves its date and hours behind',
    r.on_date = ahead + 2 AND r.starts_at = '06:00');
  SELECT count(*) INTO n FROM public.overtime_audit WHERE response_id = resp_c;
  PERFORM pg_temp.expect_true('and the answers given to it survive it', n >= 2);
END $$;

SELECT 'ALL TESTS PASSED';
ROLLBACK;
