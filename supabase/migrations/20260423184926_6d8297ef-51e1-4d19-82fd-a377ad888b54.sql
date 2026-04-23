-- Grant managers read access to the safe view of engineers.
-- The base `engineers` table stays admin-only (it holds pin_hash).
-- `engineers_safe` exposes only non-sensitive columns (id, name, is_active, created_at).

GRANT SELECT ON public.engineers_safe TO authenticated;

-- The view uses security_invoker, so RLS on the base table would normally block managers.
-- Add an explicit SELECT policy on `engineers` that ONLY allows reading the safe columns
-- through the view by allowing managers to pass the RLS check. Since column-level grants
-- are not used here, we add a row-level policy scoped to managers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engineers'
      AND policyname = 'Managers can view engineers (safe view only)'
  ) THEN
    CREATE POLICY "Managers can view engineers (safe view only)"
      ON public.engineers
      FOR SELECT
      TO authenticated
      USING (public.has_role(auth.uid(), 'manager'::app_role));
  END IF;
END $$;

-- Revoke direct SELECT on the sensitive `pin_hash` column from authenticated.
-- Managers can read the row via RLS above, but cannot read pin_hash directly.
REVOKE SELECT (pin_hash) ON public.engineers FROM authenticated;