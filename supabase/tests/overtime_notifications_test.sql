-- Tests for 20261018130000_an_ask_rings_the_bell_of_who_can_take_it.sql (BLOCO 100).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCOS 95 and 100. One
-- transaction, its own throwaway people and asks, ROLLBACK at the end. The last
-- statement prints 'ALL TESTS PASSED'; any failure raises first, naming the case.
-- Every ask is on a Saturday at least a week ahead, except the one that must be past.
-- It must run as a role that bypasses RLS (the SQL editor's postgres role does); the
-- RLS cases switch to `authenticated` themselves.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.told(_user uuid, _ask uuid) RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications
   WHERE user_id = _user AND overtime_request_id = _ask AND kind = 'overtime_new';
$$;

CREATE TEMP TABLE zz_ids (k text PRIMARY KEY, v uuid);
GRANT SELECT ON zz_ids TO authenticated;

DO $$
DECLARE
  v_creator uuid;
  sat date := current_date + (((6 - extract(isodow from current_date)::int) + 7) % 7) + 7;
  p_mon_thu uuid;
  u_day uuid := gen_random_uuid();      -- Day crew, Mon–Thu: Saturday is free
  u_wkend uuid := gen_random_uuid();    -- Weekend crew: rostered on Saturday days
  u_night uuid := gen_random_uuid();    -- Night crew, on the board Friday night
  u_ware uuid := gen_random_uuid();     -- another department
  u_gone uuid := gen_random_uuid();     -- inactive
  u_block uuid := gen_random_uuid();    -- blocked for a no-show
  u_said uuid := gen_random_uuid();     -- already answered
  e_day uuid; e_wkend uuid; e_night uuid; e_ware uuid; e_gone uuid; e_block uuid; e_said uuid;
  ask_day uuid; ask_dawn uuid; ask_night uuid; ask_prod uuid; ask_cancel uuid; ask_past uuid;
  ask_widen uuid; ask_fail uuid; ask_missed uuid; resp uuid;
  n int; n2 int; r record;
BEGIN
  SELECT id INTO v_creator FROM auth.users LIMIT 1;
  IF v_creator IS NULL THEN RAISE EXCEPTION 'No auth.users row exists to own the test ask'; END IF;

  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_day, u_wkend, u_night, u_ware, u_gone, u_block, u_said]) u;

  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at)
  VALUES ('ZZ Test Mon-Thu', ARRAY[1,2,3,4]::smallint[], '06:00', '18:00')
  RETURNING id INTO p_mon_thu;

  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Day', 'Production', 'Day', p_mon_thu, true, u_day) RETURNING id INTO e_day;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Weekend', 'Production', 'Weekend', true, u_wkend) RETURNING id INTO e_wkend;
  INSERT INTO public.employees (full_name, department, shift_group, active, user_id)
  VALUES ('ZZ Night', 'Production', 'Night', true, u_night) RETURNING id INTO e_night;
  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Warehouse', 'Warehouse', 'Day', p_mon_thu, true, u_ware) RETURNING id INTO e_ware;
  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Gone', 'Production', 'Day', p_mon_thu, false, u_gone) RETURNING id INTO e_gone;
  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Blocked', 'Production', 'Day', p_mon_thu, true, u_block) RETURNING id INTO e_block;
  INSERT INTO public.employees (full_name, department, shift_group, shift_pattern_id, active, user_id)
  VALUES ('ZZ Said', 'Production', 'Day', p_mon_thu, true, u_said) RETURNING id INTO e_said;

  INSERT INTO public.daily_allocations (on_date, shift, employee_id, status)
  VALUES (sat - 1, 'Night', e_night, 'assigned');

  -- A no-show yesterday, with the block on: out for a week.
  UPDATE public.overtime_rules SET no_show_block_days = 7 WHERE id;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (current_date - 1, '06:00', '14:00', 1, 'closed', v_creator) RETURNING id INTO ask_missed;
  INSERT INTO public.overtime_responses (request_id, employee_id, answer, decision)
  VALUES (ask_missed, e_block, 'yes', 'accepted') RETURNING id INTO resp;
  INSERT INTO public.overtime_outcomes (response_id, outcome, recorded_by)
  VALUES (resp, 'no_show', v_creator);

  -- ── Who is told ────────────────────────────────────────────────────────────
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, status, created_by)
  VALUES (sat, '06:00', '18:00', 2, 'Production', 'open', v_creator) RETURNING id INTO ask_day;

  PERFORM pg_temp.expect_true('a Day-crew person free on Saturday is told',
    pg_temp.told(u_day, ask_day) = 1);
  PERFORM pg_temp.expect_true('the Weekend crew, rostered on those hours, is not',
    pg_temp.told(u_wkend, ask_day) = 0);
  PERFORM pg_temp.expect_true('another department is not',
    pg_temp.told(u_ware, ask_day) = 0);
  PERFORM pg_temp.expect_true('an inactive person is not',
    pg_temp.told(u_gone, ask_day) = 0);
  PERFORM pg_temp.expect_true('a blocked person is not',
    pg_temp.told(u_block, ask_day) = 0);

  SELECT * INTO r FROM public.notifications WHERE user_id = u_day AND overtime_request_id = ask_day;
  PERFORM pg_temp.expect_true('the bell says what and when',
    r.title = 'New overtime available'
    AND r.body LIKE 'Sat __/__ · Day · 06:00–18:00 · Production · need 2'
    AND r.action_url = '/dashboard/my-overtime?ask=' || ask_day
    AND r.read_at IS NULL);

  -- Overnight: Saturday 05:00 is still inside Friday's night shift.
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat, '05:00', '09:00', 2, 'open', v_creator) RETURNING id INTO ask_dawn;
  PERFORM pg_temp.expect_true('a dawn ask inside last night''s shift does not tell the night worker',
    pg_temp.told(u_night, ask_dawn) = 0);

  -- A night ask, across midnight, for somebody whose Saturday and Sunday are free.
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat, '18:00', '06:00', 2, 'open', v_creator) RETURNING id INTO ask_night;
  PERFORM pg_temp.expect_true('a night ask across midnight tells the free Day person',
    pg_temp.told(u_day, ask_night) = 1);
  SELECT body INTO r FROM public.notifications WHERE user_id = u_day AND overtime_request_id = ask_night;
  PERFORM pg_temp.expect_true('and calls it Night, 18:00–06:00',
    r.body LIKE 'Sat __/__ · Night · 18:00–06:00 · need 2');

  -- ── Nothing for what cannot be taken ──────────────────────────────────────
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat + 7, '06:00', '14:00', 1, 'cancelled', v_creator) RETURNING id INTO ask_cancel;
  SELECT count(*) INTO n FROM public.notifications WHERE overtime_request_id = ask_cancel;
  PERFORM pg_temp.expect_true('a cancelled ask tells nobody', n = 0);

  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (current_date - 1, '06:00', '14:00', 1, 'open', v_creator) RETURNING id INTO ask_past;
  SELECT count(*) INTO n FROM public.notifications WHERE overtime_request_id = ask_past;
  PERFORM pg_temp.expect_true('an ask already started tells nobody', n = 0);

  -- ── Once per person per ask ───────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.notifications WHERE overtime_request_id = ask_day;
  UPDATE public.overtime_requests SET starts_at = '07:00' WHERE id = ask_day;
  UPDATE public.overtime_requests SET starts_at = '06:00' WHERE id = ask_day;
  UPDATE public.overtime_requests SET status = 'closed' WHERE id = ask_day;
  UPDATE public.overtime_requests SET status = 'open' WHERE id = ask_day;
  UPDATE public.overtime_requests SET note = 'bring boots', headcount = 3 WHERE id = ask_day;
  SELECT count(*) INTO n2 FROM public.notifications WHERE overtime_request_id = ask_day;
  PERFORM pg_temp.expect_true('edits, a close and a reopen tell nobody twice', n2 = n);
  PERFORM pg_temp.expect_true('the Day person still has exactly one', pg_temp.told(u_day, ask_day) = 1);

  -- An answer given, then a reopen: the person who answered is not told again.
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, department, status, created_by)
  VALUES (sat + 7, '06:00', '14:00', 1, 'Warehouse', 'open', v_creator) RETURNING id INTO ask_widen;
  PERFORM pg_temp.expect_true('narrowed to Warehouse, Production is not told',
    pg_temp.told(u_day, ask_widen) = 0 AND pg_temp.told(u_said, ask_widen) = 0);
  INSERT INTO public.overtime_responses (request_id, employee_id, answer)
  VALUES (ask_widen, e_said, 'no');
  UPDATE public.overtime_requests SET department = NULL WHERE id = ask_widen;
  PERFORM pg_temp.expect_true('widened, the newly eligible are told',
    pg_temp.told(u_day, ask_widen) = 1);
  PERFORM pg_temp.expect_true('and somebody who already answered is not',
    pg_temp.told(u_said, ask_widen) = 0);

  -- ── The bell never costs the ask ──────────────────────────────────────────
  ALTER FUNCTION public.overtime_schedule_clash(uuid, uuid) RENAME TO zz_clash_away;
  INSERT INTO public.overtime_requests (on_date, starts_at, ends_at, headcount, status, created_by)
  VALUES (sat + 14, '06:00', '14:00', 1, 'open', v_creator) RETURNING id INTO ask_fail;
  ALTER FUNCTION public.zz_clash_away(uuid, uuid) RENAME TO overtime_schedule_clash;
  PERFORM pg_temp.expect_true('when telling fails, the ask is still saved',
    EXISTS (SELECT 1 FROM public.overtime_requests WHERE id = ask_fail));

  INSERT INTO zz_ids VALUES ('u_day', u_day), ('u_wkend', u_wkend), ('ask_day', ask_day),
                            ('ask_past', ask_past), ('e_day', e_day);
