-- ================================================================
-- BLOCO 114
-- 20261021170000_employees_can_write_to_each_other.sql
-- ================================================================
--
-- Um employee passa a poder comecar uma conversa com OUTRO employee, alem do supervisor
-- registado (que continua a ser pela porta `message_my_supervisor`). Ate aqui so podia
-- responder a quem lhe escrevia.
--
--   1. Nova politica de INSERT em `direct_messages` (as politicas somam-se; nenhuma das que
--      existem muda): remetente e destinatario com papel `employee`, nao a si proprio.
--   2. `chat_may_start` ganha a mesma clausula, para a lista do Communication Hub continuar
--      a ser exactamente o que o INSERT aceita (o teste hub_contactable_people confere par a par).
--   3. O sino: uma mensagem de um employee a outro toca "X sent you a message" e abre a
--      conversa no Messages. Antes, qualquer mensagem a um employee dizia "Your supervisor
--      replied" e abria o My Overtime — certo para o supervisor, errado para um colega.
--
-- Operadores, admins e managers: sem alteracoes. Um employee continua sem poder escrever
-- a operadores, a admins nem a managers (so ao supervisor registado, e a responder).
-- Nao muda nem apaga dados.
--
-- An employee may now start a conversation with another employee, as well as with the
-- supervisor on file (still through `message_my_supervisor`). Before, they could only answer
-- whoever wrote to them. A new additive INSERT policy on `direct_messages`; the same clause in
-- `chat_may_start` so the hub's list stays exactly what the insert accepts; and the bell says
-- "X sent you a message" (opening Messages) for a peer message, instead of "Your supervisor
-- replied". No other role changes. No data is touched.

drop policy if exists "dm_insert_employee_peers" on public.direct_messages;
create policy "dm_insert_employee_peers" on public.direct_messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> recipient_id
    and public.has_role(sender_id, 'employee'::app_role)
    and public.has_role(recipient_id, 'employee'::app_role)
  );

create or replace function public.chat_may_start(p_from uuid, p_to uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_from is not null and p_to is not null and p_from <> p_to and (
       (public.has_role(p_from, 'operator'::app_role)
         and (public.has_role(p_to, 'supervisor'::app_role) or public.is_operator_chat_admin(p_to)))
    or public.has_role(p_from, 'supervisor'::app_role)
    or public.is_operator_chat_admin(p_from)
    or ((public.has_role(p_from, 'admin'::app_role) or public.has_role(p_from, 'manager'::app_role)
         or public.has_role(p_from, 'maintenance_manager'::app_role) or public.has_role(p_from, 'warehouse'::app_role))
        and not public.has_role(p_to, 'operator'::app_role))
    or (public.has_role(p_from, 'employee'::app_role) and public.has_role(p_to, 'employee'::app_role))
  );
$$;
revoke all on function public.chat_may_start(uuid, uuid) from public, anon, authenticated;

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
    end if;
  exception when others then
    raise warning 'dm_employee_bell(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.dm_employee_bell() from public, anon, authenticated;

notify pgrst, 'reload schema';
