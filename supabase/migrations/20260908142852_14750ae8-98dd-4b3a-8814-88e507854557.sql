DROP POLICY IF EXISTS "part_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "part_photos_update" ON storage.objects;

CREATE POLICY "part_photos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    OR public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'co_engineer'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
  )
);

CREATE POLICY "part_photos_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    OR public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'co_engineer'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    OR public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'co_engineer'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
  )
);