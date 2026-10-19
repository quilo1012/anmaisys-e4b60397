-- ================================================================
-- BLOCO 107
-- 20261019140000_the_supervisor_on_file_is_told.sql
-- ================================================================
--
-- O SUPERVISOR DA FICHA: a confirmacao de overtime ("Ana is coming in") passa a ir ao
-- supervisor da ficha do funcionario (campo Manager, employees.manager_id) E a quem
-- publicou o pedido, uma vez a cada um. O chat do funcionario passa a escrever ao
-- supervisor da ficha (ou, sem ficha, a quem publicou o pedido), e ganha uma conversa
-- sem pedido ("Message <nome>" no My Overtime). A resposta do supervisor passa a tocar
-- o sino do funcionario. Uma mensagem repetida em 2 minutos nao e duplicada. Quem
-- recebe uma mensagem so pode marca-la como lida, nao reescreve-la.
-- Precisa dos BLOCOS 100, 102 e 105. Nao reescreve linha nenhuma. Pode colar-se duas vezes.
-- Teste depois: supabase/tests/supervisor_on_file_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- The supervisor on file is told, and is the one the employee writes to.
--
-- WHAT WAS THERE. Since BLOCO 102 an employee's yes books the shift, and whoever
-- POSTED the ask is told ("Ana is coming in") and is the one `message_overtime_supervisor`
-- writes to. The person's own supervisor — `employees.manager_id`, the "Manager" field
-- on the employee's record — was never read by overtime at all. An employee with no
-- ask in front of them had no way to write to anybody: the chat's routing policy lets
-- only operators and staff start a conversation. And a reply from the supervisor
-- reached the employee only as a live toast: nothing in `notifications`, so a phone
-- that was closed when it arrived never heard of it.
--
-- The rule asked for on 19/10: confirmation and chat go to the employee's assigned
-- supervisor, resolved from the application's own relationship.
--
-- WHAT THIS DOES.
--   1. `supervisor_login_of(employee)`: the login of the employee's manager on file
--      (`employees.manager_id` → that record's `user_id`, active). Internal only.
--   2. `my_supervisor()`: the same, for the signed-in employee, with a name — so the
--      screen can say who the conversation is with.
--   3. `overtime_response_booked_notify` (BLOCO 105's body, one change): the "is coming
--      in" row goes to the supervisor on file AND to whoever posted the ask, once each
--      per person per ask — only when the answer is first decided, so a retry or a
--      reserve later accepted does not ring again, and one login holding both roles is
--      rung once. Nobody is told about their own action.
--   4. `message_overtime_supervisor(ask, text)`: written to the supervisor on file,
--      or to whoever posted the ask when nobody is on file (the old behaviour). The
--      same text from the same person to the same person within two minutes is a
--      retry and returns the message already written instead of a second one.
--   5. `message_my_supervisor(text)`: the same, with no ask — for "My supervisor" on
--      My Overtime. Only ever to the supervisor on file; the function picks the
--      recipient, so no request can aim it at anybody else.
--   6. Bell rows from a trigger on `direct_messages`: a message through the
--      employee's door rings the supervisor (as before), and a message to a floor login
--      linked to an employee — the supervisor's reply from Messages — rings the
--      employee, which nothing did. The two functions above stop writing their own, so
--      each message rings once. Staff-to-staff and operator chat are untouched.
--   7. `direct_messages` UPDATE: the recipient's policy ("dm_update_mark_read") let
--      them change ANY column of a message sent to them, text included. A trigger now
--      allows only `read_at` to change. No policy is created or changed.
--
-- Nothing is rewritten: no message, notification or overtime row is updated. Needs
-- BLOCOS 100 (notifications.kind), 102 and 105.

-- ── 1. Who supervises a person ──────────────────────────────────────────────
-- The column is in production (the "Manager" field, probed 19/10: 200, and in
-- types.ts with employees_manager_id_fkey) but no migration in this repository
-- creates it. Declared here so the repository builds the schema it runs on; a no-op
-- where it already exists.
alter table public.employees
  add column if not exists manager_id uuid references public.employees(id) on delete set null;

create or replace function public.supervisor_login_of(p_employee uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select m.user_id
    from public.employees e
    join public.employees m on m.id = e.manager_id
   where e.id = p_employee
     and m.active
     and m.user_id is not null
     and m.user_id is distinct from e.user_id;
$$;
revoke all on function public.supervisor_login_of(uuid) from public, anon, authenticated;

-- ── 2. Mine ─────────────────────────────────────────────────────────────────
create or replace function public.my_supervisor()
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = public
as $$
  select m.user_id, m.full_name
    from public.employees e
    join public.employees m on m.id = e.manager_id
   where e.id = public.my_employee_id()
     and m.active
     and m.user_id is not null
     and m.user_id is distinct from auth.uid();
$$;
revoke all on function public.my_supervisor() from public, anon;
grant execute on function public.my_supervisor() to authenticated;

-- ── 3. Telling: the supervisor on file, and the poster, once each ───────────
create or replace function public.overtime_response_booked_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req  public.overtime_requests;
  v_user uuid;
  v_name text;
  v_when text;
  v_to   uuid;
begin
  if new.decision is null or new.decision not in ('accepted', 'reserve') then return null; end if;
  if tg_op = 'UPDATE' and old.decision is not distinct from new.decision then return null; end if;

  begin
    select * into v_req from public.overtime_requests where id = new.request_id;
    select user_id, full_name into v_user, v_name from public.employees where id = new.employee_id;
    v_when := to_char(v_req.on_date, 'Dy DD/MM') || ' · ' || left(v_req.starts_at::text, 5)
              || '–' || left(v_req.ends_at::text, 5) || coalesce(' · ' || v_req.department, '');

    if v_user is not null then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_user, 'overtime_booked',
              case when new.decision = 'accepted' then 'You''re booked for overtime'
                   else 'You''re on the overtime reserve list' end,
              v_when, 'medium', '/dashboard/my-overtime?ask=' || v_req.id);
    end if;

    -- The supervisor on file and the poster, unless they did it themselves, or nobody
    -- did (the one-off backlog of BLOCO 105). Once per person per ask: only when the
    -- answer is first decided, so a reserve later accepted, or a retried yes, does not
    -- ring again — and `distinct`, so one login holding both roles is rung once.
    -- (Not BLOCO 100's unique key: that is one row per ask, and an ask has many people.)
    if auth.uid() is not null and (tg_op = 'INSERT' or old.decision is null) then
      for v_to in
        select distinct t from unnest(array[public.supervisor_login_of(new.employee_id), v_req.created_by]) t
         where t is not null and t <> auth.uid() and t is distinct from v_user
      loop
        insert into public.notifications (user_id, kind, title, body, priority, action_url)
        values (v_to, 'overtime_yes',
                coalesce(v_name, 'Somebody') ||
                  case when new.decision = 'accepted' then ' is coming in' else ' said yes (on reserve)' end,
                v_when, 'medium', '/dashboard/overtime');
      end loop;
    end if;
  exception when others then
    -- The booking is the record; the bell is a courtesy. Never undo it for the bell.
    raise warning 'overtime_response_booked_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.overtime_response_booked_notify() from public, anon, authenticated;

-- ── 4 and 5. Writing to the supervisor ──────────────────────────────────────
-- One place that writes the message, so the two doors cannot drift apart.
create or replace function public.dm_from_employee(p_to uuid, p_name text, p_text text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  -- A retry is not a second message: the same words, to the same person, just now.
  select id into v_id from public.direct_messages
   where sender_id = auth.uid() and recipient_id = p_to and message = p_text
     and created_at > now() - interval '2 minutes'
   order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  -- Tells the bell trigger (6) this came through the employee's door.
  perform set_config('app.dm_door', 'employee', true);
  insert into public.direct_messages (sender_id, sender_name, recipient_id, message)
  values (auth.uid(), coalesce(p_name, 'Employee'), p_to, p_text)
  returning id into v_id;
  perform set_config('app.dm_door', '', true);
  return v_id;
end;
$$;
revoke all on function public.dm_from_employee(uuid, text, text) from public, anon, authenticated;

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
  v_to    uuid;
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

  v_to := coalesce(public.supervisor_login_of(v_emp), v_req.created_by);
  if v_to is null or v_to = auth.uid() then
    raise exception 'Nobody to send it to: no supervisor is on file for you or this overtime' using errcode = 'P0001';
  end if;

  return public.dm_from_employee(v_to, v_name,
    'Overtime ' || to_char(v_req.on_date, 'Dy DD/MM') || ' ' || left(v_req.starts_at::text, 5)
      || '–' || left(v_req.ends_at::text, 5) || ': ' || v_text);
end;
$$;
revoke all on function public.message_overtime_supervisor(uuid, text) from public, anon;
grant execute on function public.message_overtime_supervisor(uuid, text) to authenticated;

create or replace function public.message_my_supervisor(p_message text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_emp  uuid := public.my_employee_id();
  v_name text;
  v_text text := btrim(coalesce(p_message, ''));
  v_to   uuid;
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
  v_to := public.supervisor_login_of(v_emp);
  if v_to is null or v_to = auth.uid() then
    raise exception 'No supervisor is on file for you yet. Ask the office to set your manager.' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.employees where id = v_emp;
  return public.dm_from_employee(v_to, v_name, v_text);
end;
$$;
revoke all on function public.message_my_supervisor(text) from public, anon;
grant execute on function public.message_my_supervisor(text) to authenticated;

-- ── 6. A message to the supervisor, and the reply to the employee, ring once ─
-- Two cases, and nothing else, so staff-to-staff and operator-to-supervisor chat ring
-- exactly as they did:
--   * written through the employee's door (`dm_from_employee` sets `app.dm_door` for
--     the one insert): the supervisor is rung, kind `overtime_message` as before;
--   * written TO a floor login linked to an employee record (role employee or
--     operator) — the supervisor's reply from Messages: the employee is rung, and the
--     link opens their conversation on My Overtime.
create or replace function public.dm_employee_bell()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  begin
    if coalesce(current_setting('app.dm_door', true), '') = 'employee' then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'overtime_message',
              coalesce(nullif(new.sender_name, ''), 'An employee') || ' sent you a message',
              left(new.message, 200), 'medium', '/dashboard/messages');
    elsif (public.has_role(new.recipient_id, 'employee'::app_role)
           or public.has_role(new.recipient_id, 'operator'::app_role))
          and exists (select 1 from public.employees e where e.user_id = new.recipient_id and e.active) then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'chat_message',
              coalesce(nullif(new.sender_name, ''), 'Your supervisor') || ' replied',
              left(new.message, 200), 'medium', '/dashboard/my-overtime?chat=supervisor');
    end if;
  exception when others then
    raise warning 'dm_employee_bell(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.dm_employee_bell() from public, anon, authenticated;

drop trigger if exists dm_employee_bell_t on public.direct_messages;
create trigger dm_employee_bell_t
  after insert on public.direct_messages
  for each row execute function public.dm_employee_bell();

-- ── 7. Reading a message is the only change its recipient may make ─────────
create or replace function public.dm_only_read_at_changes()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.sender_id   is distinct from old.sender_id
  or new.recipient_id is distinct from old.recipient_id
  or new.sender_name is distinct from old.sender_name
  or new.message     is distinct from old.message
  or new.audio_url   is distinct from old.audio_url
  or new.image_url   is distinct from old.image_url
  or new.created_at  is distinct from old.created_at then
    raise exception 'A message can only be marked as read' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists dm_only_read_at_changes_t on public.direct_messages;
create trigger dm_only_read_at_changes_t
  before update on public.direct_messages
  for each row execute function public.dm_only_read_at_changes();

notify pgrst, 'reload schema';
