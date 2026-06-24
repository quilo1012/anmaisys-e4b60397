
CREATE TABLE public.intouch_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  source_ip text,
  headers jsonb,
  payload jsonb,
  parsed_ok boolean NOT NULL DEFAULT false,
  error_message text,
  created_wo_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intouch_webhook_logs TO authenticated;
GRANT ALL ON public.intouch_webhook_logs TO service_role;
ALTER TABLE public.intouch_webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view intouch logs" ON public.intouch_webhook_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role inserts logs" ON public.intouch_webhook_logs
  FOR INSERT TO service_role WITH CHECK (true);

CREATE TABLE public.intouch_stop_code_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_code text NOT NULL UNIQUE,
  label text NOT NULL,
  default_priority text NOT NULL DEFAULT 'medium',
  category text,
  line_hint text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intouch_stop_code_map TO authenticated;
GRANT ALL ON public.intouch_stop_code_map TO service_role;
ALTER TABLE public.intouch_stop_code_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin manage stop codes" ON public.intouch_stop_code_map
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Managers view stop codes" ON public.intouch_stop_code_map
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER update_intouch_stop_code_map_updated_at
  BEFORE UPDATE ON public.intouch_stop_code_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
