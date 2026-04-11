-- Add UPDATE policy on storage.objects for wo-photos bucket
-- Only the original uploader, admins, or managers can update/replace photos
CREATE POLICY "Uploaders and admins can update wo-photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'wo-photos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
);

-- Add DELETE policy on storage.objects for wo-photos bucket
-- Only admins and managers can delete photos
CREATE POLICY "Admins and managers can delete wo-photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'wo-photos'
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  )
);