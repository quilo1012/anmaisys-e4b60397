-- Tests for 20261110200000_meetings_in_the_hub.sql (BLOCO 159).
--
-- Run this WHOLE file in one go, in the SQL editor, after BLOCO 159. One transaction, its
-- own throwaway people and meetings, ROLLBACK at the end. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case. Runs as the SQL
-- editor's postgres role; the RLS cases switch to `authenticated` and back.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
$$;

-- Runs `_sql` as `_uid` under RLS and says whether it was refused (any error).
CREATE FUNCTION pg_temp.refused(_uid uuid, _sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_uid);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN others THEN
    RESET ROLE;
    RETURN true;
  END;
  RESET ROLE;
  RETURN false;
END $$;

-- Runs a count query (or any statement returning one integer) as `_uid` under RLS.
CREATE FUNCTION pg_temp.int_as(_uid uuid, _sql text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.as_user(_uid);
  SET LOCAL ROLE authenticated;
  EXECUTE _sql INTO n;
  RESET ROLE;
  RETURN n;
END $$;

CREATE TEMP TABLE zz_ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON zz_ids TO authenticated;

DO $$
DECLARE
  u_admin uuid := gen_random_uuid();
  u_ana   uuid := gen_random_uuid();   -- invited
  u_ben   uuid := gen_random_uuid();   -- never invited
  u_cat   uuid := gen_random_uuid();   -- invited, declines
  u_emp   uuid := gen_random_uuid();   -- employee login, granted meetings.manage by override
  u uuid;
  r text;
BEGIN
  FOREACH u IN ARRAY array[u_admin, u_ana, u_ben, u_cat, u_emp] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-meet-' || u || '@example.test');
    INSERT INTO public.profiles (id, email, name)
    VALUES (u, 'zz-meet-' || u || '@example.test', 'ZZ ' || left(u::text, 4))
    ON CONFLICT (id) DO NOTHING;
    r := CASE u WHEN u_admin THEN 'admin' WHEN u_emp THEN 'employee' ELSE 'manager' END;
    DELETE FROM public.user_roles WHERE user_id = u;
    INSERT INTO public.user_roles (user_id, role) VALUES (u, r::app_role);
  END LOOP;
  -- A tick on the Permissions screen must not lift the employee ceiling.
  INSERT INTO public.role_permission_overrides (role, action, allowed)
  VALUES ('employee', 'meetings.manage', true)
  ON CONFLICT (role, action) DO UPDATE SET allowed = true;

  INSERT INTO zz_ids VALUES ('admin', u_admin), ('ana', u_ana), ('ben', u_ben), ('cat', u_cat), ('emp', u_emp);
END $$;

-- ── 1. Only the admin creates ───────────────────────────────────────────────
SELECT pg_temp.expect_true('a manager cannot insert a meeting directly',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$INSERT INTO public.meetings (title, starts_at, ends_at, created_by)
              VALUES ('x', now(), now() + interval '1 hour', %L)$q$, (SELECT v FROM zz_ids WHERE k = 'ana'))));

SELECT pg_temp.expect_true('a manager cannot call meeting_create',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$SELECT public.meeting_create('x', null, now() + interval '1 day', now() + interval '1 day 1 hour',
              null, null, 'none', null, array[%L]::uuid[])$q$, (SELECT v FROM zz_ids WHERE k = 'ben'))));

SELECT pg_temp.expect_true('an employee granted meetings.manage still cannot create (ceiling)',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'emp'),
    format($q$SELECT public.meeting_create('x', null, now() + interval '1 day', now() + interval '1 day 1 hour',
              null, null, 'none', null, array[%L]::uuid[])$q$, (SELECT v FROM zz_ids WHERE k = 'ben'))));

SELECT pg_temp.expect_true('the admin cannot create a meeting that ends before it starts',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'admin'),
    format($q$SELECT public.meeting_create('x', null, now() + interval '2 days', now() + interval '1 day',
              null, null, 'none', null, array[%L]::uuid[])$q$, (SELECT v FROM zz_ids WHERE k = 'ana'))));

