
-- Create work order status enum
CREATE TYPE public.wo_status AS ENUM ('open', 'in_progress', 'completed', 'force_closed');

-- Create work_orders table
CREATE TABLE public.work_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  line TEXT NOT NULL,
  machine TEXT NOT NULL,
  description TEXT NOT NULL,
  status public.wo_status NOT NULL DEFAULT 'open',
  operator_id UUID NOT NULL REFERENCES public.profiles(id),
  engineer_id UUID REFERENCES public.profiles(id),
  closed_by UUID REFERENCES public.profiles(id),
  notified_engineers TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

-- Operators can view their own WOs
CREATE POLICY "Operators can view own WOs"
ON public.work_orders FOR SELECT
USING (
  operator_id = auth.uid()
  OR public.has_role(auth.uid(), 'engineer')
  OR public.has_role(auth.uid(), 'admin')
);

-- Operators can create WOs
CREATE POLICY "Operators can create WOs"
ON public.work_orders FOR INSERT
WITH CHECK (
  operator_id = auth.uid()
  AND public.has_role(auth.uid(), 'operator')
);

-- Engineers can update WOs (start/complete)
CREATE POLICY "Engineers can update WOs"
ON public.work_orders FOR UPDATE
USING (
  public.has_role(auth.uid(), 'engineer')
  OR public.has_role(auth.uid(), 'admin')
);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.work_orders;

-- Add indexes
CREATE INDEX idx_work_orders_status ON public.work_orders(status);
CREATE INDEX idx_work_orders_operator ON public.work_orders(operator_id);
CREATE INDEX idx_work_orders_engineer ON public.work_orders(engineer_id);
