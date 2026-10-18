-- Nobody without a session reads the roster, and nobody accepts their own overtime.
--
-- ONE. 20261011090000_the_public_was_never_invited revokes EXECUTE from PUBLIC on the
-- overtime functions. That is not enough here. This project's `public` schema has
-- ALTER DEFAULT PRIVILEGES that grant EXECUTE to anon, authenticated and service_role
-- on every new function (measured in the database, written down in
-- 20260911120000_o_lider_e_quem_abriu_a_linha_naquele_turno.sql): a function created
-- after the 27/06 sweep carries `anon=X` of its own, which revoking from PUBLIC does
-- not touch. Its test asks `has_function_privilege('public', ...)`, so it would print
-- ALL TESTS PASSED with the door still open.
--
-- Measured 18/10/2026 with the publishable key and no session:
--   overtime_unlinked_names  200, 192 rows: id, full name, department, crew
-- and my_employee_id, my_overtime_identity, my_overtime_block, overtime_roster and
-- overtime_reliability all answered 200 (empty only because auth.uid() is null).
--
-- Nothing on the login screen calls any of these: they are all signed-in screens, and
-- no policy written for anon or PUBLIC uses them. `overtime_unlinked_names` is not
-- called by the app at all any more.
--
-- Written as a loop over to_regprocedure so a function this database does not have
-- (a block not pasted yet) is skipped instead of failing the whole paste.
--
-- TWO. "overtime_responses_own" let an employee INSERT their own row while the ask is
-- open — and checked nothing else. `insert ... (answer, decision) values ('yes',
-- 'accepted')` went in: the bridge trigger drew them on the board as overtime, past the
-- department and crew audience, the no-show block, the schedule-clash guard (which
-- skips any row that already carries a decision) and the supervisor. The app answers
-- through `answer_overtime` (security definer, not subject to this policy); the policy
-- now admits only an undecided answer, which is all an employee may write.
-- Supervisors are unaffected: they write through "overtime_responses_decide".

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.overtime_unlinked_names()',
    'public.overtime_roster()',
    'public.overtime_reliability(date)',
    'public.my_employee_id()',
    'public.my_overtime_identity()',
    'public.my_overtime_block()',
    'public.can_manage_overtime(uuid)',
    'public.answer_overtime(uuid, text)',
    'public.link_me_to_employee(uuid)',
    'public.overtime_push_targets(uuid, uuid[])'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon', fn);
    end if;
  end loop;
end $$;

drop policy if exists "overtime_responses_own" on public.overtime_responses;
create policy "overtime_responses_own" on public.overtime_responses
  for insert to authenticated
  with check (
    employee_id = public.my_employee_id()
    and decision is null
    and decided_at is null
    and decided_by is null
    and exists (select 1 from public.overtime_requests r
                 where r.id = request_id and r.status = 'open')
  );
