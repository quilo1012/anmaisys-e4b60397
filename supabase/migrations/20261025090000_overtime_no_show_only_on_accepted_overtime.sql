-- An overtime no-show is recorded only against overtime that was accepted and stands.
--
-- `record_overtime_outcome` checked who was calling and that the outcome was a known
-- word, and nothing about the booking. The Headcount Board only offers Present and
-- Absent on accepted bookings, but the function itself would write `no_show` against
-- a declined answer, a reserve never moved up, an ask that was called off, or a
-- booking the person had already cancelled in time — and a no-show counts against
-- them (overtime reliability, the no-show block in answer_overtime).
--
-- WHAT CHANGES: attended / no_show / called_sick now need decision = 'accepted' on a
-- request that is not cancelled, and no_show is refused over a cancellation. The
-- messages are the ones the board shows. Everything else is the body of
-- 20261023200000 (block 129, in production since 24/10), unchanged: the role check,
-- one outcome per response (on conflict (response_id) — a second mark is a
-- correction, never a duplicate), the overtime audit trigger on overtime_outcomes,
-- the board following a cancellation, and the reserve moving up.
--
-- Not applied by this file: paste it in the Lovable SQL editor.

create or replace function public.record_overtime_outcome(p_response_id uuid, p_outcome text, p_note text default null)
returns table (promoted_response_id uuid, promoted_employee_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_req     public.overtime_requests;
  v_resp    public.overtime_responses;
  v_next    public.overtime_responses;
  v_outcome text := p_outcome;
  v_before  text;
  v_hours   integer := (select late_cancel_hours from public.overtime_rules where id);
  v_starts  timestamptz;
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Only somebody who manages overtime can record an outcome' using errcode = '42501';
  end if;
  if v_outcome not in ('attended', 'no_show', 'called_sick', 'cancelled', 'cancelled_in_time', 'cancelled_late') then
    raise exception 'Unknown outcome %', v_outcome using errcode = 'P0001';
  end if;
  select * into v_resp from public.overtime_responses where id = p_response_id for update;
  if v_resp.id is null then
    raise exception 'No such response' using errcode = 'P0001';
  end if;
  select * into v_req from public.overtime_requests where id = v_resp.request_id for update;
  if v_outcome = 'cancelled' then
    v_starts := (v_req.on_date + v_req.starts_at)::timestamptz;
    v_outcome := case when v_hours > 0 and now() > v_starts - make_interval(hours => v_hours)
                      then 'cancelled_late' else 'cancelled_in_time' end;
  end if;
  select o.outcome into v_before from public.overtime_outcomes o where o.response_id = p_response_id;
  -- Attendance is only recorded against overtime that was accepted and still stands.
  -- A declined answer, a reserve that was never moved up, or an ask that was called
  -- off is not a no-show, and recording it as one would count against the person.
  if v_outcome in ('attended', 'no_show', 'called_sick') then
    if v_resp.decision is distinct from 'accepted' then
      raise exception 'This person did not accept this overtime, so an overtime no-show cannot be recorded'
        using errcode = 'P0001';
    end if;
    if v_req.status = 'cancelled' then
      raise exception 'This overtime was cancelled, so attendance cannot be recorded against it'
        using errcode = 'P0001';
    end if;
    if v_outcome = 'no_show' and v_before in ('cancelled_in_time', 'cancelled_late') then
      raise exception 'This booking was cancelled before the shift, so it cannot be an overtime no-show'
        using errcode = 'P0001';
    end if;
  end if;
  insert into public.overtime_outcomes (response_id, outcome, note, recorded_by, recorded_at)
  values (p_response_id, v_outcome, p_note, auth.uid(), now())
  on conflict (response_id) do update
    set outcome = excluded.outcome, note = excluded.note,
        recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;
  -- The board follows the booking: a cancellation takes the row off, as the
  -- employee's own cancel does; undoing a cancellation puts it back.
  if v_resp.decision = 'accepted' then
    if v_outcome in ('cancelled_in_time', 'cancelled_late') then
      perform public.overtime_board_apply(v_req.id, v_resp.employee_id, false);
    elsif v_before in ('cancelled_in_time', 'cancelled_late') then
      perform public.overtime_board_apply(v_req.id, v_resp.employee_id, true);
    end if;
  end if;
  if v_resp.decision = 'accepted' and v_outcome <> 'attended' and v_req.status = 'open' then
    select * into v_next
      from public.overtime_responses r
     where r.request_id = v_req.id and r.decision = 'reserve' and r.answer = 'yes'
       and not exists (select 1 from public.overtime_outcomes o where o.response_id = r.id)
     order by r.answered_at limit 1 for update skip locked;
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


notify pgrst, 'reload schema';
