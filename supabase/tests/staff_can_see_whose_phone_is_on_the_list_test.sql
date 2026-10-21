-- Tests for 20261021260000_staff_can_see_whose_phone_is_on_the_list.sql (BLOCO 123).
-- Run this WHOLE file in one go in the Supabase SQL Editor after BLOCO 123. One transaction,
-- throwaway people, ROLLBACK at the end; the last statement prints 'ALL TESTS PASSED'.

BEGIN;

CREATE FUNCTION pg_temp.ok(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.as_user(_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _user)::text, true);
END $$;

DO $$
DECLARE
  u_adm uuid := gen_random_uuid();
  u_iph uuid := gen_random_uuid();
  u_and uuid := gen_random_uuid();
  u_none uuid := gen_random_uuid();
  n int; r record;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  SELECT u, 'zz-' || u || '@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
    FROM unnest(ARRAY[u_adm, u_iph, u_and, u_none]) u;
  INSERT INTO public.user_roles (user_id, role) VALUES (u_adm, 'admin'), (u_iph, 'employee'), (u_and, 'employee'), (u_none, 'employee');
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES
    (u_iph, 'https://web.push.apple.com/zz-1', 'p', 'a'),
    (u_and, 'https://fcm.googleapis.com/fcm/send/zz-2', 'p', 'a'),
    (u_and, 'https://web.push.apple.com/zz-3', 'p', 'a');

  -- 1. Staff sees who has phones, of what kind, and how many.
  PERFORM pg_temp.as_user(u_adm);
  SELECT * INTO r FROM public.push_coverage() WHERE user_id = u_iph;
  PERFORM pg_temp.ok('1a an iPhone is reported as one', r.phones = 1 AND r.platforms = ARRAY['iPhone/iPad']);
  SELECT * INTO r FROM public.push_coverage() WHERE user_id = u_and;
  PERFORM pg_temp.ok('1b two phones of two kinds', r.phones = 2 AND r.platforms @> ARRAY['Android/Chrome', 'iPhone/iPad']);

  -- 2. Somebody with no phone is simply absent: that is how "off" is read.
  SELECT count(*) INTO n FROM public.push_coverage() WHERE user_id = u_none;
  PERFORM pg_temp.ok('2 no phone, no row', n = 0);

  -- 3. An employee sees nothing, not even their own row.
  PERFORM pg_temp.as_user(u_iph);
  SELECT count(*) INTO n FROM public.push_coverage();
  PERFORM pg_temp.ok('3 an employee gets no rows', n = 0);

  -- 4. Nobody signed in, nothing; and anon cannot even call it.
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO n FROM public.push_coverage();
  PERFORM pg_temp.ok('4a no login, no rows', n = 0);
  PERFORM pg_temp.ok('4b anon has no execute', NOT has_function_privilege('anon', 'public.push_coverage()', 'execute'));

  -- 5. The endpoint and the keys never leave.
  PERFORM pg_temp.ok('5 the result has no endpoint or key column', NOT EXISTS (
    SELECT 1 FROM pg_proc p, unnest(p.proargnames) a
     WHERE p.proname = 'push_coverage' AND a IN ('endpoint', 'p256dh', 'auth')));
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
