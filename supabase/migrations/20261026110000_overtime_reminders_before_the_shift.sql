-- Booked overtime is remembered: a reminder a day before and two hours before.
--
-- WHAT WAS THERE. A booking rang once, when it was made ('overtime_booked'), and again
-- only if the ask was moved or called off (BLOCO 131). Somebody who said yes on Monday
-- to Saturday 06:00 had nothing on the phone between Monday and Saturday morning.
--
-- WHAT THIS DOES.
--   1. `overtime_reminders_due(p_now)` writes 'overtime_reminder_24h' and
--      'overtime_reminder_2h' bell rows. The phone is buzzed by the existing
--      `notification_push` trigger (BLOCO 117), tagged `overtime-notice-<ask>`
--      (BLOCO 132), so a later cancellation replaces the reminder on the lock screen.
--   2. A pg_cron job runs it every five minutes. It needs no secret: it only writes
--      rows, and the trigger already reads CRON_SECRET from the vault to push them.
--   3. `notification_push` sends a `ttl` for reminders: the seconds left until the
--      shift starts (at least 60). A phone that was off does not get "starts in two
--      hours" after the shift has begun. Every other row is unchanged.
--   4. Moving an ask (date or hours) or calling it off deletes its reminders, so the
--      new hours are reminded afresh and no stale reminder stays in the bell. When a
--      person's own booking ends (any outcome recorded), their unread reminders for
--      that ask are deleted.
--
-- WHO IS REMINDED. A valid booking, read the way the board reads it
-- (overtime_board_apply, BLOCO 129): decision = 'accepted' on an ask that is not
-- 'cancelled' ('closed' only stops new answers; the bookings stand), with no outcome
-- recorded for the response, by an employee with a login. Not a reserve, not a 'no',
-- not a declined yes, not a cancelled booking (a cancellation keeps decision =
-- 'accepted' on purpose; the outcome row is what says it ended).
--
-- WHEN. The shift starts at (on_date + starts_at) in Europe/London, the same instant
-- BLOCO 131 uses for "already started". `at time zone` resolves summer time on both
-- clock changes. An overnight shift (ends_at < starts_at) starts on on_date; its end
-- is not used here.
--   24h: from 24 hours before the start until 2 hours before.
--   2h:  from 2 hours before the start until the start.
-- A window is skipped when the booking was decided inside it: the person has just had
-- "You're booked", and a reminder a minute later is noise. A reserve promoted the day
-- before therefore gets the 2-hour reminder only. Nothing is written once the shift
-- has started. If the job is off for a while, a reminder still goes out late inside its
-- own window, never after it.
--
-- ONCE. The unique index of BLOCO 100 (user_id, kind, overtime_request_id) and
-- `on conflict do nothing`: two runs at the same moment, or a run every five minutes
-- for twenty-two hours, write one row per person, kind and ask.
--
-- TEXT. English, like every overtime notice. The body is date, hours and shift
-- ("Sat 31/10 · 06:00–18:00 · Day shift"), plus the production line ("· Capsules
-- Line") only when a supervisor has placed the person on the board for that ask on a
-- 'production' area (those mirror a row in `lines`; 'support' areas are not lines).
-- The department is never shown in its place.
--
-- DEPENDS ON BLOCO 100 (the unique index and overtime_request_id), 117
-- (notification_push), 129 (overtime_board_shift) and 132 (the shared tag; without it
-- the reminders still work, each with its own tag). The `ttl` needs send-push from
-- the BLOCO 132 pull request: until it is deployed, send-push refuses the reminder's
-- push (400, unknown key) and the reminder is in the bell only. Nothing else changes.
-- No table or column is created.

-- ── 1. The reminders ────────────────────────────────────────────────────────
create or replace function public.overtime_reminders_due(p_now timestamptz default now())
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_written integer := 0;
  v_rows    integer;
begin
  with booking as (
    select r.id            as response_id,
           q.id            as request_id,
           e.user_id,
           coalesce(r.decided_at, r.answered_at) as decided_at,
           (q.on_date + q.starts_at) at time zone 'Europe/London' as starts,
           to_char(q.on_date, 'Dy DD/MM') || ' · ' || left(q.starts_at::text, 5)
             || '–' || left(q.ends_at::text, 5)
             || ' · ' || public.overtime_board_shift(q.on_date, q.starts_at) || ' shift'
             || coalesce(' · ' || (select a.name
                                     from public.daily_allocations d
                                     join public.headcount_areas a on a.id = d.area_id
                                    where d.overtime_request_id = q.id
                                      and d.employee_id = r.employee_id
                                      and a.kind = 'production'
                                    order by a.name
                                    limit 1), '') as body
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
      join public.employees e on e.id = r.employee_id
     where r.decision = 'accepted'
       and q.status <> 'cancelled'
       and e.user_id is not null
       -- Only asks that can still be reminded: today, tomorrow, the day after.
       and q.on_date between (p_now at time zone 'Europe/London')::date - 1
                         and (p_now at time zone 'Europe/London')::date + 2
       and not exists (select 1 from public.overtime_outcomes o where o.response_id = r.id)
  ),
  due as (
    select b.*, 'overtime_reminder_24h'::text as kind, 'Overtime reminder'::text as title
      from booking b
     where p_now >= b.starts - interval '24 hours'
       and p_now <  b.starts - interval '2 hours'
       and b.decided_at < b.starts - interval '24 hours'
    union all
    select b.*, 'overtime_reminder_2h', 'Overtime starts soon'
      from booking b
     where p_now >= b.starts - interval '2 hours'
       and p_now <  b.starts
       and b.decided_at < b.starts - interval '2 hours'
  )
  insert into public.notifications (user_id, kind, overtime_request_id, title, body, priority, action_url)
  select d.user_id, d.kind, d.request_id, d.title, d.body, 'high',
         '/dashboard/my-overtime?ask=' || d.request_id
    from due d
  on conflict (user_id, kind, overtime_request_id) do nothing;

  get diagnostics v_rows = row_count;
  v_written := v_written + v_rows;
  return v_written;
end;
$$;
revoke all on function public.overtime_reminders_due(timestamptz) from public, anon, authenticated;

-- ── 2. Moved or called off: the reminders go ────────────────────────────────
create or replace function public.overtime_reminders_forget_ask()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.status = 'cancelled' and old.status is distinct from 'cancelled')
     or (old.on_date, old.starts_at, old.ends_at) is distinct from (new.on_date, new.starts_at, new.ends_at) then
    delete from public.notifications
     where overtime_request_id = new.id
       and kind in ('overtime_reminder_24h', 'overtime_reminder_2h');
  end if;
  return null;
