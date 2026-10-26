-- A direct message rings the bell of whoever it is for.
--
-- WHAT WAS THERE. `dm_employee_bell` (BLOCO 114) wrote a bell row in three cases only:
--   1. an employee writing through the overtime door (`app.dm_door = 'employee'`);
--   2. an employee writing to another employee;
--   3. anybody writing to an employee or operator with an active employee record
--      ("Your supervisor replied").
-- A message to anybody else matched none of them: a supervisor writing to a manager, an
-- admin to a supervisor, an employee answering a manager in the Communication Hub. No bell
-- row was written, so the bell stayed silent and BLOCO 117 had nothing to push to the
-- phone. "Chat messages don't notify" on 26/10/2026.
--
-- WHAT THIS DOES. The three cases above are unchanged, word for word. Every other direct
-- message now writes a 'chat_message' row for its recipient: "<sender> sent you a
-- message", the first 200 characters, opening that conversation in Messages
-- (`/dashboard/messages?c=dm:<sender>`, which the redirect keeps). BLOCO 117's trigger
-- pushes it to the phone like every other 'chat_message'.
--
-- Group messages are not touched (`chat_group_message_bell`, BLOCO 109, already rings
-- every member). The supervisor door (`message_my_supervisor`) writes its own row and
-- sets `app.dm_door`, so it stays in case 1 and is not rung twice.
--
-- Only the function body changes; the trigger `dm_employee_bell_t` already calls it.
-- No table, column, policy or data changes. A failure still only warns: the message is
-- the record, the bell a courtesy.

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
    elsif public.has_role(new.sender_id, 'employee'::app_role)
          and public.has_role(new.recipient_id, 'employee'::app_role) then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'chat_message',
              coalesce(nullif(new.sender_name, ''), 'A colleague') || ' sent you a message',
              left(new.message, 200), 'medium', '/dashboard/messages?c=dm:' || new.sender_id);
    elsif (public.has_role(new.recipient_id, 'employee'::app_role)
           or public.has_role(new.recipient_id, 'operator'::app_role))
          and exists (select 1 from public.employees e where e.user_id = new.recipient_id and e.active) then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'chat_message',
              coalesce(nullif(new.sender_name, ''), 'Your supervisor') || ' replied',
              left(new.message, 200), 'medium', '/dashboard/my-overtime?chat=supervisor');
    else
      -- BLOCO 134: every other direct message. Staff to staff (admin, manager,
      -- supervisor, engineer, planner…) and an employee answering staff in the hub wrote
      -- no bell row at all, so nothing reached the bell or, through BLOCO 117, the phone.
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'chat_message',
              coalesce(nullif(new.sender_name, ''), 'Somebody') || ' sent you a message',
              left(new.message, 200), 'medium', '/dashboard/messages?c=dm:' || new.sender_id);
    end if;
  exception when others then
    raise warning 'dm_employee_bell(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.dm_employee_bell() from public, anon, authenticated;

notify pgrst, 'reload schema';
