-- APLICAR 153 — My Attendance lê as horas do Headcount Board.
--
-- PT: Colar no SQL Editor do AN Maintenance (Supabase), o ficheiro inteiro. É o BLOCO 153 do
-- APPLY-ALL-IN-ORDER.sql, byte a byte. Só cria a função my_board_marks (só leitura, cada
-- pessoa vê só as suas linhas); não muda tabelas nem o my_attendance. Pode colar-se duas
-- vezes. Depois correr VERIFY-153-horas-do-board.sql (só lê).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 153. It only
-- creates my_board_marks (read-only, own rows). Then run VERIFY-153.

-- ================================================================
-- BLOCO 153
-- 20261107100000_my_attendance_reads_the_boards_hours.sql
-- ================================================================
-- My Attendance reads the hours the Headcount Board reads.
--
-- WHAT HAPPENED. On 07/11 an employee's My Attendance listed Tue 20/10 and Wed 21/10 as
-- overtime 06:00–14:00 (8 h each), while the Headcount Board had them on overtime for
-- 12 hours. The two screens read different things: the board lays the confirmed ask over
-- the person's row (`placementHours` in src/lib/boardOvertime.ts) — a row the office put
-- there by hand is the whole 12-hour shift, and "went home at" / "came in at" move its
-- ends — while My Attendance read the ask's own window and nothing else.
--
-- WHY A FUNCTION. The three fields that decide the board's hours are not in
-- `my_attendance`, and an employee cannot read `daily_allocations`:
--   left_early_at, arrived_late_at   the office's "went home at" / "came in at"
--   overtime_request_id              set on the row the overtime bridge made for an ask,
--                                    null on a row the office placed
-- This returns them for the signed-in person's own rows only, under the same gate as
-- `my_attendance`. `my_attendance` itself is not touched: its body in production is
-- not provably the repo's, so it is not re-created here (decided 07/11).
--
-- Until this is pasted the screen keeps the ask's hours (pendingRpcs.ts names that).

create or replace function public.my_board_marks(p_from date, p_to date)
returns table (
  on_date date,
  shift text,
  left_early_at time,
  arrived_late_at time,
  overtime_request_id uuid
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_emp uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to see your attendance' using errcode = '42501';
  end if;
  -- The same gate as my_attendance: `attendance.view_own` in src/lib/permissions.ts.
  if not public.has_action(auth.uid(), 'attendance.view_own',
           array['admin','manager','production_office_admin','engineer',
                 'maintenance_manager','warehouse','quality_supervisor','employee']::app_role[]) then
    raise exception 'Not allowed to see attendance' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'The range must start on or before the day it ends' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Pick a range of at most 400 days' using errcode = '22023';
  end if;

  v_emp := public.my_employee_id();
  if v_emp is null then
    return;
  end if;

  return query
    select b.on_date, b.shift::text, b.left_early_at, b.arrived_late_at, b.overtime_request_id
      from public.daily_allocations b
     where b.employee_id = v_emp
       and b.on_date between p_from and p_to
     order by b.on_date, b.shift;
end;
$$;

revoke all on function public.my_board_marks(date, date) from public, anon;
grant execute on function public.my_board_marks(date, date) to authenticated;
