-- Tests for the Overtime → Board bridge (#3): the whole state machine.
--
-- Run this WHOLE file in one go, in the Supabase SQL Editor, after
-- 20261007120000_an_accepted_ask_reaches_the_board.sql has been applied. It opens a
-- transaction, seeds its own throwaway people, asks and board rows, asserts, and
-- ROLLBACKs: nothing survives it. The last statement prints 'ALL TESTS PASSED'; any
-- failure raises and aborts before it, naming the case.
--
-- The two cases that matter most are the ones about things this flow does NOT own: a
-- row a planner made by hand for the same person on the same day, and another ask's
-- rows. Deleting either would be the worst bug this bridge could have, so they are
-- asserted on their own rather than left to follow from the design.
--
-- On the reserve: `record_overtime_outcome` promotes the longest-waiting reserve by
-- updating `overtime_responses.decision` to 'accepted' (migration …212000, line 65).
-- This file makes that same update directly rather than calling the RPC, so the test
-- does not have to carry that function's permission model — what it proves is that
-- the trigger fires on the update the promotion performs, which is the thing in
-- question.
--
-- It must run as a role that bypasses RLS (the SQL Editor's postgres role does).

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

DO $$
DECLARE
  v_creator uuid;
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  e_a uuid; e_b uuid; e_manual uuid; e_booked uuid;
  ask_1 uuid; ask_2 uuid;
  resp_a uuid; resp_b uuid; resp_2 uuid;
  the_shift text;
  n int;
BEGIN
  -- `overtime_requests.created_by` is `not null references auth.users(id)`, so the
  -- ask needs a real owner. Any existing login will do — the tests never read it, and
  -- borrowing one is cheaper than creating an auth identity that must then be undone.
  -- This is the ONE thing in this file that depends on data already in the database.
  SELECT id INTO v_creator FROM auth.users LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No auth.users row exists to own the test ask';
  END IF;

  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Bridge A', 'Production', 'Day', true, u_a) RETURNING id INTO e_a;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Bridge B', 'Production', 'Day', true, u_b) RETURNING id INTO e_b;
  INSERT INTO public.employees (full_name, department, shift_group, active)
  VALUES ('ZZ Bridge Manual', 'Production', 'Day', true) RETURNING id INTO e_manual;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Bridge Booked Off', 'Production', 'Day', true, gen_random_uuid())
  RETURNING id INTO e_booked;

  INSERT INTO public.overtime_requests
    (on_date, starts_at, ends_at, headcount, department, shift_group, status, created_by)
  VALUES (current_date + 30, '06:00', '14:00', 4, NULL, NULL, 'open', v_creator)
  RETURNING id INTO ask_1;
  INSERT INTO public.overtime_requests
    (on_date, starts_at, ends_at, headcount, department, shift_group, status, created_by)
  VALUES (current_date + 30, '06:00', '14:00', 4, NULL, NULL, 'open', v_creator)
  RETURNING id INTO ask_2;

  the_shift := public.overtime_board_shift(current_date + 30, '06:00');
  PERFORM pg_temp.expect_true('06:00 is the Day board', the_shift = 'Day');
  PERFORM pg_temp.expect_true('19:00 is the Night board',
    public.overtime_board_shift(current_date + 30, '19:00') = 'Night');

  -- A manual row the planner made, for a third person, on the same day and board.
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (current_date + 30, the_shift, e_manual, 'assigned');

  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (ask_1, e_a, 'yes') RETURNING id INTO resp_a;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (ask_1, e_b, 'yes') RETURNING id INTO resp_b;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (ask_2, e_a, 'yes') RETURNING id INTO resp_2;

  -- Saying yes is not being on the board.
  SELECT count(*) INTO n FROM public.daily_allocations WHERE overtime_request_id IS NOT NULL;
  PERFORM pg_temp.expect_true('an answer alone puts nobody on the board', n = 0);

  -- accepted → creates
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = resp_a;
  SELECT count(*) INTO n FROM public.daily_allocations
   WHERE overtime_request_id = ask_1 AND employee_id = e_a AND status = 'overtime';
  PERFORM pg_temp.expect_true('accepted creates the allocation', n = 1);

  -- and the payroll mirror follows it
  SELECT count(*) INTO n FROM public.employee_attendance
   WHERE employee_id = e_a AND on_date = current_date + 30 AND status = 'present';
  PERFORM pg_temp.expect_true('accepted reaches employee_attendance', n = 1);

  -- accepted again → no duplicate
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = resp_a;
  SELECT count(*) INTO n FROM public.daily_allocations WHERE overtime_request_id = ask_1 AND employee_id = e_a;
  PERFORM pg_temp.expect_true('accepting twice leaves one allocation', n = 1);

  -- declined → removes only this one
  UPDATE public.overtime_responses SET decision = 'declined' WHERE id = resp_a;
  SELECT count(*) INTO n FROM public.daily_allocations WHERE overtime_request_id = ask_1 AND employee_id = e_a;
  PERFORM pg_temp.expect_true('declined removes the allocation', n = 0);

  -- reserve → also off the board
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = resp_a;
  UPDATE public.overtime_responses SET decision = 'reserve'  WHERE id = resp_a;
  SELECT count(*) INTO n FROM public.daily_allocations WHERE overtime_request_id = ask_1 AND employee_id = e_a;
  PERFORM pg_temp.expect_true('reserve is not on the board', n = 0);

  -- the reserve promoted: decision goes back to accepted, exactly as the RPC does
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = resp_a;
  SELECT count(*) INTO n FROM public.daily_allocations WHERE overtime_request_id = ask_1 AND employee_id = e_a;
  PERFORM pg_temp.expect_true('a promoted reserve reaches the board', n = 1);

  -- decision back to NULL is not a decision, so it is not a place on the board. This
  -- is the branch the bare `new.decision = 'accepted'` skipped entirely: null is not
  -- false, so the guard was neither taken nor refused and the insert ran anyway.
  UPDATE public.overtime_responses SET decision = NULL WHERE id = resp_a;
  SELECT count(*) INTO n FROM public.daily_allocations
   WHERE overtime_request_id = ask_1 AND employee_id = e_a;
  PERFORM pg_temp.expect_true('undoing the decision takes them off the board', n = 0);
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = resp_a;

  -- And a fresh answer with no decision at all never reaches the board: the whole
  -- point of hanging this on the decision rather than on the answer.
  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (ask_2, e_manual, 'yes');
  SELECT count(*) INTO n FROM public.daily_allocations
   WHERE overtime_request_id = ask_2 AND employee_id = e_manual;
  PERFORM pg_temp.expect_true('a brand new yes is not on the board', n = 0);

  -- two people, one ask, two rows
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = resp_b;
  SELECT count(*) INTO n FROM public.daily_allocations WHERE overtime_request_id = ask_1;
  PERFORM pg_temp.expect_true('two accepted people are two rows', n = 2);

  -- the other ask, accepted too
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = resp_2;

  -- cancelling ask_1 takes ask_1's rows and nothing else
  UPDATE public.overtime_requests SET status = 'cancelled' WHERE id = ask_1;
  SELECT count(*) INTO n FROM public.daily_allocations WHERE overtime_request_id = ask_1;
  PERFORM pg_temp.expect_true('cancelling removes this ask''s rows', n = 0);
  SELECT count(*) INTO n FROM public.daily_allocations WHERE overtime_request_id = ask_2;
  PERFORM pg_temp.expect_true('cancelling one ask leaves another ask alone', n = 1);

  -- THE ONE THAT MATTERS: the planner's row is untouched
  SELECT count(*) INTO n FROM public.daily_allocations
   WHERE employee_id = e_manual AND on_date = current_date + 30 AND overtime_request_id IS NULL;
  PERFORM pg_temp.expect_true('a manual allocation survives the cancellation', n = 1);

  -- A cancelled ask accepts nobody, even if a decision is written afterwards
  UPDATE public.overtime_responses SET decision = NULL     WHERE id = resp_b;
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = resp_b;
  SELECT count(*) INTO n FROM public.daily_allocations WHERE overtime_request_id = ask_1;
  PERFORM pg_temp.expect_true('a cancelled ask takes nobody back', n = 0);

  -- And a manual row for the SAME person the ask accepts is never stamped or stolen
  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (current_date + 30, the_shift, e_b, 'assigned');
  UPDATE public.overtime_responses SET decision = 'accepted' WHERE id = resp_2;
  SELECT count(*) INTO n FROM public.daily_allocations
   WHERE employee_id = e_b AND on_date = current_date + 30 AND shift = the_shift;
  PERFORM pg_temp.expect_true('the person already on the board keeps one row', n = 1);
  SELECT count(*) INTO n FROM public.daily_allocations
   WHERE employee_id = e_b AND on_date = current_date + 30 AND status = 'assigned'
     AND overtime_request_id IS NULL;
  PERFORM pg_temp.expect_true('and it is still the planner''s row, unstamped', n = 1);

  -- ── employee_attendance: what the overtime flow may and may not do to payroll ──
  -- The board can be rewritten all morning; a payroll record is a statement somebody
  -- made about a person's day, and the only safe automatic action on one is to add
  -- the one that is missing.

  -- (2) An attendance row that already exists is left exactly as it was. A booked
  -- holiday is not this trigger's to overwrite — somebody both booked off and
  -- accepted for overtime is a question for a human, not a silent 'present'.
  INSERT INTO public.employee_attendance (employee_id, on_date, status)
  VALUES (e_booked, current_date + 30, 'holiday');

  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (ask_2, e_booked, 'yes');
  UPDATE public.overtime_responses SET decision = 'accepted'
   WHERE request_id = ask_2 AND employee_id = e_booked;

  SELECT count(*) INTO n FROM public.employee_attendance
   WHERE employee_id = e_booked AND on_date = current_date + 30 AND status = 'holiday';
  PERFORM pg_temp.expect_true('an existing attendance row is left exactly as it was', n = 1);
  SELECT count(*) INTO n FROM public.employee_attendance
   WHERE employee_id = e_booked AND on_date = current_date + 30;
  PERFORM pg_temp.expect_true('and it is still the only one', n = 1);

  -- (3) Coming off the board does not take the payroll record with it. Deleting one
  -- automatically is how an audited figure disappears with nobody's name on the act.
  UPDATE public.overtime_responses SET decision = 'declined'
   WHERE request_id = ask_2 AND employee_id = e_a;
  SELECT count(*) INTO n FROM public.daily_allocations
   WHERE overtime_request_id = ask_2 AND employee_id = e_a;
  PERFORM pg_temp.expect_true('declining takes the allocation', n = 0);
  SELECT count(*) INTO n FROM public.employee_attendance
   WHERE employee_id = e_a AND on_date = current_date + 30 AND status = 'present';
  PERFORM pg_temp.expect_true('but the attendance row stays for a human to settle', n = 1);

  -- (4) A promoted reserve gets their own attendance, like anybody else accepted.
  UPDATE public.overtime_responses SET decision = 'reserve'
   WHERE request_id = ask_2 AND employee_id = e_a;
  UPDATE public.overtime_responses SET decision = 'accepted'
   WHERE request_id = ask_2 AND employee_id = e_a;
  SELECT count(*) INTO n FROM public.employee_attendance
   WHERE employee_id = e_a AND on_date = current_date + 30 AND status = 'present';
  PERFORM pg_temp.expect_true('a promoted reserve has their attendance', n = 1);

  -- (5) Nothing the overtime flow does touches an attendance row belonging to another
  -- day or another person. Cancelling the whole ask is the widest action it has.
  UPDATE public.overtime_requests SET status = 'cancelled' WHERE id = ask_2;
  SELECT count(*) INTO n FROM public.employee_attendance
   WHERE employee_id = e_booked AND on_date = current_date + 30 AND status = 'holiday';
  PERFORM pg_temp.expect_true('cancelling the ask leaves another context''s attendance', n = 1);
  SELECT count(*) INTO n FROM public.employee_attendance
   WHERE employee_id = e_a AND on_date = current_date + 30;
  PERFORM pg_temp.expect_true('and leaves the accepted person''s attendance too', n = 1);
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
