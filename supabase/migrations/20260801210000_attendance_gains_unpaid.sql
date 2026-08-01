-- Unpaid leave was a status on the floor before it was one here.
--
-- The headcount spreadsheet the board replaces marks people Present, Holiday, Unpaid,
-- Sick, Absence or Overtime. Five of those already map: Absence is absent, and
-- Overtime is not an attendance status at all — it is a balance imported from payroll
-- over a period, which is why it lives on its own tab and cannot be typed here.
--
-- Unpaid was the one with nowhere to go. Recording it as absent loses the distinction
-- payroll cares about: an unpaid day is agreed and unpaid, an absence is neither.
ALTER TABLE public.employee_attendance
  DROP CONSTRAINT IF EXISTS employee_attendance_status_check;

ALTER TABLE public.employee_attendance
  ADD CONSTRAINT employee_attendance_status_check
  CHECK (status IN ('present', 'absent', 'sick', 'holiday', 'training', 'unpaid'));