SELECT pg_temp.expect_true('the admin cannot create a meeting with nobody invited',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'admin'),
    $q$SELECT public.meeting_create('x', null, now() + interval '1 day', now() + interval '1 day 1 hour',
         null, null, 'none', null, '{}'::uuid[])$q$));

SELECT pg_temp.expect_true('a repeating meeting needs "repeat until"',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'admin'),
    format($q$SELECT public.meeting_create('x', null, now() + interval '1 day', now() + interval '1 day 1 hour',
              null, null, 'weekly', null, array[%L]::uuid[])$q$, (SELECT v FROM zz_ids WHERE k = 'ana'))));

-- The admin invites Ana and Cat to a meeting 10 minutes from now.
DO $$
BEGIN
  PERFORM pg_temp.as_user((SELECT v FROM zz_ids WHERE k = 'admin'));
  SET LOCAL ROLE authenticated;
  INSERT INTO zz_ids
  SELECT 'soon', public.meeting_create('ZZ soon', 'agenda', now() + interval '10 minutes', now() + interval '40 minutes',
           'Office', 'https://teams.microsoft.com/l/zz', 'none', null,
           array[(SELECT v FROM zz_ids WHERE k = 'ana'), (SELECT v FROM zz_ids WHERE k = 'cat')]);
  RESET ROLE;
  INSERT INTO zz_ids SELECT 'soon_m', id FROM public.meetings WHERE series_id = (SELECT v FROM zz_ids WHERE k = 'soon');
END $$;

SELECT pg_temp.expect_true('creator is a participant, already accepted',
  (SELECT response FROM public.meeting_participants
    WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'soon_m') AND user_id = (SELECT v FROM zz_ids WHERE k = 'admin')) = 'accepted');

SELECT pg_temp.expect_true('each invited person got one invite in the bell',
  (SELECT count(*) FROM public.notifications
    WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'soon_m') AND kind = 'meeting_invite') = 2);

-- ── 2. Nobody sees a meeting they are not invited to ────────────────────────
SELECT pg_temp.expect_true('Ben (not invited) sees no meeting',
  pg_temp.int_as((SELECT v FROM zz_ids WHERE k = 'ben'),
    format('SELECT count(*)::int FROM public.meetings WHERE id = %L', (SELECT v FROM zz_ids WHERE k = 'soon_m'))) = 0);

SELECT pg_temp.expect_true('Ben sees no participant row of it',
  pg_temp.int_as((SELECT v FROM zz_ids WHERE k = 'ben'),
    format('SELECT count(*)::int FROM public.meeting_participants WHERE meeting_id = %L', (SELECT v FROM zz_ids WHERE k = 'soon_m'))) = 0);

SELECT pg_temp.expect_true('Ben cannot read its participant list',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'ben'),
    format('SELECT * FROM public.meeting_participant_list(%L)', (SELECT v FROM zz_ids WHERE k = 'soon_m'))));

SELECT pg_temp.expect_true('Ben cannot answer it',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'ben'),
    format($q$SELECT public.meeting_respond(%L, 'accepted')$q$, (SELECT v FROM zz_ids WHERE k = 'soon_m'))));

SELECT pg_temp.expect_true('Ana sees the meeting and all three participants',
  pg_temp.int_as((SELECT v FROM zz_ids WHERE k = 'ana'),
    format('SELECT count(*)::int FROM public.meeting_participants WHERE meeting_id = %L', (SELECT v FROM zz_ids WHERE k = 'soon_m'))) = 3);

-- ── 3. A participant changes only their own answer ──────────────────────────
SELECT pg_temp.expect_true('Ana cannot rename the meeting',
  pg_temp.int_as((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$WITH u AS (UPDATE public.meetings SET title = 'hijack' WHERE id = %L RETURNING 1) SELECT count(*)::int FROM u$q$,
      (SELECT v FROM zz_ids WHERE k = 'soon_m'))) = 0);