exception when others then
  -- The ask is the record; the bell is a courtesy. Never undo the change for it.
  raise warning 'overtime_reminders_forget_ask(%): %', new.id, sqlerrm;
  return null;
end;
$$;
revoke all on function public.overtime_reminders_forget_ask() from public, anon, authenticated;

drop trigger if exists overtime_reminders_forget_ask_t on public.overtime_requests;
create trigger overtime_reminders_forget_ask_t
  after update of status, on_date, starts_at, ends_at on public.overtime_requests
  for each row execute function public.overtime_reminders_forget_ask();

-- ── 3. A booking that ended: that person's unread reminders go ──────────────
create or replace function public.overtime_reminders_forget_booking()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.notifications n
   using public.overtime_responses r, public.employees e
   where r.id = new.response_id
     and e.id = r.employee_id
     and n.user_id = e.user_id
     and n.overtime_request_id = r.request_id
     and n.kind in ('overtime_reminder_24h', 'overtime_reminder_2h')
     and n.read_at is null;
  return null;
exception when others then
  raise warning 'overtime_reminders_forget_booking(%): %', new.response_id, sqlerrm;
  return null;
end;
$$;
revoke all on function public.overtime_reminders_forget_booking() from public, anon, authenticated;

drop trigger if exists overtime_reminders_forget_booking_t on public.overtime_outcomes;
create trigger overtime_reminders_forget_booking_t
  after insert or update of outcome on public.overtime_outcomes
  for each row execute function public.overtime_reminders_forget_booking();

-- ── 4. The push carries a ttl for reminders ─────────────────────────────────
-- BLOCO 132's body, plus 'ttl' for the two reminder kinds. jsonb_strip_nulls drops it
-- for every other row, so their request to send-push is exactly what it was.
create or replace function public.notification_push()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_secret text;
  v_ttl    integer;
begin
  begin
    if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
      return null;
    end if;

    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1;
    if v_secret is null then
      raise warning 'notification_push(%): CRON_SECRET missing from the vault', new.id;
      return null;
    end if;

    -- BLOCO 133: a reminder is worth nothing once the shift has started.
    if new.kind in ('overtime_reminder_24h', 'overtime_reminder_2h') and new.overtime_request_id is not null then
      select greatest(60, least(86400, floor(extract(epoch from
               ((q.on_date + q.starts_at) at time zone 'Europe/London') - now()))::integer))
        into v_ttl
        from public.overtime_requests q where q.id = new.overtime_request_id;
    end if;

    perform net.http_post(
      url := 'https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_secret
      ),
      body := jsonb_strip_nulls(jsonb_build_object(
        'user_id', new.user_id,
        'title', left(coalesce(nullif(new.title, ''), 'PMSystem'), 200),
        'body', left(new.body, 2000),
        'priority', case when new.priority in ('low', 'medium', 'high', 'critical')
                         then new.priority else 'medium' end,
        -- BLOCO 132: the notices about one ask share one tag, so on the phone each
        -- replaces the last (a cancellation covers the reminder it makes wrong). The page
        -- reads `overtime-notice-<ask>` back in notificationOpen.ts; the kinds must match
        -- OVERTIME_NOTICE_KINDS there. Every other row keeps `<kind>:<id>`.
        'tag', left(case
                      when new.overtime_request_id is not null
                       and new.kind in ('overtime_changed', 'overtime_cancelled',
                                        'overtime_reminder_24h', 'overtime_reminder_2h')
                      then 'overtime-notice-' || new.overtime_request_id
                      else new.kind || ':' || new.id
                    end, 100),
        'ttl', v_ttl,
        'action_url', left(new.action_url, 2048),
        'wo_id', new.wo_id,
        'in_app', false
      )),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'notification_push(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.notification_push() from public, anon, authenticated;

-- ── 5. Every five minutes ───────────────────────────────────────────────────
-- cron.schedule with a name replaces a job of the same name, so a second paste does
-- not add a second job.
select cron.schedule('overtime-reminders', '*/5 * * * *', 'select public.overtime_reminders_due();');

notify pgrst, 'reload schema';
