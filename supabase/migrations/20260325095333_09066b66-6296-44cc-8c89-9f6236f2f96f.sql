
-- Storage bucket for WO photos
INSERT INTO storage.buckets (id, name, public) VALUES ('wo-photos', 'wo-photos', true);

-- RLS policies for storage
CREATE POLICY "Engineers and admins can upload photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'wo-photos'
  AND (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
);

CREATE POLICY "Authenticated can view WO photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'wo-photos');

CREATE POLICY "Uploaders can delete own photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'wo-photos'
  AND (owner = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
);

-- wo_photos table
CREATE TABLE public.wo_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  photo_type text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_photo_type CHECK (photo_type IN ('before', 'after'))
);

ALTER TABLE public.wo_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Engineers can insert wo_photos"
ON public.wo_photos FOR INSERT
TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
);

CREATE POLICY "Engineers and admins can view wo_photos"
ON public.wo_photos FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'engineer'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR uploaded_by = auth.uid()
);

-- checklist_completed column on work_orders
ALTER TABLE public.work_orders ADD COLUMN checklist_completed boolean NOT NULL DEFAULT false;