SELECT pg_temp.expect_true('Ana cannot answer for Cat',
  pg_temp.int_as((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$WITH u AS (UPDATE public.meeting_participants SET response = 'accepted'
                          WHERE meeting_id = %L AND user_id = %L RETURNING 1) SELECT count(*)::int FROM u$q$,
      (SELECT v FROM zz_ids WHERE k = 'soon_m'), (SELECT v FROM zz_ids WHERE k = 'cat'))) = 0);

SELECT pg_temp.expect_true('Ana cannot move her own row to another meeting',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$UPDATE public.meeting_participants SET meeting_id = gen_random_uuid()
               WHERE meeting_id = %L AND user_id = %L$q$,
      (SELECT v FROM zz_ids WHERE k = 'soon_m'), (SELECT v FROM zz_ids WHERE k = 'ana'))));

SELECT pg_temp.expect_true('Ana cannot invite Ben',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$INSERT INTO public.meeting_participants (meeting_id, user_id) VALUES (%L, %L)$q$,
      (SELECT v FROM zz_ids WHERE k = 'soon_m'), (SELECT v FROM zz_ids WHERE k = 'ben'))));

SELECT pg_temp.expect_true('Ana accepts',
  pg_temp.int_as((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$SELECT public.meeting_respond(%L, 'accepted')$q$, (SELECT v FROM zz_ids WHERE k = 'soon_m'))) = 1);

SELECT pg_temp.expect_true('Cat declines',
  pg_temp.int_as((SELECT v FROM zz_ids WHERE k = 'cat'),
    format($q$SELECT public.meeting_respond(%L, 'declined')$q$, (SELECT v FROM zz_ids WHERE k = 'soon_m'))) = 1);

SELECT pg_temp.expect_true('the creator heard both answers',
  (SELECT count(*) FROM public.notifications
    WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'soon_m') AND kind = 'meeting_response'
      AND user_id = (SELECT v FROM zz_ids WHERE k = 'admin')) = 2);

SELECT pg_temp.expect_true('answering the same again tells nobody',
  pg_temp.int_as((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$SELECT public.meeting_respond(%L, 'accepted')$q$, (SELECT v FROM zz_ids WHERE k = 'soon_m'))) = 0);

-- ── 4. The reminder goes once, and not to who declined ──────────────────────
SELECT pg_temp.expect_true('first run reminds admin and Ana (Cat declined)',
  public.meeting_reminders_due() = 2);
SELECT pg_temp.expect_true('second run reminds nobody',
  public.meeting_reminders_due() = 0);
SELECT pg_temp.expect_true('a run a minute later reminds nobody',
  public.meeting_reminders_due(now() + interval '1 minute') = 0);
SELECT pg_temp.expect_true('exactly one reminder per person',
  (SELECT count(*) = 2 AND count(DISTINCT user_id) = 2 FROM public.notifications
    WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'soon_m') AND kind = 'meeting_reminder'));
SELECT pg_temp.expect_true('Cat got no reminder',
  NOT EXISTS (SELECT 1 FROM public.notifications
    WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'soon_m') AND kind = 'meeting_reminder'
      AND user_id = (SELECT v FROM zz_ids WHERE k = 'cat')));
UPDATE public.meeting_participants SET reminder_sent_at = null
 WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'soon_m');
SELECT pg_temp.expect_true('even with the claim cleared, the unique index keeps it to one',
  public.meeting_reminders_due() = 0
  AND (SELECT count(*) FROM public.notifications
        WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'soon_m') AND kind = 'meeting_reminder') = 2);

