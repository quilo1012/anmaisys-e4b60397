CREATE INDEX IF NOT EXISTS idx_work_orders_status ON public.work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_engineer_id ON public.work_orders(engineer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_operator_id ON public.work_orders(operator_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_created_at ON public.work_orders(created_at DESC);