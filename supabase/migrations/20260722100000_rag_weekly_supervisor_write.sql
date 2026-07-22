-- Allow supervisors (and the rest of the RAG editor set) to read/write
-- rag_weekly_entries, matching the app's `rag.manage` permission.
--
-- Additive and idempotent: this only GRANTS access to the listed staff roles.
-- Any pre-existing policy on the table is left untouched (RLS policies are
-- OR-ed), so this never tightens access for anyone who already had it.

DO $$ BEGIN
  CREATE POLICY "rag weekly staff manage"
    ON public.rag_weekly_entries
    FOR ALL
    TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'supervisor'::app_role)
      OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
      OR public.has_role(auth.uid(), 'planner'::app_role)
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'supervisor'::app_role)
      OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
      OR public.has_role(auth.uid(), 'planner'::app_role)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