-- A meeting moved later is reminded afresh at its new time.
DO $$
BEGIN
  PERFORM pg_temp.as_user((SELECT v FROM zz_ids WHERE k = 'admin'));
  SET LOCAL ROLE authenticated;
  PERFORM public.meeting_update((SELECT v FROM zz_ids WHERE k = 'soon_m'), 'one', 'ZZ soon', 'agenda',
            now() + interval '2 hours', now() + interval '2 hours 30 minutes', 'Canteen', null,
            array[(SELECT v FROM zz_ids WHERE k = 'ana'), (SELECT v FROM zz_ids WHERE k = 'cat')]);
  RESET ROLE;
END $$;
SELECT pg_temp.expect_true('moving it tells Ana and Cat, and drops the old reminders',
  (SELECT count(*) FROM public.notifications
    WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'soon_m') AND kind = 'meeting_changed') = 2
  AND NOT EXISTS (SELECT 1 FROM public.notifications
    WHERE meeting_id = (SELECT v FROM zz_ids WHERE k = 'soon_m') AND kind = 'meeting_reminder'));
SELECT pg_temp.expect_true('not due now; due once 1h50 later',
  public.meeting_reminders_due() = 0
  AND public.meeting_reminders_due(now() + interval '1 hour 50 minutes') = 2
  AND public.meeting_reminders_due(now() + interval '1 hour 51 minutes') = 0);

-- ── 5. Recurring occurrences ────────────────────────────────────────────────
SELECT pg_temp.expect_true('weekly 09:00 from Tue 20/10 until 10/11: four, all at 09:00 London across the clock change',
  (SELECT count(*) = 4
      AND bool_and(to_char(starts_at AT TIME ZONE 'Europe/London', 'HH24:MI') = '09:00')
      AND bool_and(ends_at - starts_at = interval '30 minutes')
      AND min((starts_at AT TIME ZONE 'Europe/London')::date) = date '2026-10-20'
      AND max((starts_at AT TIME ZONE 'Europe/London')::date) = date '2026-11-10'
     FROM public.meeting_occurrences(timestamptz '2026-10-20 09:00 Europe/London',
                                     timestamptz '2026-10-20 09:30 Europe/London', 'weekly', date '2026-11-10')));

SELECT pg_temp.expect_true('daily for three days',
  (SELECT count(*) FROM public.meeting_occurrences(timestamptz '2026-11-12 07:00 Europe/London',
     timestamptz '2026-11-12 07:15 Europe/London', 'daily', date '2026-11-14')) = 3);

SELECT pg_temp.expect_true('monthly on the 31st lands on each month''s last day and returns to the 31st',
  (SELECT array_agg(to_char(starts_at AT TIME ZONE 'Europe/London', 'DD/MM') ORDER BY starts_at)
     FROM public.meeting_occurrences(timestamptz '2027-01-31 10:00 Europe/London',
       timestamptz '2027-01-31 11:00 Europe/London', 'monthly', date '2027-05-31'))
  = array['31/01', '28/02', '31/03', '30/04', '31/05']);

SELECT pg_temp.expect_true('no recurrence is one occurrence',
  (SELECT count(*) FROM public.meeting_occurrences(now(), now() + interval '1 hour', 'none', null)) = 1);

DO $$
BEGIN
  PERFORM pg_temp.as_user((SELECT v FROM zz_ids WHERE k = 'admin'));
  SET LOCAL ROLE authenticated;
  INSERT INTO zz_ids
  SELECT 'weekly', public.meeting_create('ZZ weekly', null,
           timestamptz '2026-10-20 09:00 Europe/London', timestamptz '2026-10-20 09:30 Europe/London',
           null, null, 'weekly', date '2026-11-10', array[(SELECT v FROM zz_ids WHERE k = 'ana')]);
  RESET ROLE;
END $$;

SELECT pg_temp.expect_true('a weekly series is stored as four rows with one series_id',
  (SELECT count(*) FROM public.meetings WHERE series_id = (SELECT v FROM zz_ids WHERE k = 'weekly')) = 4);
SELECT pg_temp.expect_true('two people on each of the four',
  (SELECT count(*) FROM public.meeting_participants mp JOIN public.meetings m ON m.id = mp.meeting_id
    WHERE m.series_id = (SELECT v FROM zz_ids WHERE k = 'weekly')) = 8);
