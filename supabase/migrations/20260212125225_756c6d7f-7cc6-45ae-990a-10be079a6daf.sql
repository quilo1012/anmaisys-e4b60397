
CREATE TABLE public.machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage machines" ON public.machines
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view machines" ON public.machines
  FOR SELECT USING (
    has_role(auth.uid(), 'operator'::app_role) OR
    has_role(auth.uid(), 'engineer'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role)
  );
