-- Workforce phase 2: the headcount board.
--
-- Where a person is working, and whether they turned up.
--
-- current_line_id is the CURRENT state, not a history: the board answers "who is on
-- Line 3 right now". Every change to it writes a row in employee_movements, which is
-- the history — because "who was on Line 3 the night of that complaint" is a question
-- an audit asks months later, and a column that only holds the present cannot answer
-- it.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS current_line_id uuid REFERENCES public.lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employees_current_line_idx ON public.employees (current_line_id);

-- Attendance is per person per day, not a flag on the employee. A flag would say
-- "absent" forever after one bad Tuesday.
CREATE TABLE IF NOT EXISTS public.employee_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  on_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'sick', 'holiday', 'training')),
  note text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, on_date)
);

CREATE INDEX IF NOT EXISTS employee_attendance_date_idx ON public.employee_attendance (on_date);

ALTER TABLE public.employee_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_attendance admin" ON public.employee_attendance;
CREATE POLICY "employee_attendance admin" ON public.employee_attendance
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_attendance_touch ON public.employee_attendance;
CREATE TRIGGER trg_attendance_touch BEFORE UPDATE ON public.employee_attendance
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
