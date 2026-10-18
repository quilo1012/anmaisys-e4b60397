-- An overtime ask that is edited takes its board rows with it.
--
-- The bridge (20261012190000, BLOCO 93) puts an accepted answer on the board as a row
-- carrying the ask's id, and takes it off when the answer or the ask is withdrawn. It
-- listens to `overtime_responses.decision` and to `overtime_requests.status` — and to
-- nothing else. The ask's date and start time can be edited after people have said
-- yes (`editRequest`, useOvertimeRequests.ts), and when they were, the board kept the
-- rows on the OLD day, or on the old board when 06:00 became 18:00. The people who
-- accepted were drawn on a day nobody asked them for and missing from the one they
-- were.
--
-- The board is the record of the plan, and the ask is where the plan comes from, so
-- the fix is to redraw from the ask: remove only this ask's own rows, then put every
-- accepted answer back through `overtime_board_apply`, the one function that writes
-- the board on an ask's behalf. Rows a planner made by hand carry no ask id and are
-- not touched, exactly as before.
--
-- Needs BLOCO 93 (`overtime_board_apply`). Idempotent.

create or replace function public.overtime_request_moved_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r record;
begin
  if new.status = 'cancelled' then return new; end if;
  delete from public.daily_allocations where overtime_request_id = new.id;
  for r in
    select employee_id from public.overtime_responses
     where request_id = new.id and decision = 'accepted'
  loop
    perform public.overtime_board_apply(new.id, r.employee_id, true);
  end loop;
  return new;
end;
$$;

revoke all on function public.overtime_request_moved_to_board() from public, anon, authenticated;

drop trigger if exists overtime_request_moved_to_board_t on public.overtime_requests;
create trigger overtime_request_moved_to_board_t
  after update of on_date, starts_at on public.overtime_requests
  for each row
  when (old.on_date is distinct from new.on_date or old.starts_at is distinct from new.starts_at)
  execute function public.overtime_request_moved_to_board();
