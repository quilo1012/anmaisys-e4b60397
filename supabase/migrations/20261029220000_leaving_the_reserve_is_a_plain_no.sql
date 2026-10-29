-- Leaving the reserve list is a plain "no", so the person can say yes again.
--
-- WHAT HAPPENED. 29/10/2026 20:29 UTC: Rosana (E129) said yes to Fri 30/10, 06:00–18:00.
-- Both places were taken, so the yes was put on the reserve. Nine seconds later she pressed
-- "Leave the reserve list". `leave_my_reserve` set answer = 'no' and left
-- decision = 'reserve' behind. From then on:
--   * answer_overtime refused every new answer with "The supervisor has already decided on
--     your answer" — nobody had; the decision was the reserve she had just left;
--   * My Overtime drew no buttons at all, because an answer can be changed only while
--     there is no decision, so "Change to Accept" never appeared;
--   * the row said "no" and "reserve" at once.
-- A plain no (decision null) could already become a yes (#745, 24/10). Only this path was
-- a dead end. It was the one such row in production at 21:00 on 29/10.
--
-- WHAT CHANGES
--   1. leave_my_reserve clears the decision together with the answer: answer = 'no',
--      decision, decided_at and decided_by back to null — the same row a plain no is.
--      The audit trigger writes answered_no (yes → no) and decision_cleared
--      (reserve → null), so the original yes, the reserve place and when it was left all
--      stay in overtime_audit.
--      A later yes goes through answer_overtime and the same triggers as any first yes:
--      open ask, crew and department, no-show block, rota clash, rest between shifts, not
--      started, and the capacity count with the ask's row locked. It comes back booked if
--      a place is free, or at the END of the reserve list (answered_at moves with the
--      answer), never ahead of somebody who stayed on it.
--   2. Repair: responses the old function left as answer = 'no' with decision = 'reserve'
--      and no outcome get the same treatment. Nothing else is touched.
--
-- NOT CHANGED: answer_overtime (BLOCO 128 replaces it separately), cancel_my_overtime (a
-- booked person still cancels, under the late-cancel rule), a supervisor's decline, and
-- the bells. Leaving the reserve rings nobody, as before.
--
-- Idempotent: create or replace, and an update that finds nothing the second time.

create or replace function public.leave_my_reserve(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_emp uuid := public.my_employee_id();
  v_resp public.overtime_responses;
begin
  if v_emp is null then
    raise exception 'Your login is not linked to an employee record' using errcode = '42501';
  end if;
  select * into v_resp from public.overtime_responses
   where request_id = p_request_id and employee_id = v_emp
   for update;
  if v_resp.id is null then
    raise exception 'You have no answer on this overtime ask' using errcode = '42501';
  end if;
  if v_resp.decision is distinct from 'reserve' then
    raise exception 'Only a place on the reserve list can be left this way' using errcode = '42501';
  end if;
  -- Off the list is a plain no: no decision left behind, so a yes can be given again.
  update public.overtime_responses
     set answer = 'no', decision = null, decided_at = null, decided_by = null
   where id = v_resp.id;
end;
$$;

revoke all on function public.leave_my_reserve(uuid) from public, anon;
grant execute on function public.leave_my_reserve(uuid) to authenticated;

do $$
declare v_n integer;
begin
  update public.overtime_responses r
     set decision = null, decided_at = null, decided_by = null
   where r.answer = 'no' and r.decision = 'reserve'
     and not exists (select 1 from public.overtime_outcomes o where o.response_id = r.id);
  get diagnostics v_n = row_count;
  raise notice 'Left the reserve, now a plain no: %', v_n;
end $$;

notify pgrst, 'reload schema';
