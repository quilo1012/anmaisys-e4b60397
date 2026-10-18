-- A yes is a booking. The ask says when, not how many.
--
-- WHAT WAS THERE. An ask carried a number ("10 people needed"), every yes waited for a
-- supervisor to press Accept, and only an accepted yes reached the board. On the floor
-- that is not how overtime is run: the supervisor asks, whoever says yes comes in, and
-- the supervisor wants to KNOW who said yes, not to approve each of them. The number
-- was a guess typed into a box, and the Accept press was a second step that left
-- people who had said yes unsure whether they were coming.
--
-- WHAT THIS DOES.
--   1. `overtime_requests.headcount` is optional. Empty: everybody who says yes is
--      booked. A number: the first that many are booked and the rest go on reserve.
--   2. A person's own yes is booked as it is written (a trigger, so it holds whatever
--      body of `answer_overtime` the database runs). Everything that already refused
--      a yes — audience, block, clash, started — still refuses it first. Booked is
--      `accepted`, which is what draws it on the board (the bridge trigger). After
--      that the phone cannot take it back (`answer_overtime` refuses a decided row):
--      a booked shift is changed by talking to the supervisor (4).
--   3. Two bell rows: the person ("You're booked") and whoever posted the ask
--      ("Ana is coming in").
--   4. `message_overtime_supervisor(ask, text)`: the employee writes to whoever posted
--      the ask, in the app's chat (`direct_messages`). The chat's routing policy only
--      lets operators and staff write, so this goes through a function that checks the
--      one case it allows: a linked employee, about an ask they can see, to the person
--      who posted it. The supervisor gets a bell row too.
--   5. "dm_insert_reply": anybody may answer somebody who wrote to them. Without it
--      the supervisor could read the employee in Messages and not reply. Added beside
--      the routing policy, not in place of it (permissive policies OR together).
--
-- No row is rewritten: answers already given keep their decision, or lack of one.

-- ── 1. No number needed ─────────────────────────────────────────────────────
alter table public.overtime_requests alter column headcount drop not null;

-- The bell text for a new ask read "need " || headcount, which is NULL for an ask
-- with no number — and a NULL body is a failed insert, swallowed by the warning.
create or replace function public.overtime_request_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_title text := 'New overtime available';
  v_body  text;
begin
  if new.status <> 'open' then return null; end if;
  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.on_date = new.on_date and old.starts_at = new.starts_at
     and old.ends_at = new.ends_at
     and old.department is not distinct from new.department
     and old.shift_group is not distinct from new.shift_group then
    return null;
  end if;

  v_body := to_char(new.on_date, 'Dy DD/MM') || ' · '
         || (case when extract(hour from new.starts_at) >= 6 and extract(hour from new.starts_at) < 18
                  then 'Day' else 'Night' end) || ' · '
         || left(new.starts_at::text, 5) || '–' || left(new.ends_at::text, 5)
         || coalesce(' · ' || new.department, '')
         -- An ask with no number (BLOCO 102) says nothing about one.
         || coalesce(' · need ' || new.headcount, '');

  begin
    insert into public.notifications
      (user_id, kind, overtime_request_id, title, body, priority, action_url)
    select t.user_id, 'overtime_new', new.id, v_title, v_body, 'medium',
           '/dashboard/my-overtime?ask=' || new.id
      from public.overtime_notify_targets(new.id) t
    on conflict (user_id, kind, overtime_request_id) do nothing;
  exception when others then
    -- The ask is the record; the bell is a courtesy. Never roll the ask back for it.
    raise warning 'overtime_request_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- ── 2. A yes is a booking ───────────────────────────────────────────────────
-- A trigger, not a new `answer_overtime`. Production runs an older body of that
-- function than the repository's newest (BLOCO 87 is not in), and the catch-up paste
-- would put 87's body back over any later one. A trigger on the row is the same in
-- either state: whatever writes the person's own yes, the row comes out booked.
--
-- Named so it runs LAST among the BEFORE triggers (they fire in name order): the
-- schedule-clash and not-started guards read the row while it is still a fresh,
-- undecided yes, and refuse it before it is booked. The capacity guard (BLOCO 101)
-- has already passed an undecided row by then, so the number is counted here.
create or replace function public.overtime_response_book_on_yes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_user  uuid;
  v_name  text;
  v_taken integer := 0;
  v_when  text;
