-- Leave asked for, and leave granted.
--
-- Until now a holiday appeared on the board because somebody typed it there, and
-- appeared in the finance close because somebody typed it again somewhere else. There
-- was no record of the asking, no record of who said yes, and no way to tell a day
-- that was approved from a day that was simply marked.
--
-- One row per request. Approval is what writes the days out to the two places that
-- have to agree — `employee_attendance`, which the close counts, and
-- `daily_allocations`, which the board draws — and that write happens in the app,
-- visibly and reversibly, rather than in a trigger nobody can see running.
--
-- `working_days` is stored rather than derived on read, because it is a fact about
-- the rota the person was on when the leave was granted. Most of this crew is
-- Mon–Thu: a week off is four days, not seven, and if their pattern changes later
-- the leave they already took does not retrospectively change length.

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'holiday',
  start_date date NOT NULL,
  end_date date NOT NULL,
  -- Counted against the person's shift pattern at the time of asking. Null means
  -- no pattern was on file, which is a question for a human and not a zero.
  working_days integer,
  note text,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_kind_check CHECK (kind IN ('holiday', 'unpaid', 'sick')),
  CONSTRAINT leave_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT leave_requests_dates_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS leave_requests_pending_idx
  ON public.leave_requests (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS leave_requests_employee_idx
  ON public.leave_requests (employee_id, start_date);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- Written out rather than left as USING (true). This table names a person and says
-- they were off sick; the shared tablet logins have no business reading it.
DROP POLICY IF EXISTS leave_requests_read ON public.leave_requests;
CREATE POLICY leave_requests_read ON public.leave_requests
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'planner'::app_role)
    OR has_role(auth.uid(), 'production_office_admin'::app_role)
  );

DROP POLICY IF EXISTS leave_requests_write ON public.leave_requests;
CREATE POLICY leave_requests_write ON public.leave_requests
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'planner'::app_role)
    OR has_role(auth.uid(), 'production_office_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'planner'::app_role)
    OR has_role(auth.uid(), 'production_office_admin'::app_role)
  );
