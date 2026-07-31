-- Workforce: who works here, on which days, and the overtime they carry.
--
-- Phase 1. The board that moves people between lines comes later; this is the part
-- with real data behind it today.
--
-- What the source files actually hold, measured rather than assumed:
--   · 36 people across 4 departments, with names and emails. No employee number.
--   · 33 overtime balances for ONE period, 08/06–12/07, totalling 604.05h.
--   · Five of those balances are NEGATIVE — sickness written off against banked
--     hours (Talita −68.5 after 9 days, Juan −55.5, Elias −21.45, Karina −11,
--     Jacken −7). So this is a balance, not hours worked, and the column is signed.

-- ── Shift patterns ──────────────────────────────────────────────────────────
--
-- A shift is not a label, it is a set of days: Monday–Thursday, Tuesday–Friday,
-- Friday–Monday. Storing "Weekend" as a string loses the only part the rota needs —
-- whether this person is expected in today.
--
-- Days are ISO numbers (1 = Monday … 7 = Sunday) in an array rather than seven
-- boolean columns, so a pattern that wraps the weekend (Fri, Sat, Sun, Mon) is one
-- row and not a special case. Patterns are DATA: a new one is a row, not a deploy.
CREATE TABLE IF NOT EXISTS public.shift_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  /* ISO weekday numbers the pattern covers. */
  days smallint[] NOT NULL CHECK (
    array_length(days, 1) BETWEEN 1 AND 7
    AND days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
  ),
  /* Local start/end, for a rota that shows times. Nullable: a pattern can be
     defined by its days alone until someone fills these in. */
  starts_at time,
  ends_at time,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.shift_patterns.days IS 'ISO weekdays: 1=Mon … 7=Sun. Fri–Mon is {5,6,7,1}.';

INSERT INTO public.shift_patterns (name, days) VALUES
  ('Mon–Thu',  ARRAY[1,2,3,4]::smallint[]),
  ('Tue–Fri',  ARRAY[2,3,4,5]::smallint[]),
  ('Fri–Mon',  ARRAY[5,6,7,1]::smallint[])
ON CONFLICT (name) DO NOTHING;

-- ── Employees ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text,
  department text,
  shift_pattern_id uuid REFERENCES public.shift_patterns(id) ON DELETE SET NULL,
  /* The payroll number, when HR fills it in. Deliberately NOT invented at import:
     a made-up key that does not match the payroll system is worse than no key. */
  employee_ref text UNIQUE,
  /* Optional link to an app login. Most of the floor has no account. */
  user_id uuid,
  active boolean NOT NULL DEFAULT true,
  left_on date,
  /* Where the row came from, so an imported guess is never mistaken for HR data. */
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import_employee_list', 'import_overtime')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employees_active_idx ON public.employees (active) WHERE active;
CREATE INDEX IF NOT EXISTS employees_department_idx ON public.employees (department);
CREATE UNIQUE INDEX IF NOT EXISTS employees_name_unique_idx ON public.employees (lower(full_name));

-- ── Overtime ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.overtime_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (starts_on, ends_on)
);

CREATE TABLE IF NOT EXISTS public.overtime_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES public.overtime_periods(id) ON DELETE CASCADE,
  /* Signed on purpose: sickness is written off against banked hours, so a balance
     of −68.5 is a real value and not bad data. */
  hours numeric(6,2) NOT NULL,
  note text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_id)
);

CREATE INDEX IF NOT EXISTS overtime_entries_period_idx ON public.overtime_entries (period_id);

-- ── Movement history ────────────────────────────────────────────────────────
--
-- Written now, used by the headcount board in phase 2. A move that is not recorded
-- cannot be questioned afterwards, and "who was on Line 3 the night of the
-- complaint" is exactly the question an audit asks.
CREATE TABLE IF NOT EXISTS public.employee_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  from_line text,
  to_line text,
  from_department text,
  to_department text,
  moved_at timestamptz NOT NULL DEFAULT now(),
  moved_by uuid,
  reason text
);

CREATE INDEX IF NOT EXISTS employee_movements_employee_idx ON public.employee_movements (employee_id, moved_at DESC);

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- Names, emails and hours that feed pay. Closed to admin only for now: widening it
-- is a decision to take deliberately, and every other role in this system was given
-- its access one considered step at a time. Same reasoning that keeps labor_rate
-- revoked at column level.
ALTER TABLE public.shift_patterns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_periods  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shift_patterns read"  ON public.shift_patterns;
CREATE POLICY "shift_patterns read" ON public.shift_patterns
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "shift_patterns admin" ON public.shift_patterns;
CREATE POLICY "shift_patterns admin" ON public.shift_patterns
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "employees admin" ON public.employees;
CREATE POLICY "employees admin" ON public.employees
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "overtime_periods admin" ON public.overtime_periods;
CREATE POLICY "overtime_periods admin" ON public.overtime_periods
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "overtime_entries admin" ON public.overtime_entries;
CREATE POLICY "overtime_entries admin" ON public.overtime_entries
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "employee_movements admin" ON public.employee_movements;
CREATE POLICY "employee_movements admin" ON public.employee_movements
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- updated_at, like the rest of the schema
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$function$;

DROP TRIGGER IF EXISTS trg_employees_touch ON public.employees;
CREATE TRIGGER trg_employees_touch BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_overtime_entries_touch ON public.overtime_entries;
CREATE TRIGGER trg_overtime_entries_touch BEFORE UPDATE ON public.overtime_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- The rows themselves are NOT in this file. Names, personal emails and hours that
-- feed pay do not belong in version control, where they would outlive any decision
-- to remove them. The import was applied directly against the database from the two
-- source spreadsheets, and every imported row carries `source` so its provenance is
-- readable in the table rather than in a commit message.
--
-- Loaded and verified: 50 employees (36 from the employee list, 14 that appear only
-- on the overtime sheet), one period, 33 balances totalling 604.05h — the figure on
-- the existing Painel.
