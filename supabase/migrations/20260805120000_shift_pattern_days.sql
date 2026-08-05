-- Rotas cujas horas mudam de um dia para o outro.
--
-- `shift_patterns` carries one `starts_at` and one `ends_at` for the whole rota, which
-- fits eight of the nine that existed when this was written: same hours every day they
-- cover. It does not fit a Tue–Fri rota that starts at 06:00 from Tuesday to Thursday
-- and at 09:00 on the Friday.
--
-- Splitting that into two patterns was the alternative and it is worse: the same person
-- would hold two rotas, appear on two rows of anything grouped by pattern, and carry an
-- annual leave entitlement on each. One rota, with the days that differ named.
--
-- A pattern with no rows here behaves exactly as it did.
CREATE TABLE IF NOT EXISTS public.shift_pattern_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id uuid NOT NULL REFERENCES public.shift_patterns(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  break_minutes integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE (pattern_id, weekday)
);

COMMENT ON TABLE public.shift_pattern_days IS
  'Per-weekday exceptions to a shift pattern''s own start/end times. A pattern with no rows here works the same hours every day it covers, which is most of them. A row overrides that pattern for that one weekday only — a Tue-Fri rota that starts at 06:00 but at 09:00 on the Friday is one row.';
COMMENT ON COLUMN public.shift_pattern_days.break_minutes IS
  'Null falls back to the pattern''s own break.';

ALTER TABLE public.shift_pattern_days ENABLE ROW LEVEL SECURITY;

-- Mirrors shift_patterns: anybody signed in can read a rota, only an admin sets one.
CREATE POLICY "shift_pattern_days read" ON public.shift_pattern_days
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "shift_pattern_days admin" ON public.shift_pattern_days
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- The rota this table was created for. 3 × 11 h + 8 h = 41 h a week, not the 44 that
-- multiplying the first day by four would give.
INSERT INTO public.shift_patterns
  (name, days, starts_at, ends_at, break_minutes, active, annual_leave_days, leave_includes_bank_holidays)
SELECT 'Tue–Fri days (Fri 09:00)', ARRAY[2,3,4,5], '06:00', '18:00', 60, true, 21.5, true
WHERE NOT EXISTS (SELECT 1 FROM public.shift_patterns WHERE name = 'Tue–Fri days (Fri 09:00)');

INSERT INTO public.shift_pattern_days (pattern_id, weekday, starts_at, ends_at)
SELECT id, 5, '09:00', '18:00' FROM public.shift_patterns
WHERE name = 'Tue–Fri days (Fri 09:00)'
ON CONFLICT (pattern_id, weekday) DO NOTHING;
