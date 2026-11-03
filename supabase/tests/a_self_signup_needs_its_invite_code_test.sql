-- Tests for 20261103100000_a_self_signup_carries_its_invite_code.sql.
--
-- Run this WHOLE file in one go, in the SQL editor, after that migration. One
-- transaction, its own throwaway accounts and a temporary signup_config, ROLLBACK at the
-- end, so nothing it writes (accounts, roles, bells) survives. The last statement prints
-- 'ALL TESTS PASSED'; any failure raises first, naming the case. It must run as a role
-- that may insert into auth.users (the SQL editor's postgres role can).
--
-- The story is audit 2026-11-02, SEC-002: a POST to /auth/v1/signup with
-- `self_signup: "true"` and no code made an active account with the automatic role.

BEGIN;

CREATE FUNCTION pg_temp.expect_true(_case text, _got boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _case; END IF;
END $$;

CREATE FUNCTION pg_temp.sign_up(_meta jsonb) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE u uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          u::text || '@test.invalid', _meta, now(), now());
  RETURN u;
END $$;

-- An automatic role and a known, open code, for this transaction only.
UPDATE public.signup_config
   SET enabled = true, invite_code = 'TEST-CODE-142', invite_expires_at = now() + interval '1 hour',
       self_signup_role = 'employee'
 WHERE id;

DO $$
DECLARE
  honest uuid := pg_temp.sign_up('{"name":"Honest","self_signup":"true","invite_code":"TEST-CODE-142"}');
  no_code uuid := pg_temp.sign_up('{"name":"No code","self_signup":"true"}');
  wrong uuid := pg_temp.sign_up('{"name":"Wrong","self_signup":"true","invite_code":"NOPE"}');
BEGIN
  PERFORM pg_temp.expect_true('a sign-up with the code is active',
    (SELECT active FROM public.profiles WHERE id = honest));
  PERFORM pg_temp.expect_true('a sign-up with the code gets the automatic role',
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = honest AND role = 'employee'));

  PERFORM pg_temp.expect_true('a sign-up without a code waits inactive',
    (SELECT NOT active FROM public.profiles WHERE id = no_code));
  PERFORM pg_temp.expect_true('a sign-up without a code gets no role',
    NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = no_code));

  PERFORM pg_temp.expect_true('a sign-up with a wrong code waits inactive',
    (SELECT NOT active FROM public.profiles WHERE id = wrong));
  PERFORM pg_temp.expect_true('a sign-up with a wrong code gets no role',
    NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = wrong));
END $$;

-- An expired code is no code.
UPDATE public.signup_config SET invite_expires_at = now() - interval '1 minute' WHERE id;
DO $$
DECLARE late uuid := pg_temp.sign_up('{"name":"Late","self_signup":"true","invite_code":"TEST-CODE-142"}');
BEGIN
  PERFORM pg_temp.expect_true('an expired code gives no role',
    NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = late));
END $$;

SELECT 'ALL TESTS PASSED' AS result;

ROLLBACK;
