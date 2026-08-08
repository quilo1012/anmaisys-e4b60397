-- Dois quadros-padrão por turno: o dia normal e o dia de encontro.
--
-- One matrix per board was one too few. Every weekday here is two rotas overlapping,
-- but they do not overlap the same way twice:
--
--   Monday      Fri–Mon finishing   +  Mon–Thu starting
--   Tue–Thu     Mon–Thu             +  Tue–Fri          (the steady middle)
--   Friday      Tue–Fri finishing   +  Fri–Mon starting
--
-- Monday and Friday are the days a crew hands the factory to another crew, and they
-- are not staffed like a Wednesday. A single matrix saved from a Tuesday holds Mon–Thu
-- and Tue–Fri — seventy-two people, of whom two are ever in on a Saturday — so on the
-- days that most need a standard it had the least to say.
--
-- `kind` is chosen, never inferred. The menu shows both with the number of people each
-- one has due in on the day being planned: on a Friday the changeover matrix says 83
-- and the standard says 32, and the choice makes itself in front of somebody rather
-- than behind them. A rule guessing it from the weekday would be a rule to get wrong
-- the first time a rota changes.
ALTER TABLE public.headcount_matrix
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'normal';

ALTER TABLE public.headcount_matrix
  DROP CONSTRAINT IF EXISTS headcount_matrix_kind_check;
ALTER TABLE public.headcount_matrix
  ADD CONSTRAINT headcount_matrix_kind_check CHECK (kind IN ('normal', 'changeover'));

-- One person, one place, per board *and* per kind: the same person stands in both
-- matrices, and on a changeover day they may stand somewhere else.
ALTER TABLE public.headcount_matrix
  DROP CONSTRAINT IF EXISTS headcount_matrix_shift_employee_id_key;
ALTER TABLE public.headcount_matrix
  DROP CONSTRAINT IF EXISTS headcount_matrix_shift_kind_employee_id_key;
ALTER TABLE public.headcount_matrix
  ADD CONSTRAINT headcount_matrix_shift_kind_employee_id_key UNIQUE (shift, kind, employee_id);

DROP INDEX IF EXISTS idx_headcount_matrix_shift;
CREATE INDEX IF NOT EXISTS idx_headcount_matrix_shift_kind ON public.headcount_matrix (shift, kind);
