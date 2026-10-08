-- The eligibility rule had one reader, and it was the screen.
--
-- `requestIsForEmployee` in src/lib/overtimeRequests.ts narrows what a person sees: an
-- ask carrying a department is for that department, an ask carrying a shift group is
-- for that shift group, and a null on the ask means it was not narrowed. It runs in
-- MyOvertimePage and nowhere else.
--
-- Underneath it, `overtime_requests_read` is `using (true)` and `answer_overtime`
-- checked three things: that the login has an employee row, that the answer is yes or
-- no, and that the ask is open. Not the department. Not the shift group. So the rule
-- was a filter on a list rather than a rule — one `rpc('answer_overtime')` from a
-- console put a night packer into a day ask, and the supervisor's screen showed them
-- among the interested with nothing to say they should not be there.
--
-- The same two narrowings, in the same direction, now run where the row is written.
-- Null on the ask still means "not narrowed", and a person with no department set is
-- still not quietly included in one they were never put in — that asymmetry is the
-- screen's rule too, and it is deliberate: the ask reaches everybody only when nobody
-- said who it was for.
--
-- The read policy stays `using (true)` on purpose, and that is not an oversight. A
-- supervisor has to read every ask to run the board, and narrowing the select would
-- have to carve them out with `can_manage_overtime` — a second copy of the rule, in a
-- place where getting it wrong hides asks from the people who manage them. Seeing an
-- ask was never the thing that mattered; answering it is, and that is what this closes.
--
-- This replaces the whole function, so it carries the block from
-- 20261006220000_a_rule_the_floor_can_read.sql verbatim. The first draft was written
-- against the version before that one and would have dropped it: a person kept out for
-- a no-show could sign up again the moment this ran. Found by reading
-- pg_get_functiondef in production before applying, not by any test.

create or replace function public.answer_overtime(p_request_id uuid, p_answer text)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp     uuid := public.my_employee_id();
  v_req     public.overtime_requests;
  v_dept    text;
  v_shift   text;
  v_row     public.overtime_responses;
  v_block   record;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if p_answer not in ('yes', 'no') then
    raise exception 'Answer must be yes or no' using errcode = 'P0001';
  end if;

  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null or v_req.status <> 'open' then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;

  -- Who the answerer is, as the ask measures them.
  select department, shift_group into v_dept, v_shift
    from public.employees where id = v_emp;

  if v_req.department is not null and v_req.department is distinct from v_dept then
    raise exception 'This overtime is for % and you are not in it', v_req.department
      using errcode = 'P0001';
  end if;
  if v_req.shift_group is not null and v_req.shift_group is distinct from v_shift then
    raise exception 'This overtime is for the % crew', v_req.shift_group
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.overtime_responses
              where request_id = p_request_id and employee_id = v_emp and decision is not null) then
    raise exception 'The supervisor has already decided on your answer' using errcode = 'P0001';
  end if;
  -- A "no" is always allowed: it is information, not a request.
  if p_answer = 'yes' then
    select * into v_block from public.overtime_block_for(v_emp);
    if v_block.blocked_until is not null then
      raise exception 'You can''t sign up for overtime until %. (Missed overtime on %.)',
        to_char(v_block.blocked_until, 'DD/MM'), to_char(v_block.on_date, 'DD/MM')
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.overtime_responses (request_id, employee_id, answer)
  values (p_request_id, v_emp, p_answer)
  on conflict (request_id, employee_id)
  do update set answer = excluded.answer, answered_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.answer_overtime(uuid, text) to authenticated;
