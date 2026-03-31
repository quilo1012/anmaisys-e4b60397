
-- 1. Create engineers table
CREATE TABLE public.engineers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  pin_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.engineers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view active engineers"
  ON public.engineers FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage engineers"
  ON public.engineers FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2. Create work_order_logs table
CREATE TABLE public.work_order_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  engineer_id uuid NOT NULL REFERENCES public.engineers(id),
  engineer_name text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_order_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view work_order_logs"
  ON public.work_order_logs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert work_order_logs"
  ON public.work_order_logs FOR INSERT TO authenticated
  WITH CHECK (true);

-- 3. Add engineer_name to work_orders
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS engineer_name text;

-- 4. Create verify_pin_by_code function
CREATE OR REPLACE FUNCTION public.verify_pin_by_code(_pin text)
RETURNS TABLE(engineer_id uuid, engineer_name text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT e.id, e.name
  FROM public.engineers e
  WHERE e.is_active = true
    AND e.pin_hash = crypt(_pin, e.pin_hash);
END;
$$;

-- 5. Create set_engineer_pin_standalone function
CREATE OR REPLACE FUNCTION public.set_engineer_pin_standalone(_engineer_id uuid, _new_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.engineers
  SET pin_hash = crypt(_new_pin, gen_salt('bf'))
  WHERE id = _engineer_id;
END;
$$;

-- 6. Enable realtime for work_order_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.work_order_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.engineers;
