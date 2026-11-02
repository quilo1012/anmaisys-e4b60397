-- A cancelled booking tells whoever was told it was coming.
--
-- WHAT WAS ASKED. 01/11/2026, the owner, looking at the bell: "Josimar Inocente is coming
-- in" arrives when somebody says yes, but when an employee cancels the overtime from My
-- Overtime, the admin hears nothing. The place is quietly gone from the board and the
-- reserve may have been moved up, and the person who posted the ask finds out at the line.
--
-- WHY. The "is coming in" bell is `overtime_response_booked_notify`, a trigger on
-- `overtime_responses` that fires when a decision is first set. A cancellation does not
-- touch that row: it keeps decision = 'accepted' as the record of what was agreed and
-- writes the cancellation to `overtime_outcomes` (cancel_my_overtime, and the desk's
-- record_overtime_outcome). Nothing on `overtime_outcomes` writes a bell — the only
-- trigger there (BLOCO 133) deletes the person's own reminders.
--
-- THE RULE. The people told "X is coming in" are told "X cancelled": the supervisors on
-- file (supervisor_logins_of) and whoever posted the ask, once each, never the one who
-- did the cancelling, never the employee themself. Only when the outcome first becomes a
-- cancellation, on a booking (decision = 'accepted'), and only when somebody is signed in
-- — as the yes bell, so a repair from the SQL editor does not ring anybody. A late
-- cancellation says so, since that is the one the late-cancel block counts.
--
-- WHAT IT WRITES. One `notifications` row per person, kind 'overtime_booking_cancelled',
-- to /dashboard/overtime. The phone push follows from BLOCO 117's trigger on
-- notifications, as for every bell with a kind. `overtime_request_id` is left empty,
-- like the yes bell: BLOCO 100's unique key allows one row per person, kind and ask, and
-- a booking cancelled, taken back and cancelled again would collide on it.
--
-- NOT CHANGED: cancel_my_overtime, record_overtime_outcome, rebook_my_overtime, the board,
-- the reminders, the yes bell. Taking a cancellation back deletes the outcome row, which
-- this trigger does not watch; the yes that follows rings "is coming in" as always.
--
-- Idempotent: create or replace, drop trigger if exists.

create or replace function public.overtime_outcome_cancelled_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_resp public.overtime_responses;
  v_req  public.overtime_requests;
  v_user uuid;
  v_name text;
  v_when text;
  v_to   uuid;
begin
  if new.outcome not in ('cancelled_in_time', 'cancelled_late') then return null; end if;
  if tg_op = 'UPDATE' and old.outcome in ('cancelled_in_time', 'cancelled_late') then return null; end if;
  if auth.uid() is null then return null; end if;

  begin
    select * into v_resp from public.overtime_responses where id = new.response_id;
    if v_resp.decision is distinct from 'accepted' then return null; end if;
    select * into v_req from public.overtime_requests where id = v_resp.request_id;
    select user_id, full_name into v_user, v_name from public.employees where id = v_resp.employee_id;
    v_when := to_char(v_req.on_date, 'Dy DD/MM') || ' · ' || left(v_req.starts_at::text, 5)
              || '–' || left(v_req.ends_at::text, 5) || coalesce(' · ' || v_req.department, '')
              || case when new.outcome = 'cancelled_late' then ' · cancelled late' else '' end;

    for v_to in
      select distinct t from unnest(array_append(array(select l.login from public.supervisor_logins_of(v_resp.employee_id) l), v_req.created_by)) t
       where t is not null and t <> auth.uid() and t is distinct from v_user
    loop
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_to, 'overtime_booking_cancelled',
              coalesce(v_name, 'Somebody') ||
                case when auth.uid() = v_user then ' cancelled their overtime'
                     else '''s overtime was cancelled' end,
              v_when, 'medium', '/dashboard/overtime');
    end loop;
  exception when others then
    -- The cancellation is the record; the bell is a courtesy. Never undo it for the bell.
    raise warning 'overtime_outcome_cancelled_notify(%): %', new.response_id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.overtime_outcome_cancelled_notify() from public, anon, authenticated;

drop trigger if exists overtime_outcome_cancelled_notify_t on public.overtime_outcomes;
create trigger overtime_outcome_cancelled_notify_t
  after insert or update of outcome on public.overtime_outcomes
  for each row execute function public.overtime_outcome_cancelled_notify();
