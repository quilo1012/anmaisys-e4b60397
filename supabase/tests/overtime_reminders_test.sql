-- Tests for the overtime reminders (BLOCO 133): who is reminded, when, and only once.
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 133. One transaction,
-- its own throwaway people and asks, ROLLBACK at the end. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case. It must run as a role
-- that bypasses RLS (the SQL editor's postgres role does).
--
-- overtime_reminders_due(p_now) takes the clock as an argument, so every case below
-- fixes its own "now" and does not depend on when the file is run. None of the
-- throwaway logins has a push subscription, so notification_push returns before it
-- calls anything: no phone is buzzed by running this.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.reminders(_ask uuid, _kind text) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications WHERE overtime_request_id = _ask AND kind = _kind
$$;

DO $$
DECLARE
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid()];
  e uuid[] := '{}';
  e_nologin uuid;
  new_e uuid;
  i int;
  creator uuid;
  area uuid;
  a_main uuid; a_moved uuid; a_called_off uuid; a_ended uuid; a_autumn uuid; a_spring uuid;
  r_ended uuid;
  s timestamptz;     -- the start of the ask under test
  n int;
  v_body text;
BEGIN
  FOR i IN 1..5 LOOP
    INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
      (u[i], 'zz-' || u[i] || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
    VALUES ('ZZ Reminder ' || i, 'Production', 'Day', true, u[i]) RETURNING id INTO new_e;
    e := e || new_e;
  END LOOP;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Reminder no login', 'Production', 'Day', true, null) RETURNING id INTO e_nologin;
  creator := u[1];

  -- ── The main ask: Saturday 14/11/2026 06:00–18:00 (GMT, so 06:00Z) ──────────────
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, created_by)
  VALUES ('2026-11-14', '06:00', '18:00', 5, 'Production', creator) RETURNING id INTO a_main;
  s := '2026-11-14 06:00+00';

  -- e1 booked days before; e2 a reserve; e3 declined; e5 booked inside the 24h window;
  -- the employee with no login booked. (Rows written straight, with the triggers'
  -- side effects being irrelevant here: only the reminders are under test.)
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at, decided_at) VALUES
    (a_main, e[1], 'yes', 'accepted', s - interval '4 days', s - interval '4 days'),
    (a_main, e[2], 'yes', 'reserve',  s - interval '4 days', s - interval '4 days'),
    (a_main, e[3], 'yes', 'declined', s - interval '4 days', s - interval '4 days'),
    (a_main, e[5], 'yes', 'accepted', s - interval '18 hours', s - interval '18 hours'),
    (a_main, e_nologin, 'yes', 'accepted', s - interval '4 days', s - interval '4 days');

  -- e1 has been placed on the board, on an area; e5 has not.
  INSERT INTO public.headcount_areas (name, section, kind)
  VALUES ('ZZ Capsules Line', 'production', 'production') RETURNING id INTO area;
  -- The board bridge may already have drawn e1's row (area empty); place it on the line.
  UPDATE public.daily_allocations SET area_id = area
   WHERE overtime_request_id = a_main AND employee_id = e[1];
  IF NOT FOUND THEN
    INSERT INTO public.daily_allocations (on_date, shift, employee_id, status, area_id, is_leader, overtime_request_id)
    VALUES ('2026-11-14', public.overtime_board_shift('2026-11-14', '06:00'), e[1], 'overtime', area, false, a_main);
  END IF;

  -- 1. Too early: nothing.
  PERFORM public.overtime_reminders_due(s - interval '25 hours');
  PERFORM pg_temp.expect_true('nothing 25 hours before', pg_temp.reminders(a_main, 'overtime_reminder_24h') = 0);

  -- 2. Inside the 24h window: only e1 (e5 was booked inside it; e2, e3 are not booked;
  --    the employee with no login has nobody to tell).
  PERFORM public.overtime_reminders_due(s - interval '23 hours');
  PERFORM pg_temp.expect_true('24h reminder for the booked person only',
    pg_temp.reminders(a_main, 'overtime_reminder_24h') = 1
    AND EXISTS (SELECT 1 FROM public.notifications WHERE overtime_request_id = a_main
                AND kind = 'overtime_reminder_24h' AND user_id = u[1]));

  -- 3. Once: the same moment again, and every five minutes after, write nothing new.
  PERFORM public.overtime_reminders_due(s - interval '23 hours');
  PERFORM public.overtime_reminders_due(s - interval '22 hours 55 minutes');
  PERFORM public.overtime_reminders_due(s - interval '3 hours');
  PERFORM pg_temp.expect_true('24h reminder written once', pg_temp.reminders(a_main, 'overtime_reminder_24h') = 1);

  -- 4. The text: date, hours, shift and the board area; never the department.
  SELECT body INTO v_body FROM public.notifications
   WHERE overtime_request_id = a_main AND kind = 'overtime_reminder_24h' AND user_id = u[1];
  PERFORM pg_temp.expect_true('body names date, hours, shift and area: ' || coalesce(v_body, '<null>'),
    v_body = 'Sat 14/11 · 06:00–18:00 · Day shift · ZZ Capsules Line');

  -- 5. Inside the 2h window: e1 and e5 (booked 18 hours before, so before this window).
  PERFORM public.overtime_reminders_due(s - interval '1 hour');
  PERFORM pg_temp.expect_true('2h reminder for both booked people',
    pg_temp.reminders(a_main, 'overtime_reminder_2h') = 2);
  SELECT body INTO v_body FROM public.notifications
   WHERE overtime_request_id = a_main AND kind = 'overtime_reminder_2h' AND user_id = u[5];
  PERFORM pg_temp.expect_true('no area, no department, when not placed on the board: ' || coalesce(v_body, '<null>'),
    v_body = 'Sat 14/11 · 06:00–18:00 · Day shift');

  -- 6. After the start: nothing more, ever.
  SELECT count(*) INTO n FROM public.notifications WHERE overtime_request_id = a_main;
  PERFORM public.overtime_reminders_due(s + interval '1 minute');
  PERFORM public.overtime_reminders_due(s + interval '3 hours');
  PERFORM pg_temp.expect_true('nothing after the shift has started',
    (SELECT count(*) FROM public.notifications WHERE overtime_request_id = a_main) = n);

  -- 7. A reserve promoted inside the 2h window gets nothing for it: "You're booked" just came.
  UPDATE public.overtime_responses SET decision = 'accepted', decided_at = s - interval '30 minutes'
   WHERE request_id = a_main AND employee_id = e[2];
  PERFORM public.overtime_reminders_due(s - interval '20 minutes');
  PERFORM pg_temp.expect_true('a promotion inside the window is not reminded at once',
    NOT EXISTS (SELECT 1 FROM public.notifications WHERE overtime_request_id = a_main AND user_id = u[2]
                AND kind LIKE 'overtime_reminder_%'));

  -- ── Moved: an overnight Night shift, Fri 20/11 22:00–06:00, moved to 20:00 ──────
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, created_by)
  VALUES ('2026-11-20', '22:00', '06:00', 1, 'Production', creator) RETURNING id INTO a_moved;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at, decided_at)
  VALUES (a_moved, e[1], 'yes', 'accepted', '2026-11-10', '2026-11-10');
  s := '2026-11-20 22:00+00';

  PERFORM public.overtime_reminders_due(s - interval '23 hours');
  SELECT body INTO v_body FROM public.notifications WHERE overtime_request_id = a_moved AND kind = 'overtime_reminder_24h';
  PERFORM pg_temp.expect_true('overnight shift: starts on its date, Night: ' || coalesce(v_body, '<null>'),
    v_body = 'Fri 20/11 · 22:00–06:00 · Night shift');

  -- 8. Moving the hours deletes the old reminder, and the new hours are reminded afresh.
  UPDATE public.overtime_requests SET starts_at = '20:00' WHERE id = a_moved;
  PERFORM pg_temp.expect_true('moving the ask deletes its reminders',
    pg_temp.reminders(a_moved, 'overtime_reminder_24h') = 0);
  s := '2026-11-20 20:00+00';
  PERFORM public.overtime_reminders_due(s - interval '23 hours');
  SELECT body INTO v_body FROM public.notifications WHERE overtime_request_id = a_moved AND kind = 'overtime_reminder_24h';
  PERFORM pg_temp.expect_true('the new hours are reminded: ' || coalesce(v_body, '<null>'),
    v_body = 'Fri 20/11 · 20:00–06:00 · Night shift');

  -- ── Called off ────────────────────────────────────────────────────────────────
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, created_by)
  VALUES ('2026-11-21', '06:00', '14:00', 1, 'Production', creator) RETURNING id INTO a_called_off;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at, decided_at)
  VALUES (a_called_off, e[1], 'yes', 'accepted', '2026-11-10', '2026-11-10');
  s := '2026-11-21 06:00+00';
  PERFORM public.overtime_reminders_due(s - interval '23 hours');
  PERFORM pg_temp.expect_true('reminded before it was called off', pg_temp.reminders(a_called_off, 'overtime_reminder_24h') = 1);

  -- 9. Calling it off deletes the reminder, and nothing more is written.
  UPDATE public.overtime_requests SET status = 'cancelled' WHERE id = a_called_off;
  PERFORM pg_temp.expect_true('calling the ask off deletes its reminders', pg_temp.reminders(a_called_off, 'overtime_reminder_24h') = 0);
  PERFORM public.overtime_reminders_due(s - interval '1 hour');
  PERFORM pg_temp.expect_true('a cancelled ask is never reminded',
    pg_temp.reminders(a_called_off, 'overtime_reminder_24h') + pg_temp.reminders(a_called_off, 'overtime_reminder_2h') = 0);

  -- 10. 'closed' only stops new answers: the booking stands and is reminded.
  UPDATE public.overtime_requests SET status = 'closed' WHERE id = a_moved;
  PERFORM public.overtime_reminders_due('2026-11-20 19:00+00');
  PERFORM pg_temp.expect_true('a closed ask still reminds its bookings', pg_temp.reminders(a_moved, 'overtime_reminder_2h') = 1);

  -- ── A booking that ended (the person cancelled) ───────────────────────────────
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, created_by)
  VALUES ('2026-11-22', '06:00', '14:00', 1, 'Production', creator) RETURNING id INTO a_ended;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at, decided_at)
  VALUES (a_ended, e[4], 'yes', 'accepted', '2026-11-10', '2026-11-10') RETURNING id INTO r_ended;
  s := '2026-11-22 06:00+00';
  PERFORM public.overtime_reminders_due(s - interval '23 hours');
  PERFORM pg_temp.expect_true('reminded while booked', pg_temp.reminders(a_ended, 'overtime_reminder_24h') = 1);

  -- 11. The outcome removes the unread reminder; a cancelled booking keeps
  --     decision = 'accepted' on purpose, and is still never reminded again.
  INSERT INTO public.overtime_outcomes (response_id, outcome, recorded_by) VALUES (r_ended, 'cancelled_in_time', u[4]);
  PERFORM pg_temp.expect_true('an ended booking loses its unread reminder', pg_temp.reminders(a_ended, 'overtime_reminder_24h') = 0);
  PERFORM public.overtime_reminders_due(s - interval '1 hour');
  PERFORM pg_temp.expect_true('a cancelled booking is never reminded',
    pg_temp.reminders(a_ended, 'overtime_reminder_24h') + pg_temp.reminders(a_ended, 'overtime_reminder_2h') = 0);

  -- ── Clock changes ─────────────────────────────────────────────────────────────
  -- 12. Autumn: the clocks go back at 02:00 BST on Sun 25/10/2026. A 06:00 start that
  --     day is 06:00Z; its 24h window opens at 06:00Z on Saturday, which was 07:00 BST.
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, created_by)
  VALUES ('2026-10-25', '06:00', '14:00', 1, 'Production', creator) RETURNING id INTO a_autumn;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at, decided_at)
  VALUES (a_autumn, e[1], 'yes', 'accepted', '2026-10-01', '2026-10-01');
  PERFORM public.overtime_reminders_due('2026-10-24 05:59+00');
  PERFORM pg_temp.expect_true('autumn: not before 06:00Z the day before', pg_temp.reminders(a_autumn, 'overtime_reminder_24h') = 0);
  PERFORM public.overtime_reminders_due('2026-10-24 06:01+00');
  PERFORM pg_temp.expect_true('autumn: from 06:00Z the day before', pg_temp.reminders(a_autumn, 'overtime_reminder_24h') = 1);
  PERFORM public.overtime_reminders_due('2026-10-25 03:59+00');
  PERFORM pg_temp.expect_true('autumn: 2h window not before 04:00Z', pg_temp.reminders(a_autumn, 'overtime_reminder_2h') = 0);
  PERFORM public.overtime_reminders_due('2026-10-25 04:01+00');
  PERFORM pg_temp.expect_true('autumn: 2h window from 04:00Z', pg_temp.reminders(a_autumn, 'overtime_reminder_2h') = 1);

  -- 13. Spring: the clocks go forward at 01:00 GMT on Sun 29/03/2026. A 06:00 start
  --     that day is 06:00 BST = 05:00Z; its 2h window opens at 03:00Z.
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, created_by)
  VALUES ('2026-03-29', '06:00', '14:00', 1, 'Production', creator) RETURNING id INTO a_spring;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision, answered_at, decided_at)
  VALUES (a_spring, e[1], 'yes', 'accepted', '2026-03-01', '2026-03-01');
  PERFORM public.overtime_reminders_due('2026-03-29 02:59+00');
  PERFORM pg_temp.expect_true('spring: 2h window not before 03:00Z', pg_temp.reminders(a_spring, 'overtime_reminder_2h') = 0);
  PERFORM public.overtime_reminders_due('2026-03-29 03:01+00');
  PERFORM pg_temp.expect_true('spring: 2h window from 03:00Z', pg_temp.reminders(a_spring, 'overtime_reminder_2h') = 1);
  -- (Nothing ran in its 24h window until 02:59Z, so the 24h reminder went out late
  --  then, still inside its own window — never after it.)
  SELECT count(*) INTO n FROM public.notifications WHERE overtime_request_id = a_spring;
  PERFORM public.overtime_reminders_due('2026-03-29 05:01+00');
  PERFORM pg_temp.expect_true('spring: nothing after 05:00Z (06:00 BST)',
    (SELECT count(*) FROM public.notifications WHERE overtime_request_id = a_spring) = n);

  -- 14. Every reminder points at the ask and is high priority.
  PERFORM pg_temp.expect_true('reminders link to My Overtime for their ask',
    NOT EXISTS (SELECT 1 FROM public.notifications
                 WHERE kind LIKE 'overtime_reminder_%'
                   AND overtime_request_id IN (a_main, a_moved, a_autumn, a_spring)
                   AND (action_url <> '/dashboard/my-overtime?ask=' || overtime_request_id OR priority <> 'high')));
END $$;

-- 15. Nobody but the database may call it.
SELECT pg_temp.expect_true('authenticated cannot run the reminders',
  NOT has_function_privilege('authenticated', 'public.overtime_reminders_due(timestamptz)', 'EXECUTE'));
SELECT pg_temp.expect_true('anon cannot run the reminders',
  NOT has_function_privilege('anon', 'public.overtime_reminders_due(timestamptz)', 'EXECUTE'));

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
