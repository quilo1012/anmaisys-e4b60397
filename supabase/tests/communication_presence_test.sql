-- Tests for 20261021090000_the_presence_draft_gets_its_migration_and_its_grants.sql.
--
-- Run this WHOLE file in one go, in the SQL editor, after that migration. One transaction,
-- its own throwaway people, ROLLBACK at the end; the last statement prints
-- 'ALL TESTS PASSED' and any failure raises first, naming the case.
--
-- Every check runs as the person concerned (role authenticated, JWT subject and session id
-- set), so row level security, grants and function privileges are the ones really in force.

BEGIN;

CREATE FUNCTION pg_temp.ok(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

-- Sign in as `_uid`, on auth session `_sess` (a second device is a second session).
CREATE FUNCTION pg_temp.as_user(_uid uuid, _sess uuid DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated',
                      'session_id', coalesce(_sess, md5(_uid::text)::uuid))::text, true);
$$;

-- What `_viewer` is shown for `_target`; null when the viewer may not see them.
CREATE FUNCTION pg_temp.shown(_viewer uuid, _target uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE out text;
BEGIN
  PERFORM pg_temp.as_user(_viewer);
  SET LOCAL ROLE authenticated;
  SELECT status INTO out FROM public.communication_presence_for(ARRAY[_target]) WHERE user_id = _target;
  RESET ROLE;
  RETURN out;
END $$;

CREATE FUNCTION pg_temp.set_pref(_who uuid, _pref text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_who);
  SET LOCAL ROLE authenticated;
  PERFORM public.communication_set_availability(_pref);
  RESET ROLE;
END $$;

CREATE FUNCTION pg_temp.touch(_who uuid, _tab uuid, _sess uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_who, _sess);
  SET LOCAL ROLE authenticated;
  PERFORM public.communication_touch_presence(_tab);
  RESET ROLE;
END $$;

CREATE FUNCTION pg_temp.end_tab(_who uuid, _tab uuid, _sess uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_who, _sess);
  SET LOCAL ROLE authenticated;
  PERFORM public.communication_end_presence(_tab);
  RESET ROLE;
END $$;

-- Whether running `_sql` as `_who` is refused for lack of privilege.
CREATE FUNCTION pg_temp.refused(_who uuid, _sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_who);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql;
    RESET ROLE;
    RETURN false;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN true;
  END;
END $$;

CREATE FUNCTION pg_temp.revision(_u uuid) RETURNS uuid
LANGUAGE sql AS $$ SELECT revision FROM public.communication_presence_changes WHERE user_id = _u $$;

DO $$
DECLARE
  adm uuid := gen_random_uuid();  -- admin
  sup uuid := gen_random_uuid();  -- supervisor, on file for A
  opr uuid := gen_random_uuid();  -- operator
  a   uuid := gen_random_uuid();  -- employee A: the person whose status we move around
  b   uuid := gen_random_uuid();  -- employee B, nobody on file
  t1  uuid := gen_random_uuid();  -- A's first tab
  t2  uuid := gen_random_uuid();  -- A's second tab
  tb  uuid := gen_random_uuid();  -- B's tab
  phone uuid := gen_random_uuid();  -- A's second auth session (another device)
  e_sup uuid; e_a uuid; grp uuid := gen_random_uuid();
  st text; n int; rev uuid;
  v_local timestamp := now() at time zone 'Europe/London'; v_today date := (now() at time zone 'Europe/London')::date;
  v_all smallint[] := ARRAY[1,2,3,4,5,6,7]::smallint[]; pat uuid; v_start timestamp; v_iso smallint;
  who uuid[]; roles text[] := ARRAY['admin', 'supervisor', 'operator', 'employee', 'employee'];
  i int;
BEGIN
  who := ARRAY[adm, sup, opr, a, b];
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT p, 'zz-' || p || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(who) p;
  INSERT INTO public.profiles (id, email, name)
  SELECT p, 'zz-' || p || '@example.invalid', 'ZZ ' || left(p::text, 4) FROM unnest(who) p
  ON CONFLICT (id) DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = ANY (who);
  FOR i IN 1 .. 5 LOOP
    INSERT INTO public.user_roles (user_id, role) VALUES (who[i], roles[i]::app_role);
  END LOOP;
  INSERT INTO public.employees (full_name, active, user_id, department) VALUES ('ZZ Sup', true, sup, 'ZZ Dept')
    RETURNING id INTO e_sup;
  INSERT INTO public.employees (full_name, active, user_id, department, manager_id)
    VALUES ('ZZ Ana', true, a, 'ZZ Dept', e_sup) RETURNING id INTO e_a;
  INSERT INTO public.employees (full_name, active, user_id, department) VALUES ('ZZ Ben', true, b, 'ZZ Dept');

  -- 1. Connection and preference are separate. Nobody connected: Offline.
  PERFORM pg_temp.ok('1a no lease reads Offline', pg_temp.shown(adm, a) = 'offline');
  PERFORM pg_temp.touch(a, t1);
  PERFORM pg_temp.ok('1b a live lease with no choice made reads Online', pg_temp.shown(adm, a) = 'online');

  -- 2. Each connected state is kept, and a heartbeat never overwrites it.
  FOREACH st IN ARRAY ARRAY['busy', 'do_not_disturb', 'away', 'online'] LOOP
    PERFORM pg_temp.set_pref(a, st);
    PERFORM pg_temp.ok('2a ' || st || ' is shown', pg_temp.shown(adm, a) = st);
    PERFORM pg_temp.touch(a, t1);
    PERFORM pg_temp.touch(a, t2);
    PERFORM pg_temp.ok('2b ' || st || ' survives heartbeats', pg_temp.shown(adm, a) = st);
  END LOOP;

  -- 3. Appear offline: connected, yet Offline. On Holiday by hand: shown, connected or not.
  PERFORM pg_temp.set_pref(a, 'offline');
  PERFORM pg_temp.ok('3a appear-offline while connected', pg_temp.shown(adm, a) = 'offline');
  PERFORM pg_temp.set_pref(a, 'on_holiday');
  PERFORM pg_temp.ok('3b manual holiday', pg_temp.shown(adm, a) = 'on_holiday');
  DELETE FROM public.communication_connection_leases WHERE user_id = a;
  PERFORM pg_temp.ok('3c manual holiday persists with no connection', pg_temp.shown(adm, a) = 'on_holiday');

  -- 4. Only the six exist.
  PERFORM pg_temp.as_user(a); SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.communication_set_availability('on_break');
    RESET ROLE; RAISE EXCEPTION 'FAILED 4a on_break was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN RESET ROLE; END;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.communication_set_availability(NULL);
    RESET ROLE; RAISE EXCEPTION 'FAILED 4b null was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN RESET ROLE; END;
  PERFORM pg_temp.ok('4c the table itself lists exactly the six',
    (SELECT bool_and(pg_get_constraintdef(c.oid) LIKE '%' || w || '%') AND bool_and(pg_get_constraintdef(c.oid) NOT LIKE '%on_break%')
       FROM pg_constraint c, unnest(ARRAY['online', 'busy', 'do_not_disturb', 'away', 'offline', 'on_holiday']) w
      WHERE c.conrelid = 'public.communication_availability'::regclass AND c.contype = 'c'));

  -- 5. The grants. Read what a policy allows; write only through the functions.
  PERFORM pg_temp.ok('5a no direct UPDATE of anyone''s row',
    pg_temp.refused(a, format('UPDATE public.communication_availability SET preference = %L WHERE user_id = %L', 'away', b)));
  PERFORM pg_temp.ok('5b no direct INSERT',
    pg_temp.refused(a, format('INSERT INTO public.communication_availability (user_id, preference) VALUES (%L, %L)', b, 'away')));
  PERFORM pg_temp.ok('5c no direct DELETE', pg_temp.refused(a, 'DELETE FROM public.communication_availability'));
  PERFORM pg_temp.ok('5d no TRUNCATE (it would ignore row level security)',
    pg_temp.refused(a, 'TRUNCATE public.communication_availability')
    AND pg_temp.refused(a, 'TRUNCATE public.communication_connection_leases')
    AND pg_temp.refused(a, 'TRUNCATE public.communication_presence_changes'));
  PERFORM pg_temp.ok('5e the lease table cannot be read or written',
    pg_temp.refused(a, 'SELECT * FROM public.communication_connection_leases')
    AND pg_temp.refused(a, format('INSERT INTO public.communication_connection_leases VALUES (%L, %L, %L, now() + interval ''1 day'')', a, gen_random_uuid(), gen_random_uuid())));
  PERFORM pg_temp.ok('5f the change marker cannot be written to',
    pg_temp.refused(a, format('INSERT INTO public.communication_presence_changes (user_id) VALUES (%L)', b)));
  PERFORM pg_temp.ok('5g anon has no privilege on any of the three',
    NOT EXISTS (SELECT 1 FROM unnest(ARRAY['communication_availability', 'communication_connection_leases', 'communication_presence_changes']) t,
                         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
                 WHERE has_table_privilege('anon', 'public.' || t, p)));
  PERFORM pg_temp.ok('5h the two helpers are not callable by a signed-in user',
    NOT has_function_privilege('authenticated', 'public.communication_presence_actor()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.communication_has_approved_holiday(uuid)', 'EXECUTE'));
  PERFORM pg_temp.ok('5i anon cannot call any of the six',
    (SELECT bool_and(NOT has_function_privilege('anon', f, 'EXECUTE')) FROM unnest(ARRAY[
      'public.communication_presence_for(uuid[])', 'public.communication_set_availability(text)',
      'public.communication_touch_presence(uuid)', 'public.communication_end_presence(uuid)',
      'public.communication_my_availability()', 'public.communication_can_view_presence(uuid)']) f));
  -- set_availability takes no user id: B's choice cannot touch A's row.
  PERFORM pg_temp.set_pref(b, 'busy');
  PERFORM pg_temp.ok('5j B''s choice did not touch A''s',
    (SELECT preference FROM public.communication_availability WHERE user_id = a) = 'on_holiday');

  -- 6. The lease runs on the server's clock and expires on its own.
  PERFORM pg_temp.set_pref(a, 'busy');
  PERFORM pg_temp.touch(a, t1);
  PERFORM pg_temp.ok('6a connected and busy', pg_temp.shown(adm, a) = 'busy');
  PERFORM pg_temp.ok('6b the lease is about 180 s ahead of the server clock',
    (SELECT expires_at BETWEEN clock_timestamp() + interval '170 seconds' AND clock_timestamp() + interval '181 seconds'
       FROM public.communication_connection_leases WHERE user_id = a AND tab_id = t1));
  UPDATE public.communication_connection_leases SET expires_at = clock_timestamp() - interval '1 second' WHERE user_id = a;
  PERFORM pg_temp.ok('6c an expired lease reads Offline, not Busy for ever', pg_temp.shown(adm, a) = 'offline');
  PERFORM pg_temp.ok('6d the preference is still Busy',
    (SELECT preference FROM public.communication_availability WHERE user_id = a) = 'busy');
  PERFORM pg_temp.touch(a, t1);
  PERFORM pg_temp.ok('6e reconnecting restores Busy without being asked', pg_temp.shown(adm, a) = 'busy');

  -- 7. Several tabs and several devices: closing one does not disconnect the person.
  PERFORM pg_temp.touch(a, t2);
  PERFORM pg_temp.touch(a, gen_random_uuid(), phone);
  PERFORM pg_temp.ok('7a three leases: two tabs and a second device',
    (SELECT count(*) = 3 FROM public.communication_connection_leases WHERE user_id = a));
  UPDATE public.communication_connection_leases SET expires_at = clock_timestamp() - interval '1 second'
   WHERE user_id = a AND tab_id = t1;
  PERFORM pg_temp.ok('7b the others keep A connected', pg_temp.shown(adm, a) = 'busy');
  PERFORM pg_temp.end_tab(a, t2);
  PERFORM pg_temp.ok('7c the phone alone still counts', pg_temp.shown(adm, a) = 'busy');
  DELETE FROM public.communication_connection_leases WHERE user_id = a;
  PERFORM pg_temp.ok('7d no lease left reads Offline', pg_temp.shown(adm, a) = 'offline');

  -- 8. Somebody else's tab id is not theirs to use or to end: the lease belongs to who the JWT says.
  PERFORM pg_temp.touch(a, t1);
  PERFORM pg_temp.touch(b, t1);
  PERFORM pg_temp.ok('8a B using A''s tab id gets a lease of their own, not A''s',
    (SELECT count(*) = 1 FROM public.communication_connection_leases WHERE user_id = a AND tab_id = t1)
    AND (SELECT count(*) = 1 FROM public.communication_connection_leases WHERE user_id = b AND tab_id = t1));
  PERFORM pg_temp.end_tab(b, t1);
  PERFORM pg_temp.ok('8b B ending it does not end A''s', pg_temp.shown(adm, a) = 'busy');
  PERFORM pg_temp.ok('8c ...and B is Offline again', pg_temp.shown(adm, b) = 'offline');

  -- 9. At most 32 live leases for one account.
  DELETE FROM public.communication_connection_leases WHERE user_id = a;
  FOR i IN 1 .. 32 LOOP PERFORM pg_temp.touch(a, gen_random_uuid()); END LOOP;
  PERFORM pg_temp.as_user(a); SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.communication_touch_presence(gen_random_uuid());
    RESET ROLE; RAISE EXCEPTION 'FAILED 9 a 33rd lease was accepted';
  EXCEPTION WHEN SQLSTATE '54000' THEN RESET ROLE; END;
  PERFORM pg_temp.touch(a, (SELECT tab_id FROM public.communication_connection_leases WHERE user_id = a LIMIT 1));
  DELETE FROM public.communication_connection_leases WHERE user_id = a;
  PERFORM pg_temp.touch(a, t1);

  -- 10. Approved holiday leave wins; nothing else does; the preference is never touched.
  INSERT INTO public.leave_requests (employee_id, kind, start_date, end_date, status)
  VALUES (e_a, 'holiday', (now() at time zone 'Europe/London')::date, (now() at time zone 'Europe/London')::date + 2, 'pending');
  PERFORM pg_temp.ok('10a pending leave changes nothing', pg_temp.shown(adm, a) = 'busy');
  UPDATE public.leave_requests SET status = 'rejected' WHERE employee_id = e_a;
  PERFORM pg_temp.ok('10b rejected leave changes nothing', pg_temp.shown(adm, a) = 'busy');
  UPDATE public.leave_requests SET status = 'approved', kind = 'sick' WHERE employee_id = e_a;
  PERFORM pg_temp.ok('10c approved SICK leave is not shown as holiday, but as Offline (no reason given)', pg_temp.shown(adm, a) = 'offline');
  UPDATE public.leave_requests SET kind = 'holiday' WHERE employee_id = e_a;
  PERFORM pg_temp.ok('10d approved holiday today reads On Holiday', pg_temp.shown(adm, a) = 'on_holiday');
  PERFORM pg_temp.set_pref(a, 'offline');
  PERFORM pg_temp.ok('10e ...even for appear-offline', pg_temp.shown(adm, a) = 'on_holiday');
  PERFORM pg_temp.as_user(a); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok('10f the owner is told, privately, that leave is the reason',
    (SELECT approved_holiday AND preference = 'offline' FROM public.communication_my_availability()));
  RESET ROLE;
  PERFORM pg_temp.set_pref(a, 'busy');
  UPDATE public.leave_requests SET start_date = start_date - 10, end_date = (now() at time zone 'Europe/London')::date - 1
   WHERE employee_id = e_a;
  PERFORM pg_temp.ok('10g leave that ended yesterday no longer counts, Busy is back', pg_temp.shown(adm, a) = 'busy');
  UPDATE public.leave_requests SET start_date = (now() at time zone 'Europe/London')::date + 1,
         end_date = (now() at time zone 'Europe/London')::date + 5 WHERE employee_id = e_a;
  PERFORM pg_temp.ok('10h leave that starts tomorrow does not count yet', pg_temp.shown(adm, a) = 'busy');
  DELETE FROM public.leave_requests WHERE employee_id = e_a;
  PERFORM pg_temp.as_user(b); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok('10i nobody else can read the leave behind it',
    NOT has_function_privilege('authenticated', 'public.communication_has_approved_holiday(uuid)', 'EXECUTE')
    AND (SELECT count(*) = 0 FROM public.communication_availability WHERE user_id = a));
  RESET ROLE;

  -- 11. Who sees whom: the Hub's own list, no wider.
  PERFORM pg_temp.ok('11a an admin sees an employee', pg_temp.shown(adm, a) IS NOT NULL);
  PERFORM pg_temp.ok('11b an employee sees the supervisor on file', pg_temp.shown(a, sup) IS NOT NULL);
  PERFORM pg_temp.ok('11c an employee does not see another employee', pg_temp.shown(a, b) IS NULL);
  PERFORM pg_temp.ok('11d an employee does not see an admin', pg_temp.shown(a, adm) IS NULL);
  PERFORM pg_temp.ok('11e an operator does not see an employee', pg_temp.shown(opr, a) IS NULL);
  PERFORM pg_temp.ok('11f an operator sees a supervisor', pg_temp.shown(opr, sup) IS NOT NULL);
  PERFORM pg_temp.ok('11g you always see yourself', pg_temp.shown(b, b) IS NOT NULL);
  INSERT INTO public.direct_messages (sender_id, sender_name, recipient_id, message) VALUES (adm, 'zz', a, 'zz hello');
  PERFORM pg_temp.ok('11h a conversation makes the sender visible', pg_temp.shown(a, adm) IS NOT NULL);
  INSERT INTO public.chat_groups (id) VALUES (grp);
  INSERT INTO public.chat_group_members (group_id, user_id) VALUES (grp, a), (grp, b);
  PERFORM pg_temp.ok('11i people in the same group see each other', pg_temp.shown(a, b) IS NOT NULL AND pg_temp.shown(b, a) IS NOT NULL);
  UPDATE public.chat_group_members SET left_at = now() WHERE group_id = grp AND user_id = b;
  PERFORM pg_temp.ok('11j ...until one has left', pg_temp.shown(a, b) IS NULL);
  -- At most 300 people per request.
  PERFORM pg_temp.as_user(adm); SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.communication_presence_for(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 301)));
    RESET ROLE; RAISE EXCEPTION 'FAILED 11k 301 ids were accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN RESET ROLE; END;

  -- 12. The change marker (what Realtime delivers) follows the same visibility.
  PERFORM pg_temp.set_pref(a, 'away');
  PERFORM pg_temp.as_user(b); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.communication_presence_changes WHERE user_id = a;
  RESET ROLE;
  PERFORM pg_temp.ok('12a an employee is not told about another employee', n = 0);
  PERFORM pg_temp.as_user(adm); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.communication_presence_changes WHERE user_id = a;
  RESET ROLE;
  PERFORM pg_temp.ok('12b an admin is', n = 1);
  PERFORM pg_temp.as_user(a); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.communication_availability;
  RESET ROLE;
  PERFORM pg_temp.ok('12c the preference table shows a person only their own row', n = 1);

  -- 13. The heartbeat is quiet: the marker moves on a CHANGE of state, not on every beat.
  DELETE FROM public.communication_connection_leases WHERE user_id = a;
  rev := pg_temp.revision(a);
  PERFORM pg_temp.touch(a, t1);
  PERFORM pg_temp.ok('13a coming online is news', pg_temp.revision(a) IS DISTINCT FROM rev);
  rev := pg_temp.revision(a);
  PERFORM pg_temp.touch(a, t1);
  PERFORM pg_temp.touch(a, t2);
  PERFORM pg_temp.ok('13b a heartbeat, or a second tab, is not news', pg_temp.revision(a) = rev);
  PERFORM pg_temp.end_tab(a, t2);
  PERFORM pg_temp.ok('13c closing one of two tabs is not news', pg_temp.revision(a) = rev);
  PERFORM pg_temp.end_tab(a, t1);
  PERFORM pg_temp.ok('13d closing the last one is', pg_temp.revision(a) IS DISTINCT FROM rev);
  rev := pg_temp.revision(a);
  PERFORM pg_temp.set_pref(a, 'do_not_disturb');
  PERFORM pg_temp.ok('13e changing the preference is', pg_temp.revision(a) IS DISTINCT FROM rev);
  -- Coming back after a silent time-out (no end call) is news too.
  PERFORM pg_temp.touch(a, t1);
  UPDATE public.communication_connection_leases SET expires_at = clock_timestamp() - interval '1 second' WHERE user_id = a;
  rev := pg_temp.revision(a);
  PERFORM pg_temp.touch(a, t1);
  PERFORM pg_temp.ok('13f returning after a time-out is news', pg_temp.revision(a) IS DISTINCT FROM rev);

  -- 14. Inactive logins are not shown; nobody signed in gets nothing.
  UPDATE public.profiles SET active = false WHERE id = b;
  PERFORM pg_temp.ok('14a an inactive login is not shown', pg_temp.shown(adm, b) IS NULL);
  PERFORM set_config('request.jwt.claims', '{}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.communication_presence_for(ARRAY[a]);
    RESET ROLE; RAISE EXCEPTION 'FAILED 14b signed-out read accepted';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.communication_set_availability('busy');
    RESET ROLE; RAISE EXCEPTION 'FAILED 14c signed-out write accepted';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;
  -- A token with no session id cannot hold a lease.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.communication_touch_presence(gen_random_uuid());
    RESET ROLE; RAISE EXCEPTION 'FAILED 14d a lease without an auth session was accepted';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;
  -- 15. The system reads the working day itself: rota, attendance board, leave.
  --     The person's CHOICE is never rewritten; only what others are SHOWN follows the facts.
  PERFORM pg_temp.touch(a, t1);
  PERFORM pg_temp.set_pref(a, 'online');
  PERFORM pg_temp.ok('15a no rota on file: no opinion, Online stays Online', pg_temp.shown(adm, a) = 'online');
  INSERT INTO public.shift_patterns (name, days, starts_at, ends_at)
    VALUES ('test-rota', v_all, (v_local - interval '1 hour')::time, (v_local + interval '1 hour')::time) RETURNING id INTO pat;
  UPDATE public.employees SET shift_pattern_id = pat WHERE id = e_a;
  PERFORM pg_temp.ok('15b inside the shift: Online', pg_temp.shown(adm, a) = 'online');
  UPDATE public.shift_patterns SET starts_at = (v_local - interval '5 hours')::time, ends_at = (v_local - interval '2 hours')::time WHERE id = pat;
  PERFORM pg_temp.ok('15c after the shift ended: Online reads Away', pg_temp.shown(adm, a) = 'away');
  PERFORM pg_temp.as_user(a); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok('15d the owner is told, privately, that the rota is the reason',
    (SELECT preference = 'online' AND automatic_status = 'away' AND automatic_reason = 'off_shift' AND NOT approved_holiday
       FROM public.communication_my_availability()));
  RESET ROLE;
  UPDATE public.shift_patterns SET starts_at = (v_local - interval '5 hours')::time, ends_at = (v_local - interval '20 minutes')::time WHERE id = pat;
  PERFORM pg_temp.ok('15e 20 minutes after the end is still inside the 30-minute grace', pg_temp.shown(adm, a) = 'online');
  UPDATE public.shift_patterns SET starts_at = (v_local + interval '20 minutes')::time, ends_at = (v_local + interval '5 hours')::time WHERE id = pat;
  PERFORM pg_temp.ok('15f 20 minutes before the start is inside the grace', pg_temp.shown(adm, a) = 'online');
  UPDATE public.shift_patterns SET starts_at = (v_local + interval '2 hours')::time, ends_at = (v_local + interval '6 hours')::time WHERE id = pat;
  PERFORM pg_temp.ok('15g two hours before the start: Away', pg_temp.shown(adm, a) = 'away');

  -- Busy / Do Not Disturb / Away are the person's word; the rota never overrides them.
  PERFORM pg_temp.set_pref(a, 'busy');
  PERFORM pg_temp.ok('15h Busy stays Busy off shift', pg_temp.shown(adm, a) = 'busy');
  PERFORM pg_temp.set_pref(a, 'do_not_disturb');
  PERFORM pg_temp.ok('15i Do Not Disturb stays off shift', pg_temp.shown(adm, a) = 'do_not_disturb');
  PERFORM pg_temp.as_user(a); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok('15j ...and the owner is told nothing is automatic',
    (SELECT automatic_status IS NULL AND automatic_reason IS NULL FROM public.communication_my_availability()));
  RESET ROLE;
  PERFORM pg_temp.set_pref(a, 'online');

  -- A rota with days only covers the whole of each day it names.
  UPDATE public.shift_patterns SET starts_at = NULL, ends_at = NULL, days = ARRAY[extract(isodow FROM v_today)::smallint] WHERE id = pat;
  PERFORM pg_temp.ok('15k days-only rota, today covered: Online', pg_temp.shown(adm, a) = 'online');
  UPDATE public.shift_patterns SET days = ARRAY[((extract(isodow FROM v_today)::int % 7) + 1)::smallint] WHERE id = pat;
  PERFORM pg_temp.ok('15l days-only rota, today not covered: Away', pg_temp.shown(adm, a) = 'away');

  -- A shift that began before midnight still counts after it, and only on the days it names.
  v_start := v_local - interval '20 hours';
  v_iso := extract(isodow FROM v_start)::smallint;
  UPDATE public.shift_patterns SET starts_at = v_start::time, ends_at = (v_start + interval '23 hours')::time, days = ARRAY[v_iso] WHERE id = pat;
  PERFORM pg_temp.ok('15m a 23-hour shift that started 20 hours ago (yesterday before 20:00): Online', pg_temp.shown(adm, a) = 'online');
  UPDATE public.shift_patterns SET days = ARRAY[(((v_iso + 2) % 7) + 1)::smallint] WHERE id = pat;
  PERFORM pg_temp.ok('15n the same hours on a day the rota does not name: Away', pg_temp.shown(adm, a) = 'away');
  UPDATE public.shift_patterns SET starts_at = (v_local - interval '5 hours')::time, ends_at = (v_local - interval '2 hours')::time, days = v_all WHERE id = pat;
  INSERT INTO public.shift_pattern_days (pattern_id, weekday, starts_at, ends_at)
    VALUES (pat, extract(isodow FROM v_today)::smallint, (v_local - interval '1 hour')::time, (v_local + interval '1 hour')::time);
  PERFORM pg_temp.ok('15o a per-weekday exception for today wins over the rota', pg_temp.shown(adm, a) = 'online');
  DELETE FROM public.shift_pattern_days WHERE pattern_id = pat;
  PERFORM pg_temp.ok('15p ...and goes back when it is removed', pg_temp.shown(adm, a) = 'away');
  UPDATE public.shift_patterns SET active = false WHERE id = pat;
  PERFORM pg_temp.ok('15q an inactive rota is no opinion at all', pg_temp.shown(adm, a) = 'online');
  UPDATE public.shift_patterns SET active = true WHERE id = pat;

  -- The attendance board.
  INSERT INTO public.employee_attendance (employee_id, on_date, status) VALUES (e_a, v_today, 'present');
  PERFORM pg_temp.ok('15r recorded present today beats the rota (overtime, a swapped day)', pg_temp.shown(adm, a) = 'online');
  UPDATE public.employee_attendance SET status = 'training' WHERE employee_id = e_a;
  PERFORM pg_temp.ok('15s training counts as at work', pg_temp.shown(adm, a) = 'online');
  UPDATE public.employee_attendance SET status = 'holiday' WHERE employee_id = e_a;
  PERFORM pg_temp.ok('15t holiday on the board reads On Holiday', pg_temp.shown(adm, a) = 'on_holiday');
  PERFORM pg_temp.set_pref(a, 'busy');
  PERFORM pg_temp.ok('15u ...over Busy too', pg_temp.shown(adm, a) = 'on_holiday');
  PERFORM pg_temp.as_user(a); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok('15v the owner sees holiday as the reason and the choice kept',
    (SELECT preference = 'busy' AND approved_holiday AND automatic_status = 'on_holiday' AND automatic_reason = 'holiday'
       FROM public.communication_my_availability()));
  RESET ROLE;
  UPDATE public.employee_attendance SET status = 'sick' WHERE employee_id = e_a;
  PERFORM pg_temp.ok('15w sick on the board reads Offline, not On Holiday', pg_temp.shown(adm, a) = 'offline');
  UPDATE public.employee_attendance SET status = 'unpaid' WHERE employee_id = e_a;
  PERFORM pg_temp.ok('15x unpaid reads Offline', pg_temp.shown(adm, a) = 'offline');
  UPDATE public.employee_attendance SET status = 'absent' WHERE employee_id = e_a;
  PERFORM pg_temp.ok('15y absent reads Offline', pg_temp.shown(adm, a) = 'offline');
  PERFORM pg_temp.as_user(a); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok('15z the owner is told the day is recorded as an absence',
    (SELECT automatic_status = 'offline' AND automatic_reason = 'absence' FROM public.communication_my_availability()));
  RESET ROLE;
  UPDATE public.employee_attendance SET on_date = v_today - 1, status = 'holiday' WHERE employee_id = e_a;
  PERFORM pg_temp.ok('15za yesterday''s holiday does not count today (Busy back)', pg_temp.shown(adm, a) = 'busy');
  DELETE FROM public.employee_attendance WHERE employee_id = e_a;
  PERFORM pg_temp.ok('15zb nothing recorded: Busy', pg_temp.shown(adm, a) = 'busy');
  PERFORM pg_temp.as_user(b); SET LOCAL ROLE authenticated;
  PERFORM pg_temp.ok('15zc nobody can call the work-state reader themselves',
    NOT has_function_privilege('authenticated', 'public.communication_work_state(uuid)', 'EXECUTE')
    AND pg_temp.refused(b, 'SELECT public.communication_work_state(''' || a || '''::uuid)'));
  RESET ROLE;
  -- Never touches delivery: the person is written to as before, whatever they are shown.
  UPDATE public.employees SET shift_pattern_id = NULL WHERE id = e_a;
  DELETE FROM public.shift_patterns WHERE id = pat;
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
