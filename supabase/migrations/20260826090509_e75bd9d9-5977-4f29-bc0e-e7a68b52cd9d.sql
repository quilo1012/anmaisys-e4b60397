-- Photos for maintenance spare parts live in the private "part-photos" bucket.
-- Access mirrors public.products exactly: view = anyone who can read products,
-- upload/replace = anyone who can write products, delete = anyone who can delete products.

CREATE POLICY "part_photos_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'planner'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

CREATE POLICY "part_photos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
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
  )
)
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

CREATE POLICY "part_photos_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);