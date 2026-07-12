
CREATE TABLE public.role_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  role public.app_role not null,
  action text not null,
  allowed boolean not null,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, action)
);

GRANT SELECT ON public.role_permission_overrides TO authenticated;
GRANT ALL ON public.role_permission_overrides TO service_role;

ALTER TABLE public.role_permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read overrides"
  ON public.role_permission_overrides FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "admin insert overrides"
  ON public.role_permission_overrides FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "admin update overrides"
  ON public.role_permission_overrides FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "admin delete overrides"
  ON public.role_permission_overrides FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_role_perm_overrides_updated_at
  BEFORE UPDATE ON public.role_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
