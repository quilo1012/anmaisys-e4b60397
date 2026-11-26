-- Tests for 20261126120000_employee_announcements.sql (BLOCO 164).
--
-- Run this WHOLE file in one go, in the SQL editor of AN Maintenance, after BLOCO 164. One
-- transaction, its own throwaway people in two made-up departments ("ZZ Packing" and
-- "ZZ Stores"), ROLLBACK at the end. Nothing is published to the real company: every
-- announcement here targets a ZZ department. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case.

BEGIN;

CREATE FUNCTION pg_temp.ok(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

-- Runs `_sql` (one value back) as `_uid`, under the authenticated role.
CREATE FUNCTION pg_temp.as_text(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE _sql INTO v;
  RESET ROLE;
  RETURN v;
END $$;

-- Same, but returns the error message instead of raising ('' when it worked).
CREATE FUNCTION pg_temp.err_of(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_text(_uid, _sql);
  RETURN '';
EXCEPTION WHEN others THEN
  RESET ROLE;
  RETURN SQLERRM;
END $$;

CREATE TEMP TABLE zz_ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON zz_ids TO authenticated;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM zz_ids WHERE k = _k $$;

-- admin; a maintenance manager who manages ZZ Packing and may publish (override);
-- day and night packers with logins; a stores day worker; a day packer with NO login;
-- a line tablet.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('admin',   'admin',               NULL,         NULL),
      ('mgr',     'maintenance_manager', 'ZZ Packing', 'Day'),
      ('day',     'employee',            'ZZ Packing', 'Day'),
      ('night',   'employee',            'ZZ Packing', 'Night'),
      ('stores',  'employee',            'ZZ Stores',  'Day'),
      ('tablet',  'operator',            NULL,         NULL)) AS t(k, role, dept, crew)
  LOOP
    INSERT INTO zz_ids VALUES (r.k, gen_random_uuid());
    INSERT INTO auth.users (id, instance_id, aud, role, email)
    VALUES (pg_temp.id(r.k), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-ann-' || r.k || '-' || pg_temp.id(r.k) || '@example.test');
    INSERT INTO public.profiles (id, email, name)
    VALUES (pg_temp.id(r.k), 'zz-ann-' || pg_temp.id(r.k) || '@example.test', 'ZZ ' || r.k)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id(r.k), r.role::app_role);
    IF r.dept IS NOT NULL THEN
      INSERT INTO public.employees (full_name, department, shift_group, user_id, active)
      VALUES ('ZZ ' || r.k, r.dept, r.crew, pg_temp.id(r.k), true);
    END IF;
  END LOOP;
  INSERT INTO public.employees (full_name, department, shift_group, user_id, active)
  VALUES ('ZZ nologin', 'ZZ Packing', 'Day', NULL, true);
  INSERT INTO public.role_permission_overrides (role, action, allowed)
  VALUES ('maintenance_manager', 'announcements.publish', true)
  ON CONFLICT (role, action) DO UPDATE SET allowed = true;
END $$;

-- 1. Department + shift: only ZZ Packing / Day.
INSERT INTO zz_ids SELECT 'a1', pg_temp.as_text(pg_temp.id('admin'),
  $q$SELECT public.publish_announcement('ZZ Closure', 'Closed on 12 December.', 'company', 'ZZ Packing', 'Day')::text$q$)::uuid;

SELECT pg_temp.ok('1a the day packer is rung',
  EXISTS (SELECT 1 FROM public.notifications WHERE announcement_id = pg_temp.id('a1') AND user_id = pg_temp.id('day')));
SELECT pg_temp.ok('1b exactly two are rung: the day packer and the manager, who is also a day packer',
  (SELECT count(*) FROM public.notifications WHERE announcement_id = pg_temp.id('a1')) = 2
  AND EXISTS (SELECT 1 FROM public.notifications WHERE announcement_id = pg_temp.id('a1') AND user_id = pg_temp.id('mgr')));
SELECT pg_temp.ok('1c the night packer is not rung',
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE announcement_id = pg_temp.id('a1') AND user_id = pg_temp.id('night')));
SELECT pg_temp.ok('1d the day packer has it in their list',
  pg_temp.as_text(pg_temp.id('day'), format('SELECT count(*)::text FROM public.my_announcements() WHERE id = %L', pg_temp.id('a1'))) = '1');
SELECT pg_temp.ok('1e the night packer does not',
  pg_temp.as_text(pg_temp.id('night'), format('SELECT count(*)::text FROM public.my_announcements() WHERE id = %L', pg_temp.id('a1'))) = '0');
SELECT pg_temp.ok('1f nor can the night packer read the table row',
  pg_temp.as_text(pg_temp.id('night'), format('SELECT count(*)::text FROM public.announcements WHERE id = %L', pg_temp.id('a1'))) = '0');
SELECT pg_temp.ok('1g the stores worker cannot read it either',
  pg_temp.as_text(pg_temp.id('stores'), format('SELECT count(*)::text FROM public.announcements WHERE id = %L', pg_temp.id('a1'))) = '0');

-- 2. The report counts the employee with no login, and says so.
SELECT pg_temp.ok('2a report: three targeted (two packers with a login, one without)',
  pg_temp.as_text(pg_temp.id('admin'), format(
    $q$SELECT count(*)::text FROM public.announcement_read_report(%L) WHERE name LIKE 'ZZ %%'$q$, pg_temp.id('a1'))) = '3');
SELECT pg_temp.ok('2b report: the one without a login is marked',
  pg_temp.as_text(pg_temp.id('admin'), format(
    $q$SELECT (NOT has_login)::text FROM public.announcement_read_report(%L) WHERE name = 'ZZ nologin'$q$, pg_temp.id('a1'))) = 'true');
SELECT pg_temp.ok('2c report: an employee cannot see it',
  pg_temp.err_of(pg_temp.id('day'), format('SELECT count(*)::text FROM public.announcement_read_report(%L)', pg_temp.id('a1'))) LIKE 'Only the author%');

-- 3. Acknowledgment: once, and the first time is kept.
SELECT pg_temp.as_text(pg_temp.id('day'), format('SELECT public.read_announcement(%L, true)::text', pg_temp.id('a1')));
CREATE TEMP TABLE zz_first AS
  SELECT acknowledged_at FROM public.announcement_reads WHERE announcement_id = pg_temp.id('a1') AND user_id = pg_temp.id('day');
SELECT pg_sleep(0.01);
SELECT pg_temp.as_text(pg_temp.id('day'), format('SELECT public.read_announcement(%L, true)::text', pg_temp.id('a1')));
SELECT pg_temp.ok('3a one read row, not two',
  (SELECT count(*) FROM public.announcement_reads WHERE announcement_id = pg_temp.id('a1') AND user_id = pg_temp.id('day')) = 1);
SELECT pg_temp.ok('3b the first acknowledgment time is kept',
  (SELECT acknowledged_at FROM public.announcement_reads WHERE announcement_id = pg_temp.id('a1') AND user_id = pg_temp.id('day'))
  = (SELECT acknowledged_at FROM zz_first));
SELECT pg_temp.ok('3c the bell row is marked read',
  (SELECT read_at FROM public.notifications WHERE announcement_id = pg_temp.id('a1') AND user_id = pg_temp.id('day')) IS NOT NULL);
SELECT pg_temp.ok('3d the list shows it acknowledged',
  pg_temp.as_text(pg_temp.id('day'), format('SELECT (acknowledged_at IS NOT NULL)::text FROM public.my_announcements() WHERE id = %L', pg_temp.id('a1'))) = 'true');
SELECT pg_temp.ok('3e the night packer cannot acknowledge it',
  pg_temp.err_of(pg_temp.id('night'), format('SELECT public.read_announcement(%L, true)::text', pg_temp.id('a1'))) LIKE '%not available%');
SELECT pg_temp.ok('3f the manager list: 3 targeted, 2 reachable, 1 acknowledged',
  pg_temp.as_text(pg_temp.id('admin'), format(
    'SELECT targeted || ''/'' || reachable || ''/'' || acknowledged FROM public.announcements_manage_list() WHERE id = %L', pg_temp.id('a1'))) = '3/2/1');
SELECT pg_temp.ok('3g reads cannot be written straight to the table',
  NOT has_table_privilege('authenticated', 'public.announcement_reads', 'INSERT'));

-- 4. Who may publish.
SELECT pg_temp.ok('4a the manager publishes to the department they belong to',
  pg_temp.err_of(pg_temp.id('mgr'), $q$SELECT public.publish_announcement('ZZ Mgr', 'Hello packers.', 'company', 'ZZ Packing', null)::text$q$) = '');
SELECT pg_temp.ok('4b but not to another department',
  pg_temp.err_of(pg_temp.id('mgr'), $q$SELECT public.publish_announcement('ZZ Mgr', 'Hello stores.', 'company', 'ZZ Stores', null)::text$q$) LIKE 'You cannot publish%');
SELECT pg_temp.ok('4c nor to the whole company',
  pg_temp.err_of(pg_temp.id('mgr'), $q$SELECT public.publish_announcement('ZZ Mgr', 'Hello all.', 'company', null, null)::text$q$) LIKE 'You cannot publish%');
SELECT pg_temp.ok('4d an employee cannot publish',
  pg_temp.err_of(pg_temp.id('day'), $q$SELECT public.publish_announcement('ZZ Emp', 'Hi.', 'company', 'ZZ Packing', null)::text$q$) LIKE 'You cannot publish%');
SELECT pg_temp.ok('4e a message is required',
  pg_temp.err_of(pg_temp.id('admin'), $q$SELECT public.publish_announcement('ZZ Empty', '  ', 'company', 'ZZ Packing', null)::text$q$) = 'Write the message');
SELECT pg_temp.ok('4f anon cannot call publish',
  NOT has_function_privilege('anon', 'public.publish_announcement(text, text, text, text, text, boolean, boolean, timestamptz, text, timestamptz)', 'execute'));
SELECT pg_temp.ok('4g the whole company never includes a line tablet',
  NOT EXISTS (SELECT 1 FROM public.announcement_audience_for(null, null) WHERE user_id = pg_temp.id('tablet')));
SELECT pg_temp.ok('4h a shift alone reaches that shift in every department',
  (SELECT count(*) FROM public.announcement_audience_for(null, 'Night') WHERE user_id IN (pg_temp.id('night'), pg_temp.id('day'))) = 1);

-- 5. Scheduling.
INSERT INTO zz_ids SELECT 'a2', pg_temp.as_text(pg_temp.id('admin'),
  $q$SELECT public.publish_announcement('ZZ Later', 'Next week.', 'company', 'ZZ Stores', null, true, false, null, null, now() + interval '2 days')::text$q$)::uuid;
SELECT pg_temp.ok('5a a scheduled announcement rings nobody yet',
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE announcement_id = pg_temp.id('a2')));
SELECT pg_temp.ok('5b and is not in the list yet',
  pg_temp.as_text(pg_temp.id('stores'), format('SELECT count(*)::text FROM public.my_announcements() WHERE id = %L', pg_temp.id('a2'))) = '0');
