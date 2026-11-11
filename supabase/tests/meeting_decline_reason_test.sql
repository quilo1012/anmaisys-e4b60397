-- Tests for 20261111120000_meeting_decline_reason.sql (BLOCO 161).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 161. One transaction, its
-- own throwaway people and meeting, ROLLBACK at the end. The last statement prints
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

CREATE TEMP TABLE zz_ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON zz_ids TO authenticated;

DO $$
DECLARE
  u_admin uuid := gen_random_uuid();
  u_ana   uuid := gen_random_uuid();   -- invited, never answers
  u_cat   uuid := gen_random_uuid();   -- invited, declines
  u uuid;
BEGIN
  FOREACH u IN ARRAY array[u_admin, u_ana, u_cat] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-decline-' || u || '@example.test');
    INSERT INTO public.profiles (id, email, name)
    VALUES (u, 'zz-decline-' || u || '@example.test', 'ZZ ' || left(u::text, 4))
    ON CONFLICT (id) DO NOTHING;
    DELETE FROM public.user_roles WHERE user_id = u;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (u, (CASE WHEN u = u_admin THEN 'admin' ELSE 'manager' END)::app_role);
  END LOOP;
  INSERT INTO zz_ids VALUES ('admin', u_admin), ('ana', u_ana), ('cat', u_cat);
END $$;

-- The admin schedules one meeting with Ana and Cat.
SELECT pg_temp.as_text((SELECT v FROM zz_ids WHERE k = 'admin'),
  format($q$SELECT public.meeting_create('ZZ decline test', null, now() + interval '1 day',
            now() + interval '1 day 30 minutes', null, null, 'none', null, array[%L, %L]::uuid[])::text$q$,
         (SELECT v FROM zz_ids WHERE k = 'ana'), (SELECT v FROM zz_ids WHERE k = 'cat')));
INSERT INTO zz_ids SELECT 'meeting', id FROM public.meetings WHERE title = 'ZZ decline test';

CREATE FUNCTION pg_temp.reason_seen_by(_who text) RETURNS text
LANGUAGE sql AS $$
  SELECT pg_temp.as_text((SELECT v FROM zz_ids WHERE k = _who),
    format($q$SELECT decline_reason FROM public.meeting_participant_list(%L) WHERE user_id = %L$q$,
           (SELECT v FROM zz_ids WHERE k = 'meeting'), (SELECT v FROM zz_ids WHERE k = 'cat')));
$$;
CREATE FUNCTION pg_temp.cat_answers(_args text) RETURNS integer
LANGUAGE sql AS $$
  SELECT pg_temp.as_text((SELECT v FROM zz_ids WHERE k = 'cat'),
    format('SELECT public.meeting_respond(%L, %s)::text', (SELECT v FROM zz_ids WHERE k = 'meeting'), _args))::integer;
$$;

SELECT pg_temp.ok('declining with a reason changes one row',
  pg_temp.cat_answers($$'declined', 'one', '  On holiday  '$$) = 1);
SELECT pg_temp.ok('the same answer and reason again changes nothing',
  pg_temp.cat_answers($$'declined', 'one', 'On holiday'$$) = 0);
SELECT pg_temp.ok('a new reason is a change',
  pg_temp.cat_answers($$'declined', 'one', 'Off sick'$$) = 1);
SELECT pg_temp.ok('the reason is trimmed and kept', pg_temp.reason_seen_by('cat') = 'Off sick');
SELECT pg_temp.ok('the admin sees the reason', pg_temp.reason_seen_by('admin') = 'Off sick');
SELECT pg_temp.ok('another participant sees no reason', pg_temp.reason_seen_by('ana') IS NULL);
SELECT pg_temp.ok('the organiser''s notice carries the reason',
  EXISTS (SELECT 1 FROM public.notifications
           WHERE kind = 'meeting_response' AND meeting_id = (SELECT v FROM zz_ids WHERE k = 'meeting')
             AND body LIKE '%"Off sick"'));
SELECT pg_temp.ok('the reason cannot be written straight to the table',
  NOT has_column_privilege('authenticated', 'public.meeting_participants', 'decline_reason', 'UPDATE'));
SELECT pg_temp.ok('three arguments, as the bell sends, still answer (one function, not two)',
  pg_temp.cat_answers($$'accepted', 'following'$$) = 1);
SELECT pg_temp.ok('accepting clears the reason',
  (SELECT decline_reason FROM public.meeting_participants
    WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'meeting') AND user_id = (SELECT v FROM zz_ids WHERE k = 'cat')) IS NULL);
SELECT pg_temp.ok('declining without a reason keeps none',
  pg_temp.cat_answers($$'declined', 'one', null$$) = 1
  AND pg_temp.reason_seen_by('cat') IS NULL);

SELECT 'ALL TESTS PASSED';
ROLLBACK;
