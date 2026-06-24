
CREATE TABLE IF NOT EXISTS public.shift_report_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_enabled boolean NOT NULL DEFAULT false,
  night_enabled boolean NOT NULL DEFAULT false,
  extra_recipients text[] NOT NULL DEFAULT ARRAY[]::text[],
  include_admins_managers boolean NOT NULL DEFAULT true,
  last_sent_day_at timestamptz,
  last_sent_night_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_report_settings TO authenticated;
GRANT ALL ON public.shift_report_settings TO service_role;

ALTER TABLE public.shift_report_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read shift settings" ON public.shift_report_settings;
CREATE POLICY "Admins read shift settings" ON public.shift_report_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'manager'::app_role));

DROP POLICY IF EXISTS "Admins write shift settings" ON public.shift_report_settings;
CREATE POLICY "Admins write shift settings" ON public.shift_report_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.shift_report_settings (day_enabled, night_enabled)
SELECT false, false
WHERE NOT EXISTS (SELECT 1 FROM public.shift_report_settings);
