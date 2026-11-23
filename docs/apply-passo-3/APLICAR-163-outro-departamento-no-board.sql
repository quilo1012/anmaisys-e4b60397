-- APLICAR 163 — coluna "Other department" no Board.
--
-- PT: Colar no SQL Editor do AN Maintenance (Supabase), o ficheiro inteiro. É o BLOCO 163 do
-- APPLY-ALL-IN-ORDER.sql, byte a byte. Acrescenta 'other_department' aos estados que
-- daily_allocations aceita. Não muda dados existentes. Pode colar-se duas vezes. Depois
-- correr VERIFY-163 (só lê).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 163. Lets
-- daily_allocations.status hold 'other_department'. No existing data changes. Then run VERIFY-163.


-- ================================================================
-- BLOCO 163
-- 20261123210000_board_other_department.sql
-- ================================================================
-- "Other department" on the production board.
--
-- Somebody from this board who comes in and spends the shift working for another
-- department of the company — lent to the warehouse for the day, say — had no word on
-- the board. Left off it, they sat in "Not placed yet" and the shift looked short;
-- put on a line, they were counted in "Total staff in Production" for a line they
-- never stood on.
--
-- `other_department` is that word. Like `training`, the row is written with `area_id`
-- null: the two partial constraints already on the table refuse a late arrival or an
-- early finish on any status but `assigned` and `overtime`, and that stands. Payroll
-- reads it as `present` (`attendanceForStatus`), so `employee_attendance` needs no new
-- value.
ALTER TABLE public.daily_allocations DROP CONSTRAINT IF EXISTS daily_allocations_status_check;
ALTER TABLE public.daily_allocations ADD CONSTRAINT daily_allocations_status_check
  CHECK (status = ANY (ARRAY['assigned','overtime','sick','unpaid','holiday','training','other_department']));