begin
  if new.answer is distinct from 'yes' or new.decision is not null then return new; end if;
  if tg_op = 'UPDATE' and old.answer = 'yes' then return new; end if;

  -- Only the person's own yes, from their own login. A yes typed in at the desk by a
  -- supervisor stays undecided: the supervisor accepts it, as before.
  select user_id, full_name into v_user, v_name from public.employees where id = new.employee_id;
  if auth.uid() is null or v_user is distinct from auth.uid() then return new; end if;

  -- Locked: two yeses racing for the last numbered place are served in turn.
  select * into v_req from public.overtime_requests where id = new.request_id for update;
  if v_req.id is null or v_req.status <> 'open' then return new; end if;

  if v_req.headcount is not null then
    select count(*)::int into v_taken
      from public.overtime_responses r
     where r.request_id = new.request_id and r.decision = 'accepted' and r.id <> new.id
       and not exists (select 1 from public.overtime_outcomes o
                        where o.response_id = r.id and o.outcome <> 'attended');
  end if;

  new.decision   := case when v_req.headcount is not null and v_taken >= v_req.headcount
                         then 'reserve' else 'accepted' end;
  new.decided_at := now();
  new.decided_by := auth.uid();

  -- 3. Tell the person and whoever posted the ask. A courtesy: never undo the booking.
  v_when := to_char(v_req.on_date, 'Dy DD/MM') || ' · ' || left(v_req.starts_at::text, 5)
            || '–' || left(v_req.ends_at::text, 5) || coalesce(' · ' || v_req.department, '');
  begin
    insert into public.notifications (user_id, kind, title, body, priority, action_url)
    values (v_user, 'overtime_booked',
            case when new.decision = 'accepted' then 'You''re booked for overtime'
                 else 'You''re on the overtime reserve list' end,
            v_when, 'medium', '/dashboard/my-overtime?ask=' || v_req.id);
    if v_req.created_by is not null and v_req.created_by <> v_user then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_req.created_by, 'overtime_yes',
              coalesce(v_name, 'Somebody') ||
                case when new.decision = 'accepted' then ' is coming in' else ' said yes (on reserve)' end,
              v_when, 'medium', '/dashboard/overtime');
    end if;
  exception when others then
    raise warning 'overtime_response_book_on_yes notify(%): %', new.request_id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.overtime_response_book_on_yes() from public, anon, authenticated;

drop trigger if exists overtime_response_zz_book_on_yes_t on public.overtime_responses;
create trigger overtime_response_zz_book_on_yes_t
  before insert or update of answer on public.overtime_responses
  for each row execute function public.overtime_response_book_on_yes();

-- ── 4. A word to the supervisor ─────────────────────────────────────────────
create or replace function public.message_overtime_supervisor(p_request_id uuid, p_message text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_emp   uuid := public.my_employee_id();
  v_req   public.overtime_requests;
  v_dept  text;
  v_shift text;
  v_name  text;
  v_text  text := btrim(coalesce(p_message, ''));
  v_id    uuid;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if length(v_text) = 0 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(v_text) > 1000 then
    raise exception 'Keep it under 1000 characters' using errcode = 'P0001';
  end if;

  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'No such overtime' using errcode = 'P0001';
  end if;
  select department, shift_group, full_name into v_dept, v_shift, v_name
    from public.employees where id = v_emp;
  -- Only about an ask this person answered, or one that was put to them.
  if not exists (select 1 from public.overtime_responses where request_id = p_request_id and employee_id = v_emp)
     and ((v_req.department is not null and v_req.department is distinct from v_dept)
       or (v_req.shift_group is not null and v_req.shift_group is distinct from v_shift)) then
    raise exception 'This overtime was not asked of you' using errcode = 'P0001';
  end if;
  if v_req.created_by is null or v_req.created_by = auth.uid() then
    raise exception 'Nobody to send it to: this overtime has no supervisor on file' using errcode = 'P0001';
  end if;

  insert into public.direct_messages (sender_id, sender_name, recipient_id, message)
  values (
    auth.uid(), coalesce(v_name, 'Employee'), v_req.created_by,
    'Overtime ' || to_char(v_req.on_date, 'Dy DD/MM') || ' ' || left(v_req.starts_at::text, 5)
      || '–' || left(v_req.ends_at::text, 5) || ': ' || v_text)
  returning id into v_id;

  begin
    insert into public.notifications (user_id, kind, title, body, priority, action_url)
    values (v_req.created_by, 'overtime_message',
            coalesce(v_name, 'An employee') || ' sent you a message',
            left(v_text, 200), 'medium', '/dashboard/messages');
  exception when others then
    raise warning 'message_overtime_supervisor notify(%): %', p_request_id, sqlerrm;
  end;
  return v_id;
end;
$$;

revoke all on function public.message_overtime_supervisor(uuid, text) from public, anon;
grant execute on function public.message_overtime_supervisor(uuid, text) to authenticated;

-- ── 5. Anybody may answer somebody who wrote to them ────────────────────────
drop policy if exists "dm_insert_reply" on public.direct_messages;
create policy "dm_insert_reply" on public.direct_messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> recipient_id
    and exists (select 1 from public.direct_messages d
                 where d.sender_id = direct_messages.recipient_id
                   and d.recipient_id = auth.uid())
  );
