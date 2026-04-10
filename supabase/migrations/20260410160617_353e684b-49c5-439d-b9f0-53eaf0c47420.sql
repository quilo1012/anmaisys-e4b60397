-- Create downtime table
CREATE TABLE IF NOT EXISTS public.downtime (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line TEXT NOT NULL,
  machine TEXT,
  reason TEXT NOT NULL,
  category TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  reported_by UUID REFERENCES public.profiles(id),
  work_order_id UUID REFERENCES public.work_orders(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Validation trigger for category
CREATE OR REPLACE FUNCTION public.validate_downtime_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.category NOT IN ('Mechanical', 'Electrical', 'Human Error', 'Material', 'Planned', 'Other') THEN
    RAISE EXCEPTION 'Invalid downtime category: %', NEW.category;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_downtime_category_trigger
BEFORE INSERT OR UPDATE ON public.downtime
FOR EACH ROW
EXECUTE FUNCTION public.validate_downtime_category();

-- Enable RLS
ALTER TABLE public.downtime ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins can manage downtime"
ON public.downtime FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Manager full access
CREATE POLICY "Managers can manage downtime"
ON public.downtime FOR ALL TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- Engineer read
CREATE POLICY "Engineers can view downtime"
ON public.downtime FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'engineer'::app_role));

-- Operator read
CREATE POLICY "Operators can view downtime"
ON public.downtime FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'operator'::app_role));