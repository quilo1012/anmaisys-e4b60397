-- O quadro-padrão de cada turno, para um dia poder nascer feito.
--
-- Planning a day starts from another day: the copy button fills today from the last
-- day anybody worked. That is right most mornings and wrong whenever the last day was
-- not a normal one — a Saturday of thirty people copied onto a Tuesday of seventy, a
-- day somebody was still halfway through arranging, a bank holiday.
--
-- This is the other answer: the board as it is meant to look, saved once from a day
-- that was right, and copied onto any day afterwards.
--
-- Deliberately NOT stored here:
--
-- - **The rota.** A matrix row says Ana works Line 1. Whether Ana is in on a Friday is
--   her rota's business, and it is read live when the copy happens — so a person moved
--   from Mon–Thu to Tue–Fri changes group in the matrix on her own, with nobody
--   re-saving anything. This matters more than it sounds: every weekday is a crossover
--   day here. Monday is Mon–Thu plus Fri–Mon, Friday is Tue–Fri plus Fri–Mon, and a
--   matrix that pinned people to a day-type would put forty people on a board they are
--   not due on and record them all as overtime.
-- - **Leadership.** Who leads Line 2 is a fact about a day; the board names today's
--   leader in one press, and the copy already leaves it behind.
-- - **A day type.** There is one matrix per board, not one per weekday. The rota is
--   what makes a Friday different from a Tuesday, and the rota is already recorded.
CREATE TABLE IF NOT EXISTS public.headcount_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The board it is the standard for. Same three the allocations allow.
  shift text NOT NULL CHECK (shift IN ('Day', 'Night', 'Weekend')),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  -- Null is a person in the matrix with no column yet, which the board can still draw.
  area_id uuid REFERENCES public.headcount_areas(id) ON DELETE SET NULL,
  -- Which day this was taken from, so the menu can say how old the standard is.
  saved_from date,
  saved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One person, one place, per board. The same key shape as daily_allocations, so
  -- saving is an upsert rather than a delete-and-hope.
  UNIQUE (shift, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_headcount_matrix_shift ON public.headcount_matrix (shift);

DROP TRIGGER IF EXISTS trg_headcount_matrix_updated ON public.headcount_matrix;
CREATE TRIGGER trg_headcount_matrix_updated
  BEFORE UPDATE ON public.headcount_matrix
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The same people who may plan a day may set the standard it is planned from. Read and
-- write are the same list, exactly as on daily_allocations: a board nobody may read is
-- of no use to somebody who may fill it in.
ALTER TABLE public.headcount_matrix ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS headcount_matrix_read ON public.headcount_matrix;
CREATE POLICY headcount_matrix_read ON public.headcount_matrix
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'planner'::app_role)
    OR has_role(auth.uid(), 'production_office_admin'::app_role)
  );

DROP POLICY IF EXISTS headcount_matrix_write ON public.headcount_matrix;
CREATE POLICY headcount_matrix_write ON public.headcount_matrix
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
