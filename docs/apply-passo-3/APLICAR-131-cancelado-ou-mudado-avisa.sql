-- APLICAR 131 — um pedido de overtime cancelado ou mudado avisa quem foi avisado.
--
-- PT: Colar no SQL editor do PMSYSTEM (More → Cloud → SQL editor), o ficheiro inteiro.
-- É o BLOCO 131 do APPLY-ALL-IN-ORDER.sql. Acrescenta uma função e um trigger em
-- overtime_requests; não cria tabelas nem colunas e não mexe em dados. O push para o
-- telemóvel é o trigger notification_push que já existe (BLOCO 117).
--
-- A cancelled or moved overtime ask tells the people it was offered to.
--
-- The bell (and, through BLOCO 117, the phone) rang when an ask was posted
-- ('overtime_new') and when a yes became a booking ('overtime_booked'). Nothing rang
-- when the ask was called off or moved to other hours: somebody who said yes to
-- Saturday 06:00 found out it was cancelled by turning up, and somebody told about a
-- Night that moved to 20:00 still had the old hours on the lock screen.
--
-- WHO: the people already told about the ask (an 'overtime_new' row) and the people
-- who said yes to it (booked or reserve). Not told again: who said no, whose yes the
-- supervisor declined, and who had already cancelled their booking.
-- WHAT: 'overtime_cancelled' when status becomes 'cancelled'; 'overtime_changed' when
-- the date or the hours move on an ask that is still open. Each change replaces the
-- previous change notice for that person and ask (a cancellation removes it too), so a new row is inserted and the
-- phone buzzes once per change, and the bell never holds two versions of the hours.
-- The cancellation is one per person and ask (the unique index from BLOCO 100).
-- The notice links to My Overtime, which reads the ask afresh: the text is a pointer,
-- never the record, and opening it never answers anything.
--
-- The ask is the record; the bell is a courtesy, so a failure here is a warning and
-- never rolls the ask back. No data is changed by this file; no table, column or
-- policy is added. The phone push is the existing `notification_push` trigger.
--
-- Not applied by this file: paste it in the Lovable SQL editor.

-- Tudo ou nada: se alguma linha falhar, nada fica aplicado e pode colar-se outra vez.
-- Pode colar-se mais de uma vez: só substitui a função (e o trigger, no 131).
begin;

create or replace function public.overtime_request_change_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_kind  text;
  v_title text;
  v_when  text;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_kind  := 'overtime_cancelled';
    v_title := 'Overtime cancelled';
  elsif new.status = 'open' and old.status = 'open'
        and (old.on_date, old.starts_at, old.ends_at) is distinct from (new.on_date, new.starts_at, new.ends_at) then
    v_kind  := 'overtime_changed';
    v_title := 'Overtime changed';
  else
    return null;
  end if;

  -- Nothing to tell about a shift that has already started: the board and the
  -- attendance marks are where that is settled.
  if (new.on_date + new.starts_at) <= (now() at time zone 'Europe/London') then
    return null;
  end if;

  v_when := to_char(new.on_date, 'Dy DD/MM') || ' · '
         || left(new.starts_at::text, 5) || '–' || left(new.ends_at::text, 5)
         || coalesce(' · ' || new.department, '');

  begin
    -- An earlier "changed" notice is out of date either way: replaced by the new
    -- hours, or by the cancellation.
    delete from public.notifications
     where kind = 'overtime_changed' and overtime_request_id = new.id;

    insert into public.notifications
      (user_id, kind, overtime_request_id, title, body, priority, action_url)
    select distinct w.user_id, v_kind, new.id, v_title,
           case when v_kind = 'overtime_cancelled'
                then v_when || ' has been called off. Open to see your overtime.'
                else 'Now ' || v_when || '. Open to check it still works for you.' end,
           'high',
           '/dashboard/my-overtime?ask=' || new.id
      from (
        select n.user_id
          from public.notifications n
         where n.overtime_request_id = new.id and n.kind = 'overtime_new'
        union
        select e.user_id
          from public.overtime_responses r
          join public.employees e on e.id = r.employee_id
         where r.request_id = new.id and r.answer = 'yes' and e.user_id is not null
      ) w
     -- Not those it is no longer about: who said no, whose yes the supervisor declined,
     -- and who already cancelled their own booking.
     where not exists (
       select 1
         from public.overtime_responses r
         join public.employees e on e.id = r.employee_id
        where r.request_id = new.id and e.user_id = w.user_id
          and (r.answer = 'no' or r.decision = 'declined'
               or exists (select 1 from public.overtime_outcomes o
                           where o.response_id = r.id
                             and o.outcome in ('cancelled_in_time', 'cancelled_late'))))
    on conflict (user_id, kind, overtime_request_id) do nothing;
  exception when others then
    raise warning 'overtime_request_change_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.overtime_request_change_notify() from public, anon, authenticated;

drop trigger if exists overtime_request_change_notify_t on public.overtime_requests;
create trigger overtime_request_change_notify_t
  after update of status, on_date, starts_at, ends_at
  on public.overtime_requests
  for each row execute function public.overtime_request_change_notify();

commit;

notify pgrst, 'reload schema';
