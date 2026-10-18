-- An ask rings the bell of the people who can take it — written by the database, once.
--
-- WHAT WAS THERE. Publishing an ask called `overtime_push_targets` and then the
-- `send-push` function FROM THE SUPERVISOR'S BROWSER, after the insert. So:
--   * the notification existed only if that tab stayed open and the call succeeded;
--   * a retry wrote a second one (nothing tied a notification to an ask);
--   * the targets were department + crew only — somebody rostered on those very
--     hours, blocked for a no-show, or who had already answered, was told anyway;
--   * an edit that widened the ask told nobody new.
-- And the `notifications` rows were never read: the header bell only kept an
-- in-memory list of live events. Six functions wrote to a table no screen opened.
--
-- WHAT THIS DOES.
--   1. `notifications` learns what a row is about: `kind` and `overtime_request_id`,
--      unique per (person, kind, ask) — a second write for the same event is a no-op.
--   2. `overtime_notify_targets(ask)` — who may take it, by the rules that already
--      decide whether their yes is accepted: open, not started yet (factory clock),
--      active with a login, inside the ask's department and crew (`answer_overtime`
--      refuses anyone else), not blocked (`overtime_block_for`), not already
--      answered, and no clash with their own hours (`overtime_schedule_clash`,
--      BLOCO 95 — the board and the rota, nights across midnight included).
--   3. A trigger on `overtime_requests` writes the bell rows after an ask is created,
--      reopened, or has its date, hours, department or crew changed. Newly eligible
--      people get one; people already told are skipped by the unique key.
--      It cannot fail the ask: any error is a WARNING and the ask stands.
--   4. `overtime_ask_notified(ask)` — for the supervisor: the logins the database
--      actually told, so the confirmation is a count of rows, not a guess.
--   5. An employee may change only `read_at` on their own rows (the policy allowed
--      rewriting the title and body), and the table joins the realtime publication.
--   6. A yes to an ask that has already started is refused (only the screen hid it).
--      Supervisors recording after the fact are not affected.
--
-- DEPENDS ON BLOCO 95 (`overtime_schedule_clash`). Pasted out of order, the trigger
-- warns and writes nothing — the ask is still saved.

-- ── 1. What a notification is about ─────────────────────────────────────────
alter table public.notifications
  add column if not exists kind text,
  add column if not exists overtime_request_id uuid
    references public.overtime_requests(id) on delete cascade;

create unique index if not exists notifications_one_per_event_key
  on public.notifications (user_id, kind, overtime_request_id);
create index if not exists notifications_overtime_request_idx
  on public.notifications (overtime_request_id) where overtime_request_id is not null;
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- ── 2. Who may take it ──────────────────────────────────────────────────────
create or replace function public.overtime_notify_targets(p_request_id uuid)
returns table (employee_id uuid, user_id uuid)
-- plpgsql, not sql: a sql body is checked when it is created, and this one names
-- BLOCO 95's function. Out of order, the paste must not stop here.
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select e.id, e.user_id
    from public.overtime_requests q
    join public.employees e
      on e.active
     and e.user_id is not null
     and (q.department  is null or q.department  is not distinct from e.department)
     and (q.shift_group is null or q.shift_group is not distinct from e.shift_group)
   where q.id = p_request_id
     and q.status = 'open'
     and (q.on_date + q.starts_at) > (now() at time zone 'Europe/London')
     and not exists (select 1 from public.overtime_responses r
                      where r.request_id = q.id and r.employee_id = e.id)
     and not exists (select 1 from public.overtime_block_for(e.id))
     and public.overtime_schedule_clash(e.id, q.id) is null;
end;
$$;

revoke all on function public.overtime_notify_targets(uuid) from public, anon, authenticated;

-- ── 3. The bell rows, written where the ask is written ──────────────────────
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
         || ' · need ' || new.headcount;

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

revoke all on function public.overtime_request_notify() from public, anon, authenticated;

drop trigger if exists overtime_request_notify_t on public.overtime_requests;
create trigger overtime_request_notify_t
  after insert or update of status, on_date, starts_at, ends_at, department, shift_group
  on public.overtime_requests
  for each row execute function public.overtime_request_notify();

-- ── 4. What the supervisor is told ──────────────────────────────────────────
create or replace function public.overtime_ask_notified(p_request_id uuid)
returns setof uuid
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Not allowed to manage overtime' using errcode = '42501';
  end if;
  return query
    select n.user_id from public.notifications n
     where n.overtime_request_id = p_request_id and n.kind = 'overtime_new';
end;
$$;

revoke all on function public.overtime_ask_notified(uuid) from public, anon;
grant execute on function public.overtime_ask_notified(uuid) to authenticated;

-- ── 5. Your own bell: read it, mark it read, nothing else ───────────────────
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ── 6. No yes to an ask that has already started ────────────────────────────
create or replace function public.overtime_response_not_started_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.answer is distinct from 'yes' then return new; end if;
  if tg_op = 'UPDATE' and old.answer is not distinct from new.answer then return new; end if;
  -- A row that already carries a decision is the supervisor's record of what happened
  -- (an employee cannot write one — BLOCO 99), not somebody signing up now.
  if new.decision is not null then return new; end if;
  -- The supervisor writes after the fact (a yes given at the desk, a correction);
  -- the service role has no uid. Only somebody answering for themselves is held.
  if auth.uid() is null or public.can_manage_overtime(auth.uid()) then return new; end if;
  if exists (select 1 from public.overtime_requests q
              where q.id = new.request_id
                and (q.on_date + q.starts_at) <= (now() at time zone 'Europe/London')) then
    raise exception 'This overtime has already started' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_response_not_started_guard() from public, anon, authenticated;

drop trigger if exists overtime_response_not_started_guard_t on public.overtime_responses;
create trigger overtime_response_not_started_guard_t
  before insert or update of answer on public.overtime_responses
  for each row execute function public.overtime_response_not_started_guard();
