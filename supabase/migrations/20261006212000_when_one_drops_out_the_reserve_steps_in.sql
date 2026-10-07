-- When one drops out, the reserve steps in.
--
-- The supervisor accepts four and marks one or two as reserve, because somebody always
-- rings in sick. Then somebody rings in sick, and the supervisor has to notice, open the
-- ask, find the reserve, and press Accept — on a phone, between two other problems. The
-- reserve exists so that this is not a decision; so the database makes it not one.
--
-- Recording an outcome goes through this function. When the outcome says an ACCEPTED
-- person will not be there (sick, no-show, cancelled either way) and the ask is still
-- open, the longest-waiting reserve is promoted to accepted, stamped with the recorder,
-- and returned — so the screen can tell that person their place opened. Attended, or a
-- drop-out on an ask already closed, promotes nobody. One promotion per outcome: a
-- second drop-out promotes the next reserve on its own call.
--
-- Idempotent.

create or replace function public.record_overtime_outcome(
  p_response_id uuid,
  p_outcome     text,
  p_note        text default null
)
returns table (promoted_response_id uuid, promoted_employee_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_resp  public.overtime_responses;
  v_next  public.overtime_responses;
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Only somebody who manages overtime can record an outcome' using errcode = '42501';
  end if;
  if p_outcome not in ('attended', 'no_show', 'called_sick', 'cancelled_in_time', 'cancelled_late') then
    raise exception 'Unknown outcome %', p_outcome using errcode = 'P0001';
  end if;

  select * into v_resp from public.overtime_responses where id = p_response_id for update;
  if v_resp.id is null then
    raise exception 'No such response' using errcode = 'P0001';
  end if;
  select * into v_req from public.overtime_requests where id = v_resp.request_id for update;

  insert into public.overtime_outcomes (response_id, outcome, note, recorded_by, recorded_at)
  values (p_response_id, p_outcome, p_note, auth.uid(), now())
  on conflict (response_id) do update
    set outcome = excluded.outcome, note = excluded.note,
        recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;

  -- Somebody who was in is now out, and there is still a shift to fill.
  if v_resp.decision = 'accepted'
     and p_outcome <> 'attended'
     and v_req.status = 'open'
  then
    select * into v_next
      from public.overtime_responses r
     where r.request_id = v_req.id
       and r.decision = 'reserve'
       and r.answer = 'yes'
       and not exists (select 1 from public.overtime_outcomes o where o.response_id = r.id)
     order by r.answered_at
     limit 1
     for update skip locked;

    if v_next.id is not null then
      update public.overtime_responses
         set decision = 'accepted', decided_at = now(), decided_by = auth.uid()
       where id = v_next.id;
      return query select v_next.id, v_next.employee_id;
      return;
    end if;
  end if;

  return;
end;
$$;

grant execute on function public.record_overtime_outcome(uuid, text, text) to authenticated;
