-- cancel_my_overtime: an employee takes back their own confirmed overtime booking.
--
-- Until now only somebody who manages overtime could record what happened to a
-- booking (record_overtime_outcome), so a person who could no longer make it had to
-- find the supervisor. This gives the floor the same move, limited to their own
-- response, and only while the supervisor has not recorded an outcome yet.
--
-- Same rules as the supervisor's version: the clock decides cancelled_in_time vs
-- cancelled_late from overtime_rules.late_cancel_hours, the place goes to the oldest
-- reserve on an open ask, and the headcount board row is removed. Calling it twice
-- answers with the outcome already written instead of failing.
create or replace function public.cancel_my_overtime(p_request_id uuid, p_note text default null)
returns table (outcome text, promoted_response_id uuid, promoted_employee_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_emp      uuid := public.my_employee_id();
  v_resp     public.overtime_responses;
  v_req      public.overtime_requests;
  v_next     public.overtime_responses;
  v_existing public.overtime_outcomes;
  v_outcome  text;
  v_hours    integer := (select late_cancel_hours from public.overtime_rules where id);
  v_starts   timestamptz;
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

  -- Idempotent: a second tap returns what the first one wrote.
  select * into v_existing from public.overtime_outcomes where response_id = v_resp.id;
  if v_existing.response_id is not null then
    if v_existing.outcome in ('cancelled_in_time', 'cancelled_late') then
      return query select v_existing.outcome, null::uuid, null::uuid;
      return;
    end if;
    raise exception 'The supervisor has already recorded what happened on this shift' using errcode = '42501';
  end if;

  if v_resp.decision is distinct from 'accepted' then
    raise exception 'Only a confirmed booking can be cancelled' using errcode = '42501';
  end if;

  select * into v_req from public.overtime_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'No such overtime ask' using errcode = 'P0001';
  end if;

  -- In time or late, by the same rule the supervisor's record uses. Rule off = in time.
  v_starts := (v_req.on_date + v_req.starts_at)::timestamptz;
  v_outcome := case when v_hours > 0 and now() > v_starts - make_interval(hours => v_hours)
                    then 'cancelled_late' else 'cancelled_in_time' end;

  insert into public.overtime_outcomes (response_id, outcome, note, recorded_by, recorded_at)
  values (v_resp.id, v_outcome, nullif(btrim(p_note), ''), auth.uid(), now())
  on conflict (response_id) do nothing;

  -- The booking leaves the headcount board at once; the decision row stays as the
  -- record of what was agreed.
  perform public.overtime_board_apply(p_request_id, v_emp, false);

  -- The place goes to the oldest reserve, exactly as record_overtime_outcome does.
  if v_req.status = 'open' then
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
    end if;
  end if;

  return query select v_outcome, v_next.id, v_next.employee_id;
end;
$$;

revoke all on function public.cancel_my_overtime(uuid, text) from public, anon;
grant execute on function public.cancel_my_overtime(uuid, text) to authenticated;