SELECT pg_temp.expect_true('Ana got one invite for the series, not four',
  (SELECT count(*) FROM public.notifications n JOIN public.meetings m ON m.id = n.meeting_id
    WHERE m.series_id = (SELECT v FROM zz_ids WHERE k = 'weekly') AND n.kind = 'meeting_invite') = 1);

-- Accepting the series invite accepts every occurrence.
SELECT pg_temp.expect_true('Ana accepts the whole series from the invite',
  pg_temp.int_as((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$SELECT public.meeting_respond(%L, 'accepted', 'following')$q$,
      (SELECT id FROM public.meetings WHERE series_id = (SELECT v FROM zz_ids WHERE k = 'weekly') ORDER BY starts_at LIMIT 1))) = 4);

-- Cancel "this and the following" from the third: two cancelled, two kept.
DO $$
BEGIN
  PERFORM pg_temp.as_user((SELECT v FROM zz_ids WHERE k = 'admin'));
  SET LOCAL ROLE authenticated;
  PERFORM public.meeting_cancel(
    (SELECT id FROM public.meetings WHERE series_id = (SELECT v FROM zz_ids WHERE k = 'weekly') ORDER BY starts_at OFFSET 2 LIMIT 1),
    'following');
  RESET ROLE;
END $$;
SELECT pg_temp.expect_true('this and the following: the last two are cancelled',
  (SELECT array_agg(cancelled_at IS NOT NULL ORDER BY starts_at) FROM public.meetings
    WHERE series_id = (SELECT v FROM zz_ids WHERE k = 'weekly')) = array[false, false, true, true]);
SELECT pg_temp.expect_true('Ana heard of the cancellation once',
  (SELECT count(*) FROM public.notifications n JOIN public.meetings m ON m.id = n.meeting_id
    WHERE m.series_id = (SELECT v FROM zz_ids WHERE k = 'weekly') AND n.kind = 'meeting_cancelled'
      AND n.user_id = (SELECT v FROM zz_ids WHERE k = 'ana')) = 1);
SELECT pg_temp.expect_true('Ana cannot cancel a meeting',
  pg_temp.refused((SELECT v FROM zz_ids WHERE k = 'ana'),
    format($q$SELECT public.meeting_cancel(%L, 'one')$q$,
      (SELECT id FROM public.meetings WHERE series_id = (SELECT v FROM zz_ids WHERE k = 'weekly') ORDER BY starts_at LIMIT 1))));

-- Moving "this and the following" by an hour from the second keeps the first.
DO $$
DECLARE m2 uuid := (SELECT id FROM public.meetings WHERE series_id = (SELECT v FROM zz_ids WHERE k = 'weekly') ORDER BY starts_at OFFSET 1 LIMIT 1);
BEGIN
  PERFORM pg_temp.as_user((SELECT v FROM zz_ids WHERE k = 'admin'));
  SET LOCAL ROLE authenticated;
  PERFORM public.meeting_update(m2, 'following', 'ZZ weekly', null,
            timestamptz '2026-10-27 10:00 Europe/London', timestamptz '2026-10-27 11:00 Europe/London', null, null,
            array[(SELECT v FROM zz_ids WHERE k = 'ana')]);
  RESET ROLE;
END $$;
SELECT pg_temp.expect_true('the first stays at 09:00; the second moves to 10:00 for an hour',
  (SELECT array_agg(to_char(starts_at AT TIME ZONE 'Europe/London', 'DD/MM HH24:MI') || '+' || extract(epoch FROM ends_at - starts_at)::int / 60
                    ORDER BY starts_at)
     FROM public.meetings WHERE series_id = (SELECT v FROM zz_ids WHERE k = 'weekly') AND cancelled_at IS NULL)
  = array['20/10 09:00+30', '27/10 10:00+60']);

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