END $$;

-- ── Only your own, and only read_at ─────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM zz_ids WHERE k = 'u_day'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
  me uuid := (SELECT v FROM zz_ids WHERE k = 'u_day');
  ask uuid := (SELECT v FROM zz_ids WHERE k = 'ask_day');
  n int;
  ok boolean;
BEGIN
  SELECT count(*) INTO n FROM public.notifications WHERE user_id <> me;
  PERFORM pg_temp.expect_true('an employee reads no one else''s bell', n = 0);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = me;
  PERFORM pg_temp.expect_true('and reads their own', n >= 2);

  UPDATE public.notifications SET read_at = now() WHERE user_id = me AND overtime_request_id = ask;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.expect_true('marking one read works', n = 1);

  BEGIN
    UPDATE public.notifications SET title = 'You won a car' WHERE user_id = me;
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  PERFORM pg_temp.expect_true('rewriting the title is refused', ok);

  BEGIN
    INSERT INTO public.notifications (user_id, title, kind, overtime_request_id)
    VALUES (me, 'fake', 'overtime_new', NULL);
    ok := false;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN ok := true;
  END;
  PERFORM pg_temp.expect_true('writing a notification for yourself is refused', ok);

  BEGIN
    PERFORM public.overtime_ask_notified(ask);
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  PERFORM pg_temp.expect_true('an employee cannot list who else was told', ok);

  BEGIN
    PERFORM * FROM public.overtime_notify_targets(ask);
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  PERFORM pg_temp.expect_true('nor call the targeting directly', ok);
END $$;

-- ── No yes once it has started ──────────────────────────────────────────────
DO $$
DECLARE
  past uuid := (SELECT v FROM zz_ids WHERE k = 'ask_past');
  msg text;
BEGIN
  BEGIN
    PERFORM public.answer_overtime(past, 'yes');
    msg := NULL;
  EXCEPTION WHEN others THEN msg := SQLERRM;
  END;
  PERFORM pg_temp.expect_true('a yes to an ask already started is refused',
    msg = 'This overtime has already started');
  BEGIN
    PERFORM public.answer_overtime(past, 'no');
    msg := NULL;
  EXCEPTION WHEN others THEN msg := SQLERRM;
  END;
  PERFORM pg_temp.expect_true('a no is still taken', msg IS NULL);
END $$;

RESET ROLE;
SELECT 'ALL TESTS PASSED';
ROLLBACK;
