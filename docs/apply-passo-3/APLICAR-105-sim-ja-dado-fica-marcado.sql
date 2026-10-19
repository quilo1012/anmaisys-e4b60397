-- ================================================================
-- BLOCO 105
-- 20261019110000_a_yes_already_given_is_booked_too.sql
-- ================================================================
--
-- O SIM JA DADO TAMBEM FICA MARCADO: os SIM que estavam a espera do supervisor antes
-- do BLOCO 102 ficam marcados (os primeiros N num pedido com numero; o resto em
-- reserva), e um SIM escrito pelo supervisor tambem marca. Quem tem choque de horario
-- ou bloqueio fica para o supervisor decidir. Um "nao" mudado para "sim" passa a
-- chegar ao board, e o sino toca uma vez por marcacao. Precisa dos BLOCOS 95, 101, 102.
-- No fim aparece: BLOCO 105: N booked, N on reserve, N left for the supervisor.
--
-- A yes already given is booked too, and so is a yes the supervisor types in.
--
-- WHAT WAS THERE. BLOCO 102 books a person's own yes as it is written — and rewrote
-- no row. Every yes given before it was pasted still sat at "Awaiting decision" on the
-- supervisor's card, waiting for an Accept the floor no longer expects to need. And a
-- yes the supervisor typed in at the desk (somebody who said yes on the phone, or who
-- has no login) stayed undecided by design, so the card asked the same person who had
-- just recorded the yes to accept it as a second step.
--
-- And 102 wrote its bell rows from the BEFORE trigger. The desk writes with an upsert
-- (INSERT … ON CONFLICT DO UPDATE): the BEFORE INSERT trigger runs on the proposed row
-- even when the conflict turns it into an update, so a yes over an earlier answer rang
-- the bell twice, and a yes over a yes rang it for nothing.
--
-- The rule the user gave on 19/10: when an employee says yes, it is confirmed. The
-- supervisor is told, not asked.
--
-- WHAT THIS DOES.
--   1. `overtime_response_book_on_yes` (BEFORE) only decides. It books a desk yes as
--      well: when somebody who runs overtime (`can_manage_overtime`) writes a yes for a
--      person. Not past what the ask can hold, and NOT when the person is blocked or
--      their own hours clash: the phone refuses those (BLOCO 95 guard), the desk does
--      not, so the yes stays undecided with the clash on the card for the supervisor.
--   2. `overtime_response_booked_notify` (AFTER, only on a real change of decision to
--      accepted or reserve): the person is told ("You're booked" / reserve), and whoever
--      posted the ask is told ("Ana is coming in") unless they are the one who did it.
--      One row per change, whichever way it was made — own yes, desk yes, Accept.
--      The board bridge (BLOCO 93) is widened the same way: a "no" later changed to a
--      "yes" was booked by 102 but never drawn on the board.
--   3. Once, now: every undecided yes on an ask that is open and has not started is
--      booked by the same rule — oldest answer first, one ask at a time, `reserve` once
--      a numbered ask is full (the BLOCO 101 capacity guard would refuse an `accepted`),
--      skipped when blocked or clashing. Each person is told by (2); the poster is not
--      flooded with the backlog. The board bridge (BLOCO 93) draws each booking.
--      Asks already started, closed or cancelled are left exactly as they are.
--
-- No policy is created or changed. Depends on BLOCOS 95 (overtime_schedule_clash),
-- 101 (overtime_places_taken) and 102. Idempotent: a second paste books nobody.

-- ── 1. Deciding: an own yes, or a desk yes ──────────────────────────────────
create or replace function public.overtime_response_book_on_yes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_user  uuid;
  v_taken integer := 0;
  v_desk  boolean;
begin
  if new.answer is distinct from 'yes' or new.decision is not null then return new; end if;
  if tg_op = 'UPDATE' and old.answer = 'yes' then return new; end if;
  if auth.uid() is null then return new; end if;

  select user_id into v_user from public.employees where id = new.employee_id;
  -- The person's own yes, or a supervisor writing it for them. Nobody else.
  v_desk := v_user is distinct from auth.uid();
  if v_desk and not public.can_manage_overtime(auth.uid()) then return new; end if;

  -- The phone's yes already passed the block and clash guards. The desk's did not:
  -- left undecided, the card shows the clash and the supervisor decides.
  if v_desk and (exists (select 1 from public.overtime_block_for(new.employee_id))
                 or public.overtime_schedule_clash(new.employee_id, new.request_id) is not null) then
    return new;
  end if;

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
  return new;