SELECT pg_temp.ok('5c while scheduled, its audience can still change',
  pg_temp.err_of(pg_temp.id('admin'), format(
    $q$SELECT public.update_announcement(%L, 'ZZ Later', 'Next week.', 'ZZ Stores', 'Day', true, false, null, now() + interval '2 days')::text$q$,
    pg_temp.id('a2'))) = '');
UPDATE public.announcements SET published_at = now() - interval '1 minute' WHERE id = pg_temp.id('a2');
SELECT public.announcements_ring_due();
SELECT pg_temp.ok('5d once due, the cron rings it',
  EXISTS (SELECT 1 FROM public.notifications WHERE announcement_id = pg_temp.id('a2') AND user_id = pg_temp.id('stores')));
SELECT public.announcements_ring_due();
SELECT pg_temp.ok('5e a second run rings nobody twice',
  (SELECT count(*) FROM public.notifications WHERE announcement_id = pg_temp.id('a2') AND user_id = pg_temp.id('stores')) = 1);
SELECT pg_temp.ok('5f the cron job exists',
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'announcements-ring-due'));

-- 6. Editing after it went out.
SELECT pg_temp.ok('6a after it went out, the audience cannot change',
  pg_temp.err_of(pg_temp.id('admin'), format(
    $q$SELECT public.update_announcement(%L, 'ZZ Closure', 'Closed.', 'ZZ Stores', null)::text$q$, pg_temp.id('a1'))) LIKE 'It has already been sent%');
