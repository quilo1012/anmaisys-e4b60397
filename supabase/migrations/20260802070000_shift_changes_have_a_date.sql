-- Which shift somebody was on, on a given day.
--
-- shift_group and shift_pattern_id on employees hold one value each. Moving somebody
-- from nights to days changed which shift they had always been on, so July's board
-- and July's counts quietly rewrote themselves to match a decision taken in August.
-- It is the same fault as the area allocation, one layer up: a column that answers
-- "now" being read as though it answered "then".
--
-- Rows here are the positions somebody has held, each from a date. Resolving a day
-- means taking the latest row not after it. The columns on employees stay as the
-- current position — the thing a screen shows when it is not asking about a date.
--
-- Seeded from the current values at 01/08/2026, the day the 186-person list was
-- imported. Not earlier: the factory has people who changed shift long before that
-- and this table has no way to know when, so claiming a date would be inventing one.
CREATE TABLE IF NOT EXISTS public.employee_shift_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  shift_group text,
  shift_pattern_id uuid REFERENCES public.shift_patterns(id) ON DELETE SET NULL,
  /* The first day this position applies. One row per person per date. */
  effective_from date NOT NULL,
  note text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_from)
);

CREATE INDEX IF NOT EXISTS employee_shift_history_lookup_idx
  ON public.employee_shift_history (employee_id, effective_from DESC);

ALTER TABLE public.employee_shift_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esh_read ON public.employee_shift_history;
CREATE POLICY esh_read ON public.employee_shift_history
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS esh_write ON public.employee_shift_history;
CREATE POLICY esh_write ON public.employee_shift_history
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.employee_shift_history
  (employee_id, shift_group, shift_pattern_id, effective_from, note)
SELECT id, shift_group, shift_pattern_id, DATE '2026-08-01',
       'Opening position, from the employee list imported on 01/08/2026'
  FROM public.employees
 WHERE shift_group IS NOT NULL OR shift_pattern_id IS NOT NULL
ON CONFLICT (employee_id, effective_from) DO NOTHING;
