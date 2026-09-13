-- Training on the production board.
--
-- `employee_attendance` has accepted `training` since the workforce board was written
-- — it is one of six values its check constraint allows. `daily_allocations` never
-- did, so the board a supervisor actually plans the day on had five statuses and no
-- word for the one thing that is neither a line nor an absence: somebody who came in,
-- is paid, and spent the shift in a classroom.
--
-- With nowhere to put them they were marked as holiday, or left off the board and
-- counted as unallocated. Both are wrong in the same direction: the first spends a day
-- of their annual leave, the second makes the shift look short-staffed at a glance.
--
-- Nothing else about the row changes. The two partial constraints already on the table
-- refuse a late arrival or an early finish on any status but `assigned` and `overtime`,
-- and a training row is written with `area_id` null, exactly as sickness and holiday
-- are — they are not at a place that day.
ALTER TABLE public.daily_allocations DROP CONSTRAINT IF EXISTS daily_allocations_status_check;
ALTER TABLE public.daily_allocations ADD CONSTRAINT daily_allocations_status_check
  CHECK (status = ANY (ARRAY['assigned','overtime','sick','unpaid','holiday','training']));