SELECT pg_temp.as_text(pg_temp.id('admin'), format(
  $q$SELECT public.update_announcement(%L, 'ZZ Closure (updated)', 'Closed on 13 December.', 'ZZ Packing', 'Day')::text$q$, pg_temp.id('a1')));
SELECT pg_temp.ok('6b but the words can',
  (SELECT title FROM public.announcements WHERE id = pg_temp.id('a1')) = 'ZZ Closure (updated)');
SELECT pg_temp.ok('6c an employee cannot edit',
  pg_temp.err_of(pg_temp.id('day'), format(
    $q$SELECT public.update_announcement(%L, 'x', 'y', 'ZZ Packing', 'Day')::text$q$, pg_temp.id('a1'))) LIKE 'Only the author%');

-- 7. Withdraw hides it; delete removes it and its reads.
SELECT pg_temp.as_text(pg_temp.id('admin'), format('SELECT public.withdraw_announcement(%L)::text', pg_temp.id('a2')));
SELECT pg_temp.ok('7a a withdrawn announcement leaves the list',
  pg_temp.as_text(pg_temp.id('stores'), format('SELECT count(*)::text FROM public.my_announcements() WHERE id = %L', pg_temp.id('a2'))) = '0');
SELECT pg_temp.ok('7b and its unread bell row goes',
  NOT EXISTS (SELECT 1 FROM public.notifications WHERE announcement_id = pg_temp.id('a2') AND read_at IS NULL));
SELECT pg_temp.ok('7c an employee cannot delete',
  pg_temp.err_of(pg_temp.id('day'), format('SELECT public.delete_announcement(%L)::text', pg_temp.id('a1'))) LIKE 'Only the author%');
SELECT pg_temp.as_text(pg_temp.id('admin'), format('SELECT public.delete_announcement(%L)::text', pg_temp.id('a1')));
SELECT pg_temp.ok('7d delete removes it, its reads and its bell rows',
  NOT EXISTS (SELECT 1 FROM public.announcements WHERE id = pg_temp.id('a1'))
  AND NOT EXISTS (SELECT 1 FROM public.announcement_reads WHERE announcement_id = pg_temp.id('a1'))
  AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE announcement_id = pg_temp.id('a1')));

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
