ALTER TABLE public._wo_linestop_fix_bak_20260804 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public._wo_linestop_fix_bak_20260804 FROM anon, authenticated;
GRANT SELECT ON public._wo_linestop_fix_bak_20260804 TO authenticated;
GRANT ALL ON public._wo_linestop_fix_bak_20260804 TO service_role;

DROP POLICY IF EXISTS "Admins can read wo linestop backup" ON public._wo_linestop_fix_bak_20260804;
CREATE POLICY "Admins can read wo linestop backup"
ON public._wo_linestop_fix_bak_20260804
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

ALTER VIEW public.v_wo_downtime_total SET (security_invoker = true);
ALTER VIEW public.v_wo_metrics SET (security_invoker = true);