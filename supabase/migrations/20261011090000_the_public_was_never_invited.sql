-- Two hundred and seven people's names, read without logging in.
--
-- Postgres grants EXECUTE on a new function to PUBLIC. Nothing in 20261006180000
-- takes that away: it ends with eight lines of
--
--     grant execute on function public.<name> to authenticated;
--
-- and a grant does not narrow what PUBLIC already holds. `check_invite_code` in
-- 20260723140000 gets this right — `REVOKE ALL ... FROM public` first, then the grant
-- — and these eight were written without it.
--
-- Measured against production on 11/10/2026 with the publishable key, which is in the
-- JavaScript every visitor downloads, and no session at all:
--
--     POST /rest/v1/rpc/overtime_unlinked_names   200   207 rows
--                                                       id, full_name, department, shift_group
--     POST /rest/v1/rpc/overtime_reliability      200   rows per employee, attendance among them
--     POST /rest/v1/rpc/overtime_roster           200   []
--     POST /rest/v1/rpc/my_employee_id            200   null
--
-- The last two are empty only because they read `auth.uid()`, which anonymous callers
-- do not have. That is luck, not a boundary: `overtime_reliability` takes a date and
-- answers for everybody, and it answered.
--
-- These functions are all SECURITY DEFINER, so the grant IS the boundary. There is no
-- RLS underneath to catch this — that is the point of definer rights, and the reason
-- the revoke is not optional.
--
-- NOT a fix for who among the signed-in may call them: 20261010100000 narrows
-- `overtime_unlinked_names` and `link_me_to_employee` away from `authenticated`, and
-- that stands. This closes the other door, which that migration left untouched —
-- revoking from `authenticated` while PUBLIC still holds EXECUTE changes nothing at
-- all, and both were written by the same hand on the same day.
--
-- Idempotent, and safe to run before or after 20261010100000.

revoke all on function public.answer_overtime(uuid, text)      from public;
revoke all on function public.link_me_to_employee(uuid)        from public;
revoke all on function public.overtime_reliability(date)       from public;
revoke all on function public.can_manage_overtime(uuid)        from public;
revoke all on function public.my_employee_id()                 from public;
revoke all on function public.overtime_roster()                from public;
revoke all on function public.my_overtime_identity()           from public;
revoke all on function public.overtime_unlinked_names()        from public;

-- Put back exactly what 20261006180000 meant to give, since REVOKE ... FROM public
-- also takes it from every role that only had it through PUBLIC. Named one by one so
-- this file says, on its own, who may call what.
--
-- `overtime_unlinked_names` and `link_me_to_employee` are deliberately absent: they
-- are revoked from `authenticated` by 20261010100000, and re-granting them here would
-- undo that migration from behind. If that one has not run yet, the screen that needs
-- them is the old "pick your name" one, which is the hole it exists to close.
grant execute on function public.answer_overtime(uuid, text)   to authenticated;
grant execute on function public.overtime_reliability(date)    to authenticated;
grant execute on function public.can_manage_overtime(uuid)     to authenticated;
grant execute on function public.my_employee_id()              to authenticated;
grant execute on function public.overtime_roster()             to authenticated;
grant execute on function public.my_overtime_identity()        to authenticated;

-- The two the floor's push needs, and the two the sign-up page calls before anybody
-- has a session. Listed here so the next person does not have to guess which of these
-- being anonymous is deliberate: these four are, the eight above were not.
revoke all on function public.overtime_push_targets(uuid, uuid[]) from public;
grant execute on function public.overtime_push_targets(uuid, uuid[]) to authenticated;
