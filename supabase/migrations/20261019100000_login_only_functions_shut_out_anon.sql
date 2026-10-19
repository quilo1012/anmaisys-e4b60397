-- Functions for signed-in people only stop answering the anonymous key.
--
-- Same hole as 20261018120000: these were revoked from PUBLIC and granted to
-- authenticated, but this schema's default privileges grant anon EXECUTE by name, so
-- the publishable key could still call them. Measured 19/10/2026 in production with
-- has_function_privilege('anon', ...): true for all six. None leaked data on that day —
-- each refuses a null auth.uid() inside ("Sign in to see your attendance", "Not
-- allowed to link accounts"), and overtime_block_for answered an empty set — but the
-- body is then the only wall, and supabase/tests/an_employee_sees_only_their_own_test.sql
-- fails on my_attendance until the grant is gone.
--
-- Left open on purpose: the login screen's own functions (check_invite_code,
-- get_login_branding, list_tablet_accounts_public, signup_invite_code) and trigger
-- functions, which cannot be called as RPCs.
--
-- Idempotent. Guarded by to_regprocedure, so a function a later migration drops does
-- not stop the paste.

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.my_attendance(date, date)',
    'public.login_link_candidates()',
    'public.link_login_to_employee(uuid, uuid)',
    'public.unlink_login_from_employee(uuid)',
    'public.overtime_block_for(uuid)',
    'public.record_overtime_outcome(uuid, text, text)'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from anon', fn);
    end if;
  end loop;
end $$;