end;
$$;

revoke all on function public.overtime_response_book_on_yes() from public, anon, authenticated;

-- ── 2. Telling: after the row really changed ────────────────────────────────
create or replace function public.overtime_response_booked_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req  public.overtime_requests;
  v_user uuid;
  v_name text;
  v_when text;
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
    -- The poster, unless they did it themselves, or nobody did (the one-off backlog).
    if auth.uid() is not null and v_req.created_by is not null
       and v_req.created_by <> auth.uid() and v_req.created_by is distinct from v_user then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_req.created_by, 'overtime_yes',
              coalesce(v_name, 'Somebody') ||
                case when new.decision = 'accepted' then ' is coming in' else ' said yes (on reserve)' end,
              v_when, 'medium', '/dashboard/overtime');
    end if;
  exception when others then
    -- The booking is the record; the bell is a courtesy. Never undo it for the bell.
    raise warning 'overtime_response_booked_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.overtime_response_booked_notify() from public, anon, authenticated;

drop trigger if exists overtime_response_booked_notify_t on public.overtime_responses;
-- `update of decision, answer`, not `of decision`: an UPDATE OF trigger fires on the
-- columns the statement SETS, and the yes that books arrives as `set answer = 'yes'`
-- (the upsert of answer_overtime and of the desk) — the decision is changed by the
-- BEFORE trigger, which an `of decision` trigger never sees.
create trigger overtime_response_booked_notify_t
  after insert or update of decision, answer on public.overtime_responses
  for each row execute function public.overtime_response_booked_notify();

-- The board bridge (BLOCO 93) had the same blind spot: a "no" changed to "yes" was
-- booked by 102 and never reached the board. Same function, wider trigger. It is
-- idempotent (overtime_board_apply draws or clears to match the row).
drop trigger if exists overtime_response_to_board_t on public.overtime_responses;
create trigger overtime_response_to_board_t
  after insert or update of decision, answer on public.overtime_responses
  for each row execute function public.overtime_response_to_board();

-- ── 3. The yeses already waiting, booked once ───────────────────────────────
-- A function, so the SQL test can run exactly what the paste ran. Nobody may call it
-- but the owner: it is run once, below.
create or replace function public.overtime_book_waiting_yeses(
  out booked integer, out reserved integer, out left_for_supervisor integer)
language plpgsql security definer set search_path = public
as $$
declare
  q       record;
  r       record;
  v_taken integer;
  v_dec   text;
begin
  booked := 0; reserved := 0; left_for_supervisor := 0;
  for q in
    select * from public.overtime_requests
     where status = 'open'
       and (on_date + starts_at) > (now() at time zone 'Europe/London')
     order by on_date, starts_at, created_at
     for update
  loop
    v_taken := public.overtime_places_taken(q.id);

    for r in
      select rs.id, rs.employee_id, e.user_id
        from public.overtime_responses rs
        join public.employees e on e.id = rs.employee_id
       where rs.request_id = q.id and rs.answer = 'yes' and rs.decision is null
       order by rs.answered_at, rs.id
    loop
      if exists (select 1 from public.overtime_block_for(r.employee_id))
         or public.overtime_schedule_clash(r.employee_id, q.id) is not null then
        left_for_supervisor := left_for_supervisor + 1;
        continue;
      end if;

      v_dec := case when q.headcount is not null and v_taken >= q.headcount
                    then 'reserve' else 'accepted' end;
      update public.overtime_responses
         set decision = v_dec, decided_at = now(), decided_by = r.user_id
       where id = r.id and decision is null;
      if v_dec = 'accepted' then v_taken := v_taken + 1; booked := booked + 1;
      else reserved := reserved + 1; end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.overtime_book_waiting_yeses() from public, anon, authenticated;

do $$
declare v record;
begin
  select * into v from public.overtime_book_waiting_yeses();
  raise notice 'BLOCO 105: % booked, % on reserve, % left for the supervisor (blocked or clashing)',
    v.booked, v.reserved, v.left_for_supervisor;
end $$;
