-- The board never heard that anybody had been accepted.
--
-- Overtime was offered, answered, decided and marked up, and `daily_allocations` —
-- the thing the factory actually reads at six in the morning — knew none of it. Zero
-- references to the board in the four October migrations, in useOvertimeRequests, in
-- overtimeRequests.ts and in the panel. It was never a stale cache; the wire was not
-- there.
--
-- WHAT GOES ON THE BOARD, AND WHEN. An employee answering yes says only that they are
-- available: `overtime_responses.answer`. A supervisor accepting says they are
-- working: `overtime_responses.decision = 'accepted'`. The board is the second one.
-- It has to be, or it stops being the list of who is in and becomes a list of who
-- offered — and the person reading it at handover cannot tell the difference.
--
-- WHY THIS IS A TRIGGER AND NOT CLIENT CODE. `record_overtime_outcome` promotes the
-- longest-waiting reserve inside the database when an accepted person drops out. A
-- bridge living in the React client would never see that write, so the promoted
-- person would be accepted and invisible — the exact failure this migration exists to
-- end, reintroduced by the fix for it. One rule, one place, and the place is here.
--
-- WHICH BOARD. From the ask's own hours, not from the person's crew: overtime is by
-- definition worked outside the pattern their crew keeps, so their crew cannot say
-- which board the hours belong to. `factory_shift_of` already draws that line at
-- 06:00 and 18:00 Europe/London and is used for quality actions; this reuses it
-- rather than writing the same two numbers down a second place to drift from.
--
-- WHAT IT WILL NEVER TOUCH. A row without this ask's id on it. A planner placing
-- somebody by hand, the sheet import, a day copied from last Tuesday — those are
-- somebody's work, and an ask being cancelled is not a reason to delete it. The
-- insert is `on conflict do nothing`, so when a row is already there the board simply
-- keeps the one it has, unstamped, and the delete below cannot see it. That is the
-- whole protection and it is structural rather than careful.

-- ── 1. The key the board rows carry home ───────────────────────────────────
alter table public.daily_allocations
  add column if not exists overtime_request_id uuid null
    references public.overtime_requests(id) on delete set null;

-- `set null` rather than cascade: a day somebody worked is history, and deleting the
-- ask it came from must not take the record of the shift with it.
create index if not exists daily_allocations_overtime_request_id_idx
  on public.daily_allocations (overtime_request_id)
  where overtime_request_id is not null;

comment on column public.daily_allocations.overtime_request_id is
  'The overtime ask that put this row here, or null for every ordinary allocation. '
  'Only a row carrying an id may be removed by the overtime flow.';

-- ── 2. Which board an ask''s hours belong to ────────────────────────────────
create or replace function public.overtime_board_shift(p_on_date date, p_starts_at time)
returns text
language sql immutable set search_path = public
as $$
  -- initcap because daily_allocations.shift is 'Day'/'Night' and factory_shift_of
  -- answers 'DAY'/'NIGHT'. The rule is the same rule; only the spelling differs.
  select initcap(public.factory_shift_of((p_on_date + p_starts_at) at time zone 'Europe/London'));
$$;

-- ── 3. The one place that writes the board on behalf of an ask ─────────────
create or replace function public.overtime_board_apply(
  p_request_id  uuid,
  p_employee_id uuid,
  p_accepted    boolean
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_shift text;
begin
  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then return; end if;

  if not p_accepted then
    -- Only ours. A row the planner made for the same person on the same day has no
    -- id on it and is invisible to this.
    delete from public.daily_allocations
     where overtime_request_id = p_request_id
       and employee_id = p_employee_id;
    return;
  end if;

  -- A cancelled ask accepts nobody onto the board, whatever its responses say.
  if v_req.status = 'cancelled' then return; end if;

  v_shift := public.overtime_board_shift(v_req.on_date, v_req.starts_at);

  insert into public.daily_allocations
    (on_date, shift, employee_id, status, area_id, is_leader, overtime_request_id)
  values
    (v_req.on_date, v_shift, p_employee_id, 'overtime', null, false, p_request_id)
  on conflict (on_date, shift, employee_id) do nothing;

  -- The payroll side of the same fact. The board and employee_attendance disagreeing
  -- is how thirteen days marked on the board reached no payroll record at all; eight
  -- of them were never counted. `do nothing` because an existing row is somebody
  -- else's statement about the day — a booked holiday is not this trigger's to
  -- overwrite, and a person who is both booked off and accepted for overtime is a
  -- question for a human.
  insert into public.employee_attendance (employee_id, on_date, status)
  values (p_employee_id, v_req.on_date, 'present')
  on conflict (employee_id, on_date) do nothing;
end;
$$;

-- ── 4. The decision ────────────────────────────────────────────────────────
create or replace function public.overtime_response_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- `coalesce(..., false)` and not the bare comparison. `decision` is null for every
  -- answer nobody has decided on yet, and `null = 'accepted'` is null, not false — so
  -- `if not p_accepted` inside `overtime_board_apply` was neither true nor false, the
  -- guard was skipped, and execution fell through to the insert. Every employee who
  -- said yes would have landed on the board untouched by a supervisor, and undoing a
  -- decision would have created the allocation instead of removing it.
  perform public.overtime_board_apply(
    new.request_id, new.employee_id, coalesce(new.decision = 'accepted', false));
  return new;
end;
$$;

drop trigger if exists overtime_response_to_board_t on public.overtime_responses;
create trigger overtime_response_to_board_t
  after insert or update of decision on public.overtime_responses
  for each row execute function public.overtime_response_to_board();

-- ── 5. The cancellation ────────────────────────────────────────────────────
create or replace function public.overtime_request_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Cancelled only. A closed ask has run its course and the people who were accepted
  -- worked it; taking them off the board afterwards would erase the shift.
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    delete from public.daily_allocations where overtime_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_request_to_board_t on public.overtime_requests;
create trigger overtime_request_to_board_t
  after update of status on public.overtime_requests
  for each row execute function public.overtime_request_to_board();